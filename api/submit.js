// api/submit.js
// Receives a merchant submission from the front end: stores any uploaded
// statement files + the analysis in Supabase, and emails an internal triage
// notification to the PaySwitch admin.
//
// NOTE: the admin email below is an INTERNAL notification, not the client-facing
// report. It intentionally shows the raw AI findings (including recommendations)
// so the admin can review before approving. The non-prescriptive report
// philosophy applies to generate-report.js, NOT here.

export const config = {
  // File uploads (base64 statements) + DB insert + email can run long.
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const resendKey   = process.env.RESEND_API_KEY;
  const adminEmail  = process.env.ADMIN_EMAIL || 'declan.t.harrington@gmail.com';
  const fromEmail   = process.env.RESEND_FROM || 'Payswitch Submissions <onboarding@resend.dev>';

  // Supabase is required to store the submission; without it the whole flow
  // (including later approval/report generation) cannot work.
  if (!supabaseUrl || !supabaseKey) {
    console.error('submit: missing Supabase environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { report, programContext, files } = req.body;

    if (!report) return res.status(400).json({ error: 'report required' });

    // ── Upload files to Supabase Storage ─────────────────────────
    const uploadedFiles = [];

    if (Array.isArray(files) && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // file = { name, type, data (base64) }
          const binaryData = Buffer.from(file.data, 'base64');
          const safeName   = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          // Include the index so two files uploaded in the same millisecond
          // can't collide on the same path (x-upsert is false below).
          const path       = `${Date.now()}_${i}_${safeName}`;

          const uploadRes = await fetch(
            `${supabaseUrl}/storage/v1/object/statements/${path}`,
            {
              method: 'POST',
              headers: {
                'apikey':        supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type':  file.type || 'application/octet-stream',
                'x-upsert':      'false',
              },
              body: binaryData,
            }
          );

          if (uploadRes.ok) {
            uploadedFiles.push({
              name: file.name,
              path,
              type: file.type,
              size: binaryData.length,
            });
          } else {
            const err = await uploadRes.text();
            console.error(`File upload failed for ${file.name}:`, err);
          }
        } catch (fileErr) {
          console.error(`Error uploading ${file?.name}:`, fileErr.message);
        }
      }
    }

    // ── Store submission in Supabase DB ───────────────────────────
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        submitted_at:    new Date().toISOString(),
        provider:        report.provider      || null,
        period:          report.period        || null,
        volume:          report.volume        || null,
        total_fees:      report.totalFees     || null,
        effective_rate:  report.effectiveRate || null,
        pricing_model:   report.pricingModel  || null,
        lcr_status:      report.lcrStatus     || null,
        program_context: programContext       || null,
        report_json:     JSON.stringify(report),
        files_uploaded:  JSON.stringify(uploadedFiles),
        status:          'pending_review',
      }),
    });

    // A failed insert means there is no row to approve later — surface it
    // rather than returning a misleading success with id "new".
    if (!dbRes.ok) {
      const detail = await dbRes.text();
      console.error('submit: DB insert failed:', dbRes.status, detail);
      throw new Error(`Failed to store submission: ${dbRes.status}`);
    }

    const dbData = await dbRes.json();
    const submissionId = Array.isArray(dbData) && dbData[0] ? dbData[0].id : null;

    // ── Format helpers ────────────────────────────────────────────
    const fmtD = n => n != null ? '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const fmtP = n => n != null ? Number(n).toFixed(2) + '%' : '—';

    // ── Fee reconciliation guard ──────────────────────────────────
    // totalFees should be the statement's stated (GST-inclusive) total. When a
    // feeBreakdown is present, its components should sum to ~totalFees. A
    // material gap usually means an extraction error (e.g. a GST-exclusive
    // figure was used, or a fee block was missed) — surface it for the admin to
    // check BEFORE approving and generating the report.
    const FEE_RECONCILE_TOLERANCE_PCT = 5;
    const feeCheck = (() => {
      const total = Number(report.totalFees);
      const items = Array.isArray(report.feeBreakdown) ? report.feeBreakdown : [];
      if (!total || !items.length) return null; // nothing to reconcile
      const sum = items.reduce((a, b) => a + (Number(b.amount) || 0), 0);
      const pct = Math.abs(sum - total) / total * 100;
      return { total, sum, diff: sum - total, pct, ok: pct <= FEE_RECONCILE_TOLERANCE_PCT };
    })();
    if (feeCheck && !feeCheck.ok) {
      console.warn(`submit: fee reconciliation mismatch — breakdown ${feeCheck.sum.toFixed(2)} vs totalFees ${feeCheck.total.toFixed(2)} (${feeCheck.pct.toFixed(1)}%)`);
    }
    const reconWarningHtml = (feeCheck && !feeCheck.ok)
      ? `<div style="margin:0 0 8px;padding:12px 14px;border-radius:8px;background:#fdecea;border:1px solid #f5b5ae">
           <strong style="display:block;font-size:13px;color:#a3271b;margin-bottom:3px">⚠ Fee reconciliation check</strong>
           <span style="font-size:13px;color:#7a2018;line-height:1.55">Extracted total fees (${fmtD(feeCheck.total)}) differ from the sum of the fee breakdown (${fmtD(feeCheck.sum)}) by ${fmtD(Math.abs(feeCheck.diff))} (${feeCheck.pct.toFixed(1)}%). Verify the statement's stated total before approving.</span>
         </div>`
      : '';

    // The analyser now returns FACTS only (no prose/findings — those are added at
    // report-generation time). The triage email reflects those facts.
    const observationsHtml = Array.isArray(report.observations) && report.observations.length
      ? `<ul style="margin:0;padding-left:18px">${report.observations.map(o =>
          `<li style="font-size:13px;line-height:1.7;color:#444;margin-bottom:4px">${o}</li>`).join('')}</ul>`
      : '<p style="font-size:13px;color:#999">No observations recorded</p>';

    const setupHtml = Array.isArray(report.setup) && report.setup.length
      ? `<table><tbody>${report.setup.map(s =>
          `<tr><td style="color:#666">${s.label}</td><td>${s.value}</td></tr>`).join('')}</tbody></table>`
      : '<p style="font-size:13px;color:#999">No setup details recorded</p>';

    const cardMix = report.cardMix || {};
    const cardMixHtml = Object.entries(cardMix).filter(([, v]) => v != null).length
      ? `<table><tbody>${Object.entries(cardMix).filter(([, v]) => v != null).map(([k, v]) =>
          `<tr><td style="color:#666;text-transform:capitalize">${k}</td><td>${v}%</td></tr>`).join('')}</tbody></table>`
      : '';

    // ── Files section for email ───────────────────────────────────
    const filesHtml = uploadedFiles.length > 0
      ? `<div style="margin-top:8px">
          ${uploadedFiles.map(f =>
            `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee;font-size:13px">
              <span style="color:#666">${f.name}</span>
              <span style="color:#999;margin-left:auto">${(f.size/1024).toFixed(0)} KB</span>
            </div>`
          ).join('')}
         </div>`
      : '<p style="font-size:13px;color:#999">No files uploaded</p>';

    // ── Send internal triage email via Resend (non-fatal) ─────────
    if (!resendKey) {
      console.warn('submit: RESEND_API_KEY not set — skipping admin notification email.');
    } else {
      const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:0}
