// api/submit.js
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { submission, report, programContext } = req.body;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const resendKey   = process.env.RESEND_API_KEY;

    // ── Store in Supabase ─────────────────────────────────────────
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        submitted_at:   new Date().toISOString(),
        provider:       report.provider      || null,
        period:         report.period        || null,
        volume:         report.volume        || null,
        total_fees:     report.totalFees     || null,
        effective_rate: report.effectiveRate || null,
        pricing_model:  report.pricingModel  || null,
        lcr_status:     report.lcrStatus     || null,
        program_context: programContext      || null,
        report_json:    JSON.stringify(report),
        status:         'pending_review'
      })
    });

    const dbData = await dbRes.json();
    const submissionId = Array.isArray(dbData) && dbData[0] ? dbData[0].id : 'new';

    // ── Format helpers ────────────────────────────────────────────
    const fmtD = n => n != null ? '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const fmtP = n => n != null ? Number(n).toFixed(2) + '%' : '—';

    const alertsHtml = (report.alerts || []).map(a =>
      `<div style="padding:10px 14px;margin-bottom:8px;border-radius:8px;border-left:3px solid ${a.type==='warn'?'#c8960c':a.type==='good'?'#0a7a52':'#1a5cff'};background:${a.type==='warn'?'#fdf6e3':a.type==='good'?'#e6f4ed':'#eef3ff'}">
        <strong style="display:block;margin-bottom:3px;font-size:13px;">${a.heading}</strong>
        <span style="font-size:13px;color:#444">${a.body}</span>
      </div>`
    ).join('');

    // ── Send email via Resend ─────────────────────────────────────
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
</style></head>
<body><div class="wrap">
<div class="hdr">
  <div class="hdr-label">New Submission · Payswitch AI · #${submissionId}</div>
  <div class="hdr-title">${report.provider || 'Unknown Provider'} — ${report.period || 'Review'}</div>
  <div class="hdr-meta">Submitted ${new Date().toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' })}</div>
  <div class="stats">
    <div class="stat"><span class="stat-val">${fmtP(report.effectiveRate)}</span><span class="stat-lbl">Eff. rate</span></div>
    <div class="stat"><span class="stat-val">${fmtD(report.totalFees)}</span><span class="stat-lbl">Total fees</span></div>
    <div class="stat"><span class="stat-val">${report.pricingModel || '—'}</span><span class="stat-lbl">Model</span></div>
  </div>
</div>
<div class="body">
  ${report.executiveSummary ? `<div class="section"><div class="sec-label">Executive Summary</div><div class="sec-text">${report.executiveSummary}</div></div>` : ''}
  <div class="section">
    <div class="sec-label">Statement Data</div>
    <table>
      <tr><td>Card volume</td><td>${fmtD(report.volume)}</td></tr>
      <tr><td>Total fees</td><td>${fmtD(report.totalFees)}</td></tr>
      <tr><td>Effective rate</td><td>${fmtP(report.effectiveRate)}</td></tr>
      <tr><td>Pricing model</td><td>${report.pricingModel || '—'}</td></tr>
      <tr><td>LCR status</td><td>${report.lcrStatus || '—'}</td></tr>
      ${report.perTransactionFee != null ? `<tr><td>Per-transaction fee</td><td>${report.perTransactionFee}¢</td></tr>` : ''}
      ${report.monthlyFee != null ? `<tr><td>Monthly fee</td><td>${fmtD(report.monthlyFee)}</td></tr>` : ''}
    </table>
  </div>
  ${alertsHtml ? `<div class="section"><div class="sec-label">Key Findings</div>${alertsHtml}</div>` : ''}
  ${programContext ? `<div class="section"><div class="sec-label">Program Description</div><div class="prog-box">${programContext.replace(/\n/g, '<br>')}</div></div>` : ''}
  ${report.savingsOpportunity ? `<div class="section"><div class="sec-label">Savings Opportunity</div><div class="sec-text">${report.savingsOpportunity}</div></div>` : ''}
  ${report.pricingModelAnalysis ? `<div class="section"><div class="sec-label">Pricing Model Analysis</div><div class="sec-text">${report.pricingModelAnalysis}</div></div>` : ''}
  ${report.lcrAnalysis ? `<div class="section"><div class="sec-label">LCR Analysis</div><div class="sec-text">${report.lcrAnalysis}</div></div>` : ''}
  ${report.benchmarkComment ? `<div class="section"><div class="sec-label">Market Benchmark</div><div class="sec-text">${report.benchmarkComment}</div></div>` : ''}
  ${report.keyRecommendation ? `
  <div class="section">
    <div class="rec-box">
      <div class="rec-label">Recommendation</div>
      <div class="rec-h">${report.keyRecommendation}</div>
      ${report.nextSteps && report.nextSteps.length ? `<ol class="rec-steps">${report.nextSteps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
    </div>
  </div>` : ''}
  <div class="section" style="text-align:center;padding:24px 0">
    <p style="font-size:14px;color:#666;margin-bottom:14px">View this submission in your dashboard</p>
    <a href="https://payswitch-eight.vercel.app/admin.html" class="review-btn">Open Dashboard →</a>
  </div>
</div>
</div></body></html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Payswitch Submissions <onboarding@resend.dev>',
        to: ['declan.t.harrington@gmail.com'],
        subject: `New submission — ${report.provider || 'Unknown'} · ${fmtP(report.effectiveRate)}`,
        html: emailHtml
      })
    });

    const emailData = await emailRes.json();
    console.log('Email result:', JSON.stringify(emailData));

    return res.status(200).json({ success: true, id: submissionId });

  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
