// api/generate-report.js
// Triggered when admin approves a submission.
// Fetches the HTML template, populates it with real merchant data, stores in Supabase.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { submissionId } = req.body;
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    // ── 1. Fetch submission from Supabase ─────────────────────────
    const fetchRes = await fetch(
      `${supabaseUrl}/rest/v1/submissions?id=eq.${submissionId}&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const rows = await fetchRes.json();
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });

    const submission    = rows[0];
    const report        = JSON.parse(submission.report_json || '{}');
    const programContext = submission.program_context || '';

    // ── 2. Determine revenue band for tone calibration ────────────
    const revenueBand = (() => {
      if (programContext.includes('50mplus'))  return 'enterprise';
      if (programContext.includes('20to50m') || programContext.includes('5to20m')) return 'mid-market';
      return 'smb';
    })();

    const toneGuide = {
      enterprise:    'Write for a CFO or Head of Finance. Use precise financial language, basis points, and regulatory context. Be direct and data-driven. No simplifications.',
      'mid-market':  'Write for a business owner or finance manager. Balance technical accuracy with plain English. Use dollar amounts alongside percentages. Be specific about savings.',
      smb:           'Write for a small business owner. Plain English only — no jargon. Lead with dollar impact. Keep it concise and actionable.'
    }[revenueBand];

    const fmtD = n => n != null ? `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
    const fmtP = n => n != null ? `${Number(n).toFixed(2)}%` : '—';
    const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    // ── 3. Call Claude to write personalised narrative ────────────
    const systemPrompt = `You are a senior payments consultant at PaySwitch, an Australian payments advisory firm writing a formal client-facing report.

TONE: ${toneGuide}

Write professional, specific prose — never generic. Reference the client's actual numbers, setup, and situation throughout.

FORMATTING RULES — critical:
- Use "\n\n" between paragraphs (double newline)
- For sections with multiple points, use "**Heading:** Content" format with double newlines between each
- Every section must have at least 2 paragraphs separated by \n\n
- Never write a wall of text — break it up
- Use specific subheadings within longer sections like "**Current Situation:**", "**The Problem:**", "**The Opportunity:**"
- Per-transaction fees are in CENTS not dollars — state them correctly

Return ONLY valid JSON, no markdown wrapping, no preamble.

Return this exact structure:
{
  "executiveSummary": "3-4 paragraphs separated by \n\n. First paragraph: what we found. Second: key issue. Third: the opportunity. Fourth: what happens next.",
  "pricingModelAnalysis": "**Current Model:**\n\n[paragraph]\n\n**Why This Matters:**\n\n[paragraph]\n\n**The Alternative:**\n\n[paragraph]",
  "savingsOpportunity": "**Identified Savings:**\n\n[paragraph with specific maths]\n\n**How We Get There:**\n\n[paragraph]\n\n**Conservative Estimate:**\n\n[paragraph]",
  "lcrAnalysis": "**Current Status:**\n\n[paragraph]\n\n**Dollar Impact:**\n\n[paragraph]",
  "benchmarkComment": "**Where You Sit:**\n\n[paragraph]\n\n**What Best-in-Class Looks Like:**\n\n[paragraph]",
  "stackAssessment": "**Overall Assessment:**\n\n[paragraph]\n\n**What Is Working:**\n\n[paragraph]\n\n**Gaps and Risks:**\n\n[paragraph]",
  "nextStep1": "Full recommendation sentence or two — specific and actionable",
  "nextStep2": "Full recommendation sentence or two — specific and actionable",
  "nextStep3": "Full recommendation sentence or two — specific and actionable",
  "keyRecommendation": "The single most important action — direct and specific, one or two sentences"
}`;

    const userMessage = `Write a personalised payments review for this merchant.

DATA FROM STATEMENT:
Provider: ${report.provider || '—'}
Period: ${report.period || '—'}
Card volume: ${fmtD(report.volume)}
Total fees: ${fmtD(report.totalFees)}
Effective rate: ${fmtP(report.effectiveRate)}
Transactions: ${report.transactions || '—'}
Per-transaction fee (calculated as volume/transactions * effectiveRate): ${
        report.volume && report.transactions && report.effectiveRate
          ? fmtD((report.volume / report.transactions) * (report.effectiveRate / 100))
          : report.perTransactionFee != null ? fmtD(report.perTransactionFee / 100) : '—'
      } — this is a dollar value
Monthly fee: ${fmtD(report.monthlyFee)}
Terminal fees: ${fmtD(report.terminalFees)}
Pricing model (AI assessed): ${report.pricingModel || '—'}
LCR status (AI assessed): ${report.lcrStatus || '—'}

AI FINDINGS:
${report.executiveSummary || ''}
${report.savingsOpportunity || ''}
${report.lcrAnalysis || ''}
${report.benchmarkComment || ''}
${report.stackAssessment || ''}
Key recommendation: ${report.keyRecommendation || ''}

MERCHANT PROFILE:
${programContext}

KEY ALERTS:
${(report.alerts || []).map(a => `${a.type.toUpperCase()}: ${a.heading} — ${a.body}`).join('\n')}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 6000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!claudeRes.ok) throw new Error(`Claude error: ${claudeRes.status}`);
    const claudeData = await claudeRes.json();
    const rawText    = claudeData.content.find(b => b.type === 'text')?.text || '';
    const jsonStart  = rawText.indexOf('{');
    const jsonEnd    = rawText.lastIndexOf('}');
    const narrative  = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));

    // ── 4. Load the HTML template (inlined) ─────────────────────
    let html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>PaySwitch \u2014 Payments Review Report</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n<style>\n\n/* \u2500\u2500 RESET & BASE \u2500\u2500 */\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n\nbody {\n  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;\n  color: #1a1a2e;\n  background: #fff;\n  font-size: 13px;\n  line-height: 1.6;\n  -webkit-print-color-adjust: exact;\n  print-color-adjust: exact;\n}\n\n/* \u2500\u2500 PAGE LAYOUT \u2500\u2500 */\n.page {\n  width: 210mm;\n  min-height: 297mm;\n  margin: 0 auto;\n  position: relative;\n  overflow: hidden;\n  page-break-after: always;\n}\n.page:last-child { page-break-after: avoid; }\n\n/* \u2500\u2500 COVER PAGE \u2500\u2500 */\n.cover {\n  background: #020408;\n  min-height: 297mm;\n  display: flex;\n  flex-direction: column;\n  padding: 14mm 16mm;\n}\n.cover-logo-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-bottom: auto;\n}\n.cover-logo-mark {\n  width: 32px;\n  height: 32px;\n}\n\n\n.cover-body { margin-top: auto; }\n\n.cover-eyebrow {\n  font-size: 10px;\n  font-weight: 600;\n  letter-spacing: 0.2em;\n  text-transform: uppercase;\n  color: rgba(58,138,255,0.8);\n  margin-bottom: 16px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.cover-eyebrow::after {\n  content: '';\n  flex: 1;\n  height: 1px;\n  background: rgba(58,138,255,0.3);\n}\n\n.cover-title {\n  font-size: 42px;\n  font-weight: 800;\n  color: white;\n  letter-spacing: -0.04em;\n  line-height: 1.05;\n  margin-bottom: 8px;\n}\n.cover-title span { color: #3A8AFF; }\n\n.cover-subtitle {\n  font-size: 16px;\n  font-weight: 300;\n  color: rgba(200,210,240,0.55);\n  margin-bottom: 40px;\n}\n\n.cover-stats {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 1px;\n  background: rgba(255,255,255,0.08);\n  border-radius: 12px;\n  overflow: hidden;\n  margin-bottom: 40px;\n}\n.cover-stat {\n  background: rgba(255,255,255,0.04);\n  padding: 18px 20px;\n}\n.cover-stat-val {\n  font-size: 28px;\n  font-weight: 700;\n  color: white;\n  letter-spacing: -0.04em;\n  display: block;\n  margin-bottom: 4px;\n}\n.cover-stat-lbl {\n  font-size: 10px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.12em;\n  color: rgba(200,210,240,0.35);\n}\n\n.cover-divider {\n  height: 1px;\n  background: rgba(255,255,255,0.08);\n  margin-bottom: 28px;\n}\n\n.cover-meta {\n  display: flex;\n  gap: 40px;\n  margin-bottom: 28px;\n}\n.cover-meta-item { }\n.cover-meta-label {\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n  color: rgba(200,210,240,0.28);\n  margin-bottom: 4px;\n}\n.cover-meta-value {\n  font-size: 13px;\n  color: rgba(200,210,240,0.65);\n  font-weight: 400;\n}\n\n.cover-confidential {\n  font-size: 9px;\n  color: rgba(200,210,240,0.2);\n  letter-spacing: 0.1em;\n  text-transform: uppercase;\n  border-top: 1px solid rgba(255,255,255,0.06);\n  padding-top: 14px;\n}\n\n/* \u2500\u2500 CONTENT PAGES \u2500\u2500 */\n.content-page {\n  background: #fff;\n  padding: 14mm 16mm 12mm;\n  min-height: 297mm;\n  display: flex;\n  flex-direction: column;\n}\n\n.page-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding-bottom: 10px;\n  border-bottom: 2px solid #f0f2f7;\n  margin-bottom: 28px;\n}\n.page-header-logo {\n  font-size: 13px;\n  font-weight: 800;\n  color: #0d1628;\n  letter-spacing: -0.01em;\n}\n.page-header-logo span { color: #1A6BFF; }\n.page-header-meta {\n  font-size: 10px;\n  color: #aab0c4;\n  letter-spacing: 0.04em;\n}\n\n.page-content { flex: 1; }\n\n.page-footer {\n  margin-top: auto;\n  padding-top: 14px;\n  border-top: 1px solid #f0f2f7;\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n}\n.page-footer-left {\n  font-size: 9px;\n  color: #aab0c4;\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n}\n.page-footer-right {\n  font-size: 9px;\n  color: #aab0c4;\n}\n\n/* \u2500\u2500 SECTIONS \u2500\u2500 */\n.section { margin-bottom: 28px; }\n.section:last-child { margin-bottom: 0; }\n\n.section-label {\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.2em;\n  text-transform: uppercase;\n  color: #1A6BFF;\n  margin-bottom: 6px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.section-label::after {\n  content: '';\n  flex: 1;\n  height: 1px;\n  background: #e8ecf4;\n}\n\n.section-title {\n  font-size: 20px;\n  font-weight: 700;\n  color: #0d1628;\n  letter-spacing: -0.03em;\n  margin-bottom: 12px;\n  line-height: 1.2;\n}\n\n.section-body {\n  font-size: 13px;\n  color: #3d4663;\n  line-height: 1.75;\n}\n\n/* \u2500\u2500 STAT CARDS \u2500\u2500 */\n.stat-row {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 12px;\n  margin-bottom: 24px;\n}\n.stat-card {\n  background: #f7f9fc;\n  border: 1px solid #e4e8f0;\n  border-radius: 10px;\n  padding: 16px 18px;\n}\n.stat-card.dark {\n  background: #0d1628;\n  border-color: #0d1628;\n}\n.stat-card.accent {\n  background: #eef3ff;\n  border-color: #c5d4f8;\n}\n.stat-val {\n  font-size: 24px;\n  font-weight: 700;\n  color: #0d1628;\n  letter-spacing: -0.04em;\n  display: block;\n  margin-bottom: 3px;\n}\n.stat-card.dark .stat-val { color: white; }\n.stat-val.high { color: #c0392b; }\n.stat-val.mid  { color: #c8960c; }\n.stat-val.low  { color: #0a7a52; }\n.stat-lbl {\n  font-size: 10px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.1em;\n  color: #7c8db0;\n}\n.stat-card.dark .stat-lbl { color: rgba(200,210,240,0.4); }\n\n/* \u2500\u2500 DATA TABLE \u2500\u2500 */\n.data-table {\n  width: 100%;\n  border-collapse: collapse;\n  margin-bottom: 20px;\n  font-size: 12px;\n}\n.data-table th {\n  padding: 8px 12px;\n  text-align: left;\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.1em;\n  text-transform: uppercase;\n  color: #7c8db0;\n  border-bottom: 2px solid #e4e8f0;\n  background: #f7f9fc;\n}\n.data-table td {\n  padding: 10px 12px;\n  border-bottom: 1px solid #f0f2f7;\n  vertical-align: top;\n  color: #3d4663;\n}\n.data-table tr:last-child td { border-bottom: none; }\n.data-table .td-label { color: #7c8db0; font-weight: 500; width: 42%; }\n.data-table .td-value { font-weight: 600; color: #0d1628; }\n.data-table .td-status-ok   { color: #0a7a52; font-weight: 700; text-align: center; }\n.data-table .td-status-warn { color: #c8960c; font-weight: 700; text-align: center; }\n.data-table .td-status-gap  { color: #c0392b; font-weight: 700; text-align: center; }\n\n/* \u2500\u2500 ALERT BOXES \u2500\u2500 */\n.alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }\n.alert {\n  padding: 12px 14px;\n  border-radius: 6px;\n  border-left: 4px solid;\n  font-size: 12px;\n}\n.alert-warn { background: #fdf6e3; border-color: #c8960c; }\n.alert-good { background: #e8f5e9; border-color: #0a7a52; }\n.alert-info { background: #eef3ff; border-color: #1A6BFF; }\n.alert-heading {\n  font-weight: 700;\n  margin-bottom: 3px;\n  font-size: 12px;\n}\n.alert-warn .alert-heading { color: #92650a; }\n.alert-good .alert-heading { color: #0a5c3e; }\n.alert-info .alert-heading { color: #1a3a8a; }\n.alert-body { color: #444; line-height: 1.55; }\n\n/* \u2500\u2500 RECOMMENDATIONS \u2500\u2500 */\n.rec-list { display: flex; flex-direction: column; gap: 14px; }\n.rec-item { display: flex; gap: 14px; align-items: flex-start; }\n.rec-num {\n  width: 26px;\n  height: 26px;\n  border-radius: 50%;\n  background: #1A6BFF;\n  color: white;\n  font-size: 11px;\n  font-weight: 700;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  margin-top: 1px;\n}\n.rec-body { flex: 1; font-size: 13px; color: #3d4663; line-height: 1.65; }\n.rec-body strong { color: #0d1628; font-weight: 600; display: block; margin-bottom: 2px; }\n\n.key-rec-box {\n  background: #0d1628;\n  border-radius: 10px;\n  padding: 20px 22px;\n  margin-top: 20px;\n}\n.key-rec-label {\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.16em;\n  text-transform: uppercase;\n  color: #3A8AFF;\n  margin-bottom: 8px;\n}\n.key-rec-text {\n  font-size: 14px;\n  font-weight: 600;\n  color: white;\n  line-height: 1.45;\n  letter-spacing: -0.01em;\n}\n\n/* \u2500\u2500 CTA PAGE \u2500\u2500 */\n.cta-page {\n  background: #020408;\n  min-height: 297mm;\n  display: flex;\n  flex-direction: column;\n  padding: 14mm 16mm;\n}\n.cta-page-logo {\n  font-size: 15px;\n  font-weight: 800;\n  color: white;\n  letter-spacing: -0.02em;\n  margin-bottom: auto;\n}\n.cta-page-logo span { color: #3A8AFF; }\n.cta-body { margin-top: auto; }\n.cta-eyebrow {\n  font-size: 10px;\n  font-weight: 600;\n  letter-spacing: 0.18em;\n  text-transform: uppercase;\n  color: rgba(58,138,255,0.7);\n  margin-bottom: 18px;\n}\n.cta-title {\n  font-size: 36px;\n  font-weight: 800;\n  color: white;\n  letter-spacing: -0.04em;\n  line-height: 1.08;\n  margin-bottom: 16px;\n  max-width: 480px;\n}\n.cta-sub {\n  font-size: 14px;\n  font-weight: 300;\n  color: rgba(200,210,240,0.55);\n  line-height: 1.7;\n  max-width: 440px;\n  margin-bottom: 36px;\n}\n.cta-divider {\n  height: 1px;\n  background: rgba(255,255,255,0.08);\n  margin-bottom: 28px;\n}\n.cta-contacts {\n  display: flex;\n  gap: 40px;\n  margin-bottom: 28px;\n}\n.cta-contact-label {\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n  color: rgba(200,210,240,0.28);\n  margin-bottom: 4px;\n}\n.cta-contact-value {\n  font-size: 13px;\n  color: #3A8AFF;\n  font-weight: 500;\n}\n.cta-prepared {\n  font-size: 11px;\n  color: rgba(200,210,240,0.3);\n  border-top: 1px solid rgba(255,255,255,0.06);\n  padding-top: 16px;\n}\n.cta-confidential {\n  font-size: 9px;\n  color: rgba(200,210,240,0.15);\n  letter-spacing: 0.1em;\n  text-transform: uppercase;\n  margin-top: 10px;\n}\n\n/* \u2500\u2500 PRINT \u2500\u2500 */\n@media print {\n  @page {\n    size: A4;\n    margin: 0;\n  }\n  body { margin: 0; }\n  .page { page-break-after: always; width: 210mm; }\n  .page:last-child { page-break-after: avoid; }\n}\n\n/* \u2500\u2500 SCREEN PREVIEW \u2500\u2500 */\n@media screen {\n  body { background: #e8ecf4; padding: 20px 0; }\n  .page {\n    box-shadow: 0 4px 32px rgba(0,0,0,0.15);\n    margin-bottom: 20px;\n    border-radius: 4px;\n  }\n}\n\n</style>\n</head>\n<body>\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 1 \u2014 COVER                            -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"cover\">\n\n  <div class=\"cover-logo-row\">\n    <div style=\"font-size:20px;font-weight:800;color:white;letter-spacing:-0.02em\">pay<span style=\"color:#3A8AFF\">switch</span></div>\n  </div>\n\n  <div class=\"cover-body\">\n    <div class=\"cover-eyebrow\">Payments Review Report</div>\n    <div class=\"cover-title\">Payments Stack<br><span>Analysis</span></div>\n    <div class=\"cover-subtitle\">{{provider}} &middot; {{period}}</div>\n\n    <div class=\"cover-stats\">\n      <div class=\"cover-stat\">\n        <span class=\"cover-stat-val\">{{effective_rate}}</span>\n        <span class=\"cover-stat-lbl\">Effective Rate</span>\n      </div>\n      <div class=\"cover-stat\">\n        <span class=\"cover-stat-val\">{{total_fees}}</span>\n        <span class=\"cover-stat-lbl\">Total Fees</span>\n      </div>\n      <div class=\"cover-stat\">\n        <span class=\"cover-stat-val\">{{volume}}</span>\n        <span class=\"cover-stat-lbl\">Card Volume</span>\n      </div>\n    </div>\n\n    <div class=\"cover-divider\"></div>\n\n    <div class=\"cover-meta\">\n      <div class=\"cover-meta-item\">\n        <div class=\"cover-meta-label\">Prepared for</div>\n        <div class=\"cover-meta-value\">{{merchant_name}}</div>\n      </div>\n      <div class=\"cover-meta-item\">\n        <div class=\"cover-meta-label\">Report date</div>\n        <div class=\"cover-meta-value\">{{report_date}}</div>\n      </div>\n      <div class=\"cover-meta-item\">\n        <div class=\"cover-meta-label\">Prepared by</div>\n        <div class=\"cover-meta-value\">PaySwitch Advisory</div>\n      </div>\n      <div class=\"cover-meta-item\">\n        <div class=\"cover-meta-label\">Classification</div>\n        <div class=\"cover-meta-value\">Confidential</div>\n      </div>\n    </div>\n\n    <div class=\"cover-confidential\">\n      This report is prepared exclusively for {{merchant_name}} and contains confidential commercial analysis. Not for distribution.\n    </div>\n  </div>\n\n</div>\n</div>\n\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 2 \u2014 EXECUTIVE SUMMARY                -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"content-page\">\n\n  <div class=\"page-header\">\n    <div style=\"font-size:13px;font-weight:800;color:#0d1628;letter-spacing:-0.01em\">pay<span style=\"color:#1A6BFF\">switch</span></div>\n    <div class=\"page-header-meta\">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>\n  </div>\n\n  <div class=\"page-content\">\n\n    <div class=\"stat-row\">\n      <div class=\"stat-card dark\">\n        <span class=\"stat-val\">{{effective_rate}}</span>\n        <span class=\"stat-lbl\">Effective Rate</span>\n      </div>\n      <div class=\"stat-card\">\n        <span class=\"stat-val\">{{total_fees}}</span>\n        <span class=\"stat-lbl\">Total Fees</span>\n      </div>\n      <div class=\"stat-card accent\">\n        <span class=\"stat-val\">{{volume}}</span>\n        <span class=\"stat-lbl\">Card Volume</span>\n      </div>\n    </div>\n\n    <div class=\"section\">\n      <div class=\"section-label\">Executive Summary</div>\n      <div class=\"section-body\">{{executive_summary}}</div>\n    </div>\n\n    <div class=\"section\">\n      <div class=\"section-label\">Key Findings</div>\n      <div class=\"alerts\">\n        <div class=\"alert alert-warn\">\n          <div class=\"alert-heading\">{{key_finding_1_heading}}</div>\n          <div class=\"alert-body\">{{key_finding_1_body}}</div>\n        </div>\n        <div class=\"alert alert-info\">\n          <div class=\"alert-heading\">{{key_finding_2_heading}}</div>\n          <div class=\"alert-body\">{{key_finding_2_body}}</div>\n        </div>\n        <div class=\"alert alert-good\">\n          <div class=\"alert-heading\">{{key_finding_3_heading}}</div>\n          <div class=\"alert-body\">{{key_finding_3_body}}</div>\n        </div>\n      </div>\n    </div>\n\n  </div>\n\n  <div class=\"page-footer\">\n    <div class=\"page-footer-left\">PaySwitch Advisory &middot; Confidential</div>\n    <div class=\"page-footer-right\">Page 2</div>\n  </div>\n\n</div>\n</div>\n\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 3 \u2014 FEE ANALYSIS                     -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"content-page\">\n\n  <div class=\"page-header\">\n    <div style=\"font-size:13px;font-weight:800;color:#0d1628;letter-spacing:-0.01em\">pay<span style=\"color:#1A6BFF\">switch</span></div>\n    <div class=\"page-header-meta\">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>\n  </div>\n\n  <div class=\"page-content\">\n\n    <div class=\"section\">\n      <div class=\"section-label\">Fee Analysis</div>\n      <table class=\"data-table\">\n        <thead>\n          <tr>\n            <th style=\"width:42%\">Component</th>\n            <th>Value</th>\n          </tr>\n        </thead>\n        <tbody>\n          <tr><td class=\"td-label\">Effective rate</td><td class=\"td-value\">{{effective_rate}}</td></tr>\n          <tr><td class=\"td-label\">Total fees paid</td><td class=\"td-value\">{{total_fees}}</td></tr>\n          <tr><td class=\"td-label\">Card volume processed</td><td class=\"td-value\">{{volume}}</td></tr>\n          <tr><td class=\"td-label\">Total transactions</td><td class=\"td-value\">{{transactions}}</td></tr>\n          <tr><td class=\"td-label\">Per-transaction fee</td><td class=\"td-value\">{{per_transaction_fee}}</td></tr>\n          <tr><td class=\"td-label\">Monthly account fee</td><td class=\"td-value\">{{monthly_fee}}</td></tr>\n          <tr><td class=\"td-label\">Terminal fees</td><td class=\"td-value\">{{terminal_fees}}</td></tr>\n          <tr><td class=\"td-label\">Pricing model</td><td class=\"td-value\">{{pricing_model}}</td></tr>\n          <tr><td class=\"td-label\">LCR status</td><td class=\"td-value\">{{lcr_status}}</td></tr>\n        </tbody>\n      </table>\n    </div>\n\n    <div class=\"section\">\n      <div class=\"section-label\">Pricing Model Assessment</div>\n      <div class=\"section-body\">{{pricing_model_analysis}}</div>\n    </div>\n\n  </div>\n\n  <div class=\"page-footer\">\n    <div class=\"page-footer-left\">PaySwitch Advisory &middot; Confidential</div>\n    <div class=\"page-footer-right\">Page 3</div>\n  </div>\n\n</div>\n</div>\n\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 4 \u2014 SAVINGS & BENCHMARK              -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"content-page\">\n\n  <div class=\"page-header\">\n    <div style=\"font-size:13px;font-weight:800;color:#0d1628;letter-spacing:-0.01em\">pay<span style=\"color:#1A6BFF\">switch</span></div>\n    <div class=\"page-header-meta\">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>\n  </div>\n\n  <div class=\"page-content\">\n\n    <div class=\"section\">\n      <div class=\"section-label\">Savings Opportunity</div>\n      <div class=\"section-body\">{{savings_opportunity}}</div>\n    </div>\n\n    <div class=\"section\">\n      <div class=\"section-label\">Least Cost Routing</div>\n      <div class=\"section-body\">{{lcr_analysis}}</div>\n    </div>\n\n    <div class=\"section\">\n      <div class=\"section-label\">Market Benchmark</div>\n      <div class=\"section-body\">{{benchmark_comment}}</div>\n    </div>\n\n  </div>\n\n  <div class=\"page-footer\">\n    <div class=\"page-footer-left\">PaySwitch Advisory &middot; Confidential</div>\n    <div class=\"page-footer-right\">Page 4</div>\n  </div>\n\n</div>\n</div>\n\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 5 \u2014 PAYMENTS STACK ASSESSMENT        -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"content-page\">\n\n  <div class=\"page-header\">\n    <div style=\"font-size:13px;font-weight:800;color:#0d1628;letter-spacing:-0.01em\">pay<span style=\"color:#1A6BFF\">switch</span></div>\n    <div class=\"page-header-meta\">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>\n  </div>\n\n  <div class=\"page-content\">\n\n    <div class=\"section\">\n      <div class=\"section-label\">Payments Stack Assessment</div>\n      <div class=\"section-body\">{{stack_assessment}}</div>\n    </div>\n\n    <div class=\"section\">\n      <div class=\"section-label\">Stack Component Review</div>\n      <table class=\"data-table\">\n        <thead>\n          <tr>\n            <th style=\"width:28%\">Component</th>\n            <th>Current Setup</th>\n            <th style=\"width:14%;text-align:center\">Status</th>\n          </tr>\n        </thead>\n        <tbody>\n          <tr>\n            <td class=\"td-label\">{{stack_item_1_label}}</td>\n            <td>{{stack_item_1_value}}</td>\n            <td class=\"td-status-ok\">{{stack_item_1_status}}</td>\n          </tr>\n          <tr>\n            <td class=\"td-label\">{{stack_item_2_label}}</td>\n            <td>{{stack_item_2_value}}</td>\n            <td class=\"td-status-warn\">{{stack_item_2_status}}</td>\n          </tr>\n          <tr>\n            <td class=\"td-label\">{{stack_item_3_label}}</td>\n            <td>{{stack_item_3_value}}</td>\n            <td class=\"td-status-ok\">{{stack_item_3_status}}</td>\n          </tr>\n          <tr>\n            <td class=\"td-label\">{{stack_item_4_label}}</td>\n            <td>{{stack_item_4_value}}</td>\n            <td class=\"td-status-gap\">{{stack_item_4_status}}</td>\n          </tr>\n          <tr>\n            <td class=\"td-label\">{{stack_item_5_label}}</td>\n            <td>{{stack_item_5_value}}</td>\n            <td class=\"td-status-warn\">{{stack_item_5_status}}</td>\n          </tr>\n        </tbody>\n      </table>\n    </div>\n\n  </div>\n\n  <div class=\"page-footer\">\n    <div class=\"page-footer-left\">PaySwitch Advisory &middot; Confidential</div>\n    <div class=\"page-footer-right\">Page 5</div>\n  </div>\n\n</div>\n</div>\n\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 6 \u2014 RECOMMENDATIONS                  -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"content-page\">\n\n  <div class=\"page-header\">\n    <div style=\"font-size:13px;font-weight:800;color:#0d1628;letter-spacing:-0.01em\">pay<span style=\"color:#1A6BFF\">switch</span></div>\n    <div class=\"page-header-meta\">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>\n  </div>\n\n  <div class=\"page-content\">\n\n    <div class=\"section\">\n      <div class=\"section-label\">Recommendations</div>\n      <div class=\"rec-list\">\n        <div class=\"rec-item\">\n          <div class=\"rec-num\">1</div>\n          <div class=\"rec-body\">{{next_step_1}}</div>\n        </div>\n        <div class=\"rec-item\">\n          <div class=\"rec-num\">2</div>\n          <div class=\"rec-body\">{{next_step_2}}</div>\n        </div>\n        <div class=\"rec-item\">\n          <div class=\"rec-num\">3</div>\n          <div class=\"rec-body\">{{next_step_3}}</div>\n        </div>\n      </div>\n\n      <div class=\"key-rec-box\">\n        <div class=\"key-rec-label\">Priority recommendation</div>\n        <div class=\"key-rec-text\">{{key_recommendation}}</div>\n      </div>\n    </div>\n\n  </div>\n\n  <div class=\"page-footer\">\n    <div class=\"page-footer-left\">PaySwitch Advisory &middot; Confidential</div>\n    <div class=\"page-footer-right\">Page 6</div>\n  </div>\n\n</div>\n</div>\n\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- PAGE 7 \u2014 NEXT STEPS & CONTACT             -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"page\">\n<div class=\"cta-page\">\n\n  <div style=\"font-size:16px;font-weight:800;color:white;letter-spacing:-0.02em\">pay<span style=\"color:#3A8AFF\">switch</span></div>\n\n  <div class=\"cta-body\">\n    <div class=\"cta-eyebrow\">Next Steps</div>\n    <div class=\"cta-title\">Ready to optimise<br>your payments?</div>\n    <div class=\"cta-sub\">Your PaySwitch advisor will walk you through these findings and begin implementing changes at no cost to your business. No lock-in contracts. No upfront fees.</div>\n\n    <div class=\"cta-divider\"></div>\n\n    <div class=\"cta-contacts\">\n      <div>\n        <div class=\"cta-contact-label\">Website</div>\n        <div class=\"cta-contact-value\">payswitch.com.au</div>\n      </div>\n      <div>\n        <div class=\"cta-contact-label\">Email</div>\n        <div class=\"cta-contact-value\">hello@payswitch.com.au</div>\n      </div>\n    </div>\n\n    <div class=\"cta-divider\"></div>\n\n    <div class=\"cta-prepared\">\n      Prepared for <strong style=\"color:rgba(200,210,240,0.55)\">{{merchant_name}}</strong>\n      &nbsp;&middot;&nbsp;\n      {{merchant_email}}\n      &nbsp;&middot;&nbsp;\n      {{report_date}}\n    </div>\n    <div class=\"cta-confidential\">Confidential &middot; PaySwitch Advisory &middot; Not for distribution</div>\n  </div>\n\n</div>\n</div>\n\n</body>\n</html>\n";

    // ── 5. Build alert HTML ───────────────────────────────────────
    const alertTypes = ['warn', 'info', 'good'];
    const alerts     = report.alerts || [];

    const alertReplacements = {
      '{{key_finding_1_heading}}': alerts[0]?.heading || '—',
      '{{key_finding_1_body}}':    alerts[0]?.body    || '',
      '{{key_finding_2_heading}}': alerts[1]?.heading || '—',
      '{{key_finding_2_body}}':    alerts[1]?.body    || '',
      '{{key_finding_3_heading}}': alerts[2]?.heading || '—',
      '{{key_finding_3_body}}':    alerts[2]?.body    || '',
    };

    // ── 6. Build stack item replacements ─────────────────────────
    const stackItems = report.stackItems || [];
    const statusLabel = { ok: '✓ OK', warn: '⚠ Review', gap: '✗ Gap' };
    const stackReplacements = {};
    for (let i = 0; i < 5; i++) {
      const item = stackItems[i] || { label: '—', value: '—', status: 'ok' };
      stackReplacements[`{{stack_item_${i+1}_label}}`]  = item.label;
      stackReplacements[`{{stack_item_${i+1}_value}}`]  = item.value;
      stackReplacements[`{{stack_item_${i+1}_status}}`] = statusLabel[item.status] || item.status;
    }

    // ── 7. Helper to convert narrative text to HTML ─────────────
    function renderText(text) {
      if (!text) return '';
      return text
        // Convert **heading:** to <strong>heading:</strong>
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Convert double newlines to paragraph breaks
        .split('\n\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p style="margin-bottom:12px">${p}</p>`)
        .join('');
    }

    // ── 8. Build full replacement map ─────────────────────────────
    const merchantName = programContext.match(/Name: (.+)/)?.[1]?.trim() || '—';
    const merchantEmail = programContext.match(/Email: (.+)/)?.[1]?.trim() || '—';

    const replacements = {
      '{{provider}}':             report.provider        || '—',
      '{{period}}':               report.period          || '—',
      '{{effective_rate}}':       fmtP(report.effectiveRate),
      '{{total_fees}}':           fmtD(report.totalFees),
      '{{volume}}':               fmtD(report.volume),
      '{{merchant_name}}':        merchantName,
      '{{merchant_email}}':       merchantEmail,
      '{{report_date}}':          today,
      '{{transactions}}':         report.transactions ? Number(report.transactions).toLocaleString('en-AU') : '—',
      '{{per_transaction_fee}}':  (() => {
        // Calculate: (volume / transactions) * (effectiveRate / 100)
        if (report.volume && report.transactions && report.effectiveRate) {
          const calc = (report.volume / report.transactions) * (report.effectiveRate / 100);
          return fmtD(calc);
        }
        // Fallback to reported value if available
        if (report.perTransactionFee != null) return fmtD(report.perTransactionFee / 100);
        return '—';
      })(),
      '{{monthly_fee}}':          fmtD(report.monthlyFee),
      '{{terminal_fees}}':        fmtD(report.terminalFees),
      '{{pricing_model}}':        report.pricingModel    || '—',
      '{{lcr_status}}':           report.lcrStatus       || '—',
      '{{executive_summary}}':    renderText(narrative.executiveSummary    || ''),
      '{{pricing_model_analysis}}': renderText(narrative.pricingModelAnalysis || ''),
      '{{savings_opportunity}}':  renderText(narrative.savingsOpportunity  || ''),
      '{{lcr_analysis}}':         renderText(narrative.lcrAnalysis         || ''),
      '{{benchmark_comment}}':    renderText(narrative.benchmarkComment    || ''),
      '{{stack_assessment}}':     renderText(narrative.stackAssessment     || ''),
      '{{next_step_1}}':          narrative.nextStep1           || '',
      '{{next_step_2}}':          narrative.nextStep2           || '',
      '{{next_step_3}}':          narrative.nextStep3           || '',
      '{{key_recommendation}}':   narrative.keyRecommendation   || '',
      ...alertReplacements,
      ...stackReplacements,
    };

    // Apply all replacements
    for (const [key, value] of Object.entries(replacements)) {
      html = html.split(key).join(value);
    }

    // ── 8. Store completed HTML in Supabase Storage ───────────────
    const timestamp = Date.now();
    const safeName  = merchantName.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);
    const safeProvider = (report.provider || 'Unknown').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 20);
    const htmlPath  = `reports/${safeName}_${safeProvider}_${timestamp}.html`;

    await fetch(`${supabaseUrl}/storage/v1/object/statements/${htmlPath}`, {
      method: 'POST',
      headers: {
        apikey:          supabaseKey,
        Authorization:   `Bearer ${supabaseKey}`,
        'Content-Type':  'text/html',
        'x-upsert':      'true'
      },
      body: html
    });

    // ── 9. Update submission status ───────────────────────────────
    await fetch(`${supabaseUrl}/rest/v1/submissions?id=eq.${submissionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        apikey:          supabaseKey,
        Authorization:   `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        status:           'approved',
        report_narrative: JSON.stringify(narrative),
        report_html_path: htmlPath
      })
    });

    return res.status(200).json({ success: true, htmlPath });

  } catch (err) {
    console.error('generate-report error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