.wrap{max-width:660px;margin:0 auto;background:white}
.hdr{background:#0d1628;padding:28px 32px}
.hdr-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:8px}
.hdr-title{font-size:20px;font-weight:700;color:white;margin-bottom:4px}
.hdr-meta{font-size:12px;color:rgba(255,255,255,.35)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:18px;background:rgba(255,255,255,.08);border-radius:10px;overflow:hidden}
.stat{padding:13px;background:rgba(255,255,255,.05);text-align:center}
.stat-val{font-size:17px;font-weight:700;color:white;display:block}
.stat-lbl{font-size:10px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.09em}
.body{padding:24px 32px}
.section{padding:18px 0;border-bottom:1px solid #eee}
.section:last-child{border-bottom:none}
.sec-label{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#999;margin-bottom:10px}
.sec-text{font-size:14px;line-height:1.7;color:#444;white-space:pre-line}
table{width:100%;border-collapse:collapse}
td{padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
td:last-child{text-align:right;font-weight:500}
tr:last-child td{border-bottom:none}
.prog-box{background:#f8f8f6;border-radius:8px;padding:14px;font-size:13px;line-height:1.7;color:#555}
.rec-box{background:#0d1628;border-radius:10px;padding:18px;margin-top:4px}
.rec-label{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6fa8ff;margin-bottom:8px}
.rec-h{font-size:15px;color:white;font-weight:600;margin-bottom:10px}
.rec-steps{padding-left:18px;margin-top:8px}
.rec-steps li{font-size:13px;color:rgba(255,255,255,.5);line-height:1.7;margin-bottom:4px}
.review-btn{display:inline-block;background:#1a5cff;color:white;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:14px}
.file-row{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
.file-row:last-child{border-bottom:none}
</style></head>
<body><div class="wrap">
<div class="hdr">
  <div class="hdr-label">New Submission · Payswitch AI · #${submissionId ?? '—'}</div>
  <div class="hdr-title">${report.provider || 'Unknown Provider'} — ${report.period || 'Review'}</div>
  <div class="hdr-meta">Submitted ${new Date().toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' })}</div>
  <div class="stats">
    <div class="stat"><span class="stat-val">${fmtP(report.effectiveRate)}</span><span class="stat-lbl">Eff. rate</span></div>
    <div class="stat"><span class="stat-val">${fmtD(report.totalFees)}</span><span class="stat-lbl">Total fees</span></div>
    <div class="stat"><span class="stat-val">${report.pricingModel || '—'}</span><span class="stat-lbl">Model</span></div>
  </div>
</div>
<div class="body">
  ${reconWarningHtml}
  <div class="section">
    <div class="sec-label">Statement Data (extracted)</div>
    <table>
      <tr><td>Card volume</td><td>${fmtD(report.volume)}</td></tr>
      <tr><td>Total fees</td><td>${fmtD(report.totalFees)}</td></tr>
      <tr><td>Effective rate</td><td>${fmtP(report.effectiveRate)}</td></tr>
      <tr><td>Provider rate / margin</td><td>${report.providerRate || '—'}</td></tr>
      <tr><td>Transactions</td><td>${report.transactions != null ? Number(report.transactions).toLocaleString('en-AU') : '—'}</td></tr>
      <tr><td>Avg transaction value</td><td>${fmtD(report.averageTransactionValue)}</td></tr>
      <tr><td>Monthly fee</td><td>${fmtD(report.monthlyFee)}</td></tr>
      <tr><td>Terminal fees</td><td>${fmtD(report.terminalFees)}</td></tr>
      <tr><td>Pricing model</td><td>${report.pricingModel || '—'}</td></tr>
      <tr><td>LCR status</td><td>${report.lcrStatus || '—'}</td></tr>
    </table>
  </div>
  ${cardMixHtml ? `<div class="section"><div class="sec-label">Card Mix</div>${cardMixHtml}</div>` : ''}
  <div class="section"><div class="sec-label">Factual Observations</div>${observationsHtml}</div>
  <div class="section"><div class="sec-label">Current Setup</div>${setupHtml}</div>
  ${programContext ? `<div class="section"><div class="sec-label">Merchant Profile</div><div class="prog-box">${programContext.replace(/\n/g, '<br>')}</div></div>` : ''}
  <div class="section">
    <div class="sec-label">Uploaded Files (${uploadedFiles.length})</div>
    ${filesHtml}
    ${uploadedFiles.length > 0 ? `<p style="font-size:12px;color:#999;margin-top:10px">View files in Supabase Storage → statements bucket</p>` : ''}
  </div>
  <div class="section" style="text-align:center;padding:24px 0">
    <a href="https://payswitch-eight.vercel.app/admin.html" class="review-btn">Open Dashboard →</a>
  </div>
</div>
</div></body></html>`;

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from:    fromEmail,
            to:      [adminEmail],
            subject: `New submission — ${report.provider || 'Unknown'} · ${fmtP(report.effectiveRate)} · ${uploadedFiles.length} file(s)`,
            html:    emailHtml,
          }),
        });

        const emailData = await emailRes.json();
        if (!emailRes.ok) {
          console.error('submit: Resend email failed:', emailRes.status, JSON.stringify(emailData));
        } else {
          console.log('Email result:', JSON.stringify(emailData));
        }
      } catch (emailErr) {
        // Email is a notification convenience; the submission is already stored,
        // so don't fail the request if it can't be sent.
        console.error('submit: error sending admin email:', emailErr.message);
      }
    }

    return res.status(200).json({ success: true, id: submissionId, filesUploaded: uploadedFiles.length });

  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
