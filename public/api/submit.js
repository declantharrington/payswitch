// api/submit.js — Vercel serverless function
// Receives submission from analyser, stores in Supabase, sends email via Resend

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { submission, report, programContext } = req.body;

    // ── Store in Supabase ──────────────────────────────────────────
    const supabaseUrl  = process.env.SUPABASE_URL;
    const supabaseKey  = process.env.SUPABASE_ANON_KEY;

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        submitted_at:    new Date().toISOString(),
        provider:        report.provider        || null,
        period:          report.period          || null,
        volume:          report.volume          || null,
        total_fees:      report.totalFees       || null,
        effective_rate:  report.effectiveRate   || null,
        pricing_model:   report.pricingModel    || null,
        lcr_status:      report.lcrStatus       || null,
        program_context: programContext         || null,
        report_json:     JSON.stringify(report),
        status:          'pending_review'
      })
    });

    const dbData = await dbRes.json();
    const submissionId = dbData[0]?.id || 'unknown';

    // ── Send email via Resend ─────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY;

    // Format the report for email
    const alertsHtml = report.alerts?.map(a =>
      `<div style="padding:10px 14px;margin-bottom:8px;border-radius:8px;border-left:3px solid ${a.type==='warn'?'#c8960c':a.type==='good'?'#0a7a52':'#1a5cff'};background:${a.type==='warn'?'#fdf6e3':a.type==='good'?'#e6f4ed':'#eef3ff'}">
        <strong style="display:block;margin-bottom:3px;font-size:13px;">${a.heading}</strong>
        <span style="font-size:13px;color:#444">${a.body}</span>
      </div>`
    ).join('') || '';

    const stackHtml = report.stackItems?.map(i =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:#666">${i.label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${i.value}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:${i.status==='ok'?'#0a7a52':i.status==='warn'?'#c8960c':'#c0392b'}">${i.status==='ok'?'✓ OK':i.status==='warn'?'⚠ Warning':'✗ Gap'}</td>
      </tr>`
    ).join('') || '';

    const fmtD = n => n != null ? '$'+Number(n).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    const fmtP = n => n != null ? n.toFixed(2)+'%' : '—';

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
  .wrap { max-width: 680px; margin: 0 auto; background: white; }
  .header { background: #0d1628; padding: 32px 36px; }
  .header-label { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.3); margin-bottom: 8px; }
  .header-title { font-size: 22px; font-weight: 700; color: white; margin-bottom: 4px; }
  .header-meta { font-size: 13px; color: rgba(255,255,255,0.4); }
  .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; margin-top: 20px; background: rgba(255,255,255,0.08); border-radius: 10px; overflow: hidden; }
  .stat { padding: 14px; background: rgba(255,255,255,0.05); text-align: center; }
  .stat-val { font-size: 18px; font-weight: 700; color: white; display: block; }
  .stat-lbl { font-size: 10px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.09em; }
  .body { padding: 28px 36px; }
  .section { padding: 20px 0; border-bottom: 1px solid #eee; }
  .section:last-child { border-bottom: none; }
  .section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #999; margin-bottom: 12px; }
  .section-text { font-size: 14px; line-height: 1.7; color: #444; white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 9px 0; border-bottom: 1px solid #eee; font-size: 13px; }
  td:last-child { text-align: right; font-weight: 500; }
  .review-btn { display: inline-block; background: #1a5cff; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 8px; }
  .program-box { background: #f8f8f6; border-radius: 10px; padding: 16px; font-size: 13px; line-height: 1.7; color: #555; }
  .rec-box { background: #0d1628; border-radius: 10px; padding: 20px; margin-top: 4px; }
  .rec-label { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6fa8ff; margin-bottom: 8px; }
  .rec-h { font-size: 16px; color: white; margin-bottom: 10px; font-weight: 600; }
  .rec-steps { padding-left: 18px; margin-top: 10px; }
  .rec-steps li { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.7; margin-bottom: 5px; }
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-label">New Submission · Payswitch AI — Submission #${submissionId}</div>
    <div class="header-title">${report.provider || 'Unknown Provider'} — ${report.period || 'Statement Review'}</div>
    <div class="header-meta">Submitted ${new Date().toLocaleString('en-AU', {dateStyle:'long',timeStyle:'short'})}</div>
    <div class="stats">
      <div class="stat"><span class="stat-val">${fmtP(report.effectiveRate)}</span><span class="stat-lbl">Effective rate</span></div>
      <div class="stat"><span class="stat-val">${fmtD(report.totalFees)}</span><span class="stat-lbl">Total fees</span></div>
      <div class="stat"><span class="stat-val">${report.pricingModel||'—'}</span><span class="stat-lbl">Pricing model</span></div>
    </div>
  </div>
  <div class="body">

    <div class="section">
      <div class="section-label">Executive Summary</div>
      <div class="section-text">${report.executiveSummary||'—'}</div>
    </div>

    <div class="section">
      <div class="section-label">Statement Data</div>
      <table>
        <tr><td>Card volume</td><td>${fmtD(report.volume)}</td></tr>
        <tr><td>Transactions</td><td>${report.transactions?.toLocaleString('en-AU')||'—'}</td></tr>
        <tr><td>Total fees</td><td>${fmtD(report.totalFees)}</td></tr>
        <tr><td>Effective rate</td><td>${fmtP(report.effectiveRate)}</td></tr>
        ${report.perTransactionFee!=null?`<tr><td>Per-transaction fee</td><td>${report.perTransactionFee}¢</td></tr>`:''}
        ${report.monthlyFee!=null?`<tr><td>Monthly fee</td><td>${fmtD(report.monthlyFee)}</td></tr>`:''}
        <tr><td>LCR status</td><td>${report.lcrStatus||'—'}</td></tr>
      </table>
    </div>

    ${alertsHtml ? `<div class="section"><div class="section-label">Key Findings</div>${alertsHtml}</div>` : ''}

    ${programContext ? `
    <div class="section">
      <div class="section-label">Program Description (submitted by merchant)</div>
      <div class="program-box">${programContext.replace(/\n/g,'<br>')}</div>
    </div>` : ''}

    ${stackHtml ? `
    <div class="section">
      <div class="section-label">Stack Assessment</div>
      <table><thead><tr><td><strong>Component</strong></td><td><strong>Value</strong></td><td><strong>Status</strong></td></tr></thead><tbody>${stackHtml}</tbody></table>
      ${report.stackAssessment ? `<p style="margin-top:14px;font-size:14px;line-height:1.7;color:#555">${report.stackAssessment}</p>` : ''}
    </div>` : ''}

    ${report.savingsOpportunity ? `<div class="section"><div class="section-label">Savings Opportunity</div><div class="section-text">${report.savingsOpportunity}</div></div>` : ''}

    ${report.pricingModelAnalysis ? `<div class="section"><div class="section-label">Pricing Model Analysis</div><div class="section-text">${report.pricingModelAnalysis}</div></div>` : ''}

    ${report.lcrAnalysis ? `<div class="section"><div class="section-label">LCR Analysis</div><div class="section-text">${report.lcrAnalysis}</div></div>` : ''}

    ${report.benchmarkComment ? `<div class="section"><div class="section-label">Market Benchmark</div><div class="section-text">${report.benchmarkComment}</div></div>` : ''}

    <div class="section">
      <div class="rec-box">
        <div class="rec-label">Recommendation</div>
        <div class="rec-h">${report.keyRecommendation||''}</div>
        ${report.nextSteps?.length ? `<ol class="rec-steps">${report.nextSteps.map(s=>`<li>${s}</li>`).join('')}</ol>` : ''}
      </div>
    </div>

    <div class="section" style="text-align:center;padding:28px 0;">
      <p style="font-size:14px;color:#666;margin-bottom:16px;">Review this submission in your admin dashboard</p>
      <a href="https://payswitch-eight.vercel.app/admin.html" class="review-btn">View in Dashboard →</a>
    </div>

  </div>
</div>
</body>
</html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Payswitch Submissions <onboarding@resend.dev>',
        to:   ['declan.t.harrington@gmail.com'],
        subject: `New submission — ${report.provider||'Unknown'} · ${fmtP(report.effectiveRate)} effective rate`,
        html: emailHtml
      })
    });

    return res.status(200).json({ success: true, id: submissionId });

  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: err.message });
  }
}
