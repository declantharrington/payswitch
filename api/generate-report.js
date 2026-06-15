// api/generate-report.js
// Triggered when admin approves a submission.
// Fetches the HTML template, populates it with real merchant data, stores in Supabase.
//
// Report philosophy (keep in sync with the PaySwitch Knowledge Base):
//   The client-facing report is a DIAGNOSTIC, not a prescription. It opens the
//   merchant's eyes to where money may be leaking and how large the opportunity
//   could be — WITHOUT naming the specific fix, the provider to move to, or the
//   exact change to make. That "how" is the paid consulting conversation. The
//   report must also read in plain English for a non-expert business owner, and
//   open with a general Australian-payments-landscape preamble.

import { PAYMENTS_KB } from './_lib/payments-knowledge-base.js';

export const config = {
  // Sonnet can take 20-40s+ on a long report; match analyse.js so the function
  // isn't killed mid-generation by the platform default timeout.
  maxDuration: 120,
};

export default async function handler(req, res) {
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

  if (!supabaseUrl || !supabaseKey || !anthropicKey) {
    console.error('generate-report: missing required environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Latest Sonnet. (analyse.js intentionally stays on Haiku for cheaper extraction.)
  const MODEL = 'claude-sonnet-4-6';

  try {
    // ── 1. Fetch submission from Supabase ─────────────────────────
    const fetchRes = await fetch(
      `${supabaseUrl}/rest/v1/submissions?id=eq.${submissionId}&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const rows = await fetchRes.json();
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const submission     = rows[0];
    const report         = JSON.parse(submission.report_json || '{}');
    const programContext = submission.program_context || '';

    // ── 2. Determine revenue band for tone calibration ────────────
    const ctxLower = programContext.toLowerCase();
    const revenueBand = (() => {
      if (ctxLower.includes('50mplus')) return 'enterprise';
      if (ctxLower.includes('20to50m') || ctxLower.includes('5to20m')) return 'mid-market';
      return 'smb';
    })();

    // Tone calibrates DEPTH and sophistication by audience — but every band must
    // stay plain-English about payments concepts (the reader may know finance,
    // not payments) and must stay non-prescriptive (open eyes, don't instruct).
    const toneGuide = {
      enterprise:
        'Reader is a CFO or Head of Finance. They are financially literate but not necessarily payments specialists, so still explain payments-specific terms (interchange, scheme fees, routing) in plain English the first time they appear. Be precise and data-driven; you may use dollar figures and basis points. Stay analytical and calm.',
      'mid-market':
        'Reader is a business owner or finance manager. Balance technical accuracy with plain English. Lead with dollar impact, then explain the mechanism simply. Define any payments term on first use.',
      smb:
        'Reader is a small business owner with limited payments knowledge. Plain English only — no jargon. Explain every concept in one simple line. Lead with the dollar impact and keep it concise and relatable (e.g. "on every $100 you take by card...").',
    }[revenueBand];

    const fmtD = n => n != null ? `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
    const fmtP = n => n != null ? `${Number(n).toFixed(2)}%` : '—';
    const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    // Average fee per transaction = average sale value (volume/transactions) × effective rate.
    // This is a DOLLAR value (the average fee on an average sale), NOT a fixed
    // per-transaction interchange fee (those are quoted in cents). See guardrails.
    const avgFeePerTxn = (() => {
      if (report.volume && report.transactions && report.effectiveRate) {
        return (report.volume / report.transactions) * (report.effectiveRate / 100);
      }
      if (report.perTransactionFee != null) return report.perTransactionFee / 100; // fallback (cents → $)
      return null;
    })();

    // ── 3. Call Claude to write personalised narrative ────────────
    // The PaySwitch Knowledge Base is prepended as authoritative reference for
    // all Australian payments facts, benchmarks and the report philosophy. The
    // condensed instructions that follow it are the operative rules for THIS task.
    const systemPrompt = `=== PAYSWITCH KNOWLEDGE BASE (authoritative reference) ===
Use the following as the source of truth for Australian payments facts, figures, benchmarks, terminology and the report-writing philosophy. Do not contradict it and do not introduce statistics that are not supported by it.

${PAYMENTS_KB}

=== END KNOWLEDGE BASE ===

You are a senior payments consultant at PaySwitch, an Australian payments advisory firm, writing a formal but accessible client-facing report.

TONE: ${toneGuide}

═══ CORE PHILOSOPHY — read carefully, this governs everything ═══
This report is a DIAGNOSTIC that opens the merchant's eyes to where money may be leaking and how large the opportunity could be. It is NOT a set of instructions.
- SURFACE opportunities and SIZE them; do NOT prescribe the fix. Write "this is an area worth reviewing" — never "switch to X" or "do Y".
- Do NOT name any payment providers, banks, gateways, products or plans. Stay vendor-neutral.
- Quantify the potential prize using the merchant's own numbers, but withhold the method — the specific change, provider and implementation are what a PaySwitch advisor delivers in person.
- Frame "next steps" and the priority item as AREAS TO EXPLORE or QUESTIONS TO BRING TO A REVIEW, phrased as observations, naturally pointing toward a conversation with a PaySwitch advisor. Never as directives.
- Be specific and personal about what you OBSERVE in their data; be open-ended about what to DO about it.

═══ PLAIN ENGLISH ═══
Write so a business owner with no payments knowledge understands it. Explain every payments term in a simple line the first time it appears (e.g. "interchange — the wholesale fee your provider passes through to the bank that issued your customer's card"). Lead with dollar impact, then the mechanism. Short sentences. Calm, trusted-adviser voice — explaining, not selling.

═══ APPROVED AUSTRALIAN PAYMENTS FACTS ═══
Use ONLY these figures for any market/landscape statistic. Do NOT invent or estimate other statistics. Distinguish clearly between what is true TODAY and what changes ON A FUTURE DATE.
- Australians pay an estimated ~$1.8 billion per year in card surcharges (~$1.6 billion of it borne by consumers). About 16% of merchants surcharge.
- Cash has fallen from ~70% of in-person payments in 2007 to ~15% in 2025.
- Small merchants typically pay around 1.4% of turnover to accept cards on a single-rate plan vs ~0.9% on an unblended plan; large merchants average ~0.6% — so small businesses often pay roughly double the rate of large ones for the same sale.
- Least-cost routing (sending eligible debit via the cheaper network) can reduce the cost of accepting debit by ~20%.
- FROM 1 OCTOBER 2026 (future): card surcharging is removed on eftpos/Mastercard/Visa, AND domestic interchange caps are cut — consumer credit interchange cap falls from 0.80% to 0.30%, and the debit cap falls from 10c/0.20% to 8c/0.16%. Commercial (business) credit stays at 0.80%.
- FROM 1 APRIL 2027 (future): interchange on foreign-issued cards is capped at 1.0% (currently unregulated, averaging ~1.75%).
- Interchange caps do NOT apply to American Express (a three-party network).

═══ UNITS — state correctly ═══
- Effective rate is a percentage of turnover.
- "Average fee per transaction" provided to you is a DOLLAR value (average sale value × effective rate) — the typical fee on a typical sale. It is NOT a fixed per-transaction interchange fee.
- Any fixed/interchange per-transaction fee, if you mention one, is quoted in CENTS. Never conflate the two.
- Interchange, scheme fees and the acquirer's margin are three different things paid to three different parties — don't merge them.

═══ FORMATTING RULES ═══
- Use "\\n\\n" between paragraphs (double newline).
- For multi-point sections, use "**Heading:** Content" with double newlines between each block.
- Every multi-part section has at least 2 paragraphs separated by \\n\\n. Never write a wall of text.
- Use the subheadings specified in the JSON structure below.

Return ONLY valid JSON — no markdown fences, no preamble. Use this exact structure:
{
  "landscapePreamble": "2-3 short paragraphs separated by \\n\\n. GENERAL scene-setting about the Australian payments landscape — NOT about this specific merchant yet. Explain that card payments are now how most Australians pay and that the cost of accepting them is a real, often-overlooked expense. Weave in a few of the approved stats. Make the case that payment costs are often set once and never revisited, pricing is complex by design, and the upcoming 2026 reforms make now a valuable moment to understand your stack. Keep it educational and inviting.",
  "executiveSummary": "3-4 paragraphs separated by \\n\\n, specific to this merchant's numbers but non-prescriptive. First: what we observed. Second: the main theme/issue. Third: where the opportunity appears to lie (sized in dollars where possible). Fourth: what a review with PaySwitch could help clarify.",
  "pricingModelAnalysis": "**Your Current Setup:**\\n\\n[plain-English explanation of how they appear to be charged]\\n\\n**Why This Matters:**\\n\\n[what it means for their costs]\\n\\n**What's Worth Understanding:**\\n\\n[observation about how this compares, no instruction]",
  "savingsOpportunity": "**Where The Opportunity Appears:**\\n\\n[specific maths grounded in their numbers]\\n\\n**What This Could Be Worth:**\\n\\n[sized, conservative]\\n\\n**A Conservative View:**\\n\\n[hedged lower-bound framing]",
  "lcrAnalysis": "**The Current Picture:**\\n\\n[plain explanation of routing and what their data suggests]\\n\\n**Why It Matters For You:**\\n\\n[dollar relevance, no instruction]",
  "benchmarkComment": "**Where You Sit:**\\n\\n[their effective rate vs the typical range for their size]\\n\\n**What Strong Looks Like:**\\n\\n[what better-positioned businesses of their size tend to pay]",
  "stackAssessment": "**The Overall Picture:**\\n\\n[paragraph]\\n\\n**What Appears To Be Working:**\\n\\n[paragraph]\\n\\n**Areas Worth A Closer Look:**\\n\\n[paragraph]",
  "nextStep1": "An area worth reviewing — observational, names no provider or specific action, one or two sentences.",
  "nextStep2": "A second area worth reviewing — same framing.",
  "nextStep3": "A third area worth reviewing — same framing.",
  "keyRecommendation": "The single highest-value area to explore, framed as an observation and an invitation to discuss with a PaySwitch advisor — not a specific instruction and naming no provider.",
  "alerts": [
    { "type": "warn | good | info", "heading": "Short Key Finding title (a few words)", "body": "1-2 plain-English sentences. Factual but interpreted using the benchmarks/context in the Knowledge Base. Non-prescriptive — point out the finding, don't instruct. Name no provider." }
  ],
  "stackItems": [
    { "label": "Component name (e.g. Pricing structure, Debit routing, Terminal, Monthly fees, Card mix)", "value": "Concise factual description of the merchant's current setup for this component, taken from the facts provided", "status": "ok | warn | gap" }
  ]
}

DERIVING alerts AND stackItems:
- Produce EXACTLY 3 "alerts" — the three most important Key Findings for this merchant, ordered most to least significant. Choose the "type" to reflect the finding (warn = a cost/risk worth attention, good = something working well, info = a neutral but notable observation). These are where your interpretation lives, but stay grounded in the merchant's actual facts and the Knowledge Base benchmarks; remain non-prescriptive.
- Produce 3 to 5 "stackItems" describing the merchant's current setup component-by-component. Assign "status" by comparing each component to the Knowledge Base benchmarks: ok = in line with or better than typical, warn = worth a closer look, gap = a clear shortfall or missed opportunity. The "value" must be factual (from the provided facts); the status is your judgement.`;

    const facts = report; // the analyser now returns facts only
    const cardMix = facts.cardMix || {};
    const cardMixStr = Object.entries(cardMix)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${v}%`)
      .join(', ') || '—';
    const feeBreakdownStr = Array.isArray(facts.feeBreakdown) && facts.feeBreakdown.length
      ? facts.feeBreakdown.map(f => `${f.label}: ${fmtD(f.amount)}`).join('\n')
      : '—';
    const setupStr = Array.isArray(facts.setup) && facts.setup.length
      ? facts.setup.map(s => `${s.label}: ${s.value}`).join('\n')
      : '—';
    const observationsStr = Array.isArray(facts.observations) && facts.observations.length
      ? facts.observations.map(o => `- ${o}`).join('\n')
      : '—';

    const userMessage = `Write a personalised payments review for this merchant, using ONLY the facts below plus the Knowledge Base for context, benchmarks and interpretation. The facts come from the merchant's own statement; everything interpretive (findings, opinions, narrative, framing) is yours to add.

STATEMENT FACTS:
Provider: ${facts.provider || '—'}
Period: ${facts.period || '—'}
Card volume: ${fmtD(facts.volume)}
Total fees: ${fmtD(facts.totalFees)}
Effective rate: ${fmtP(facts.effectiveRate)}
Transactions: ${facts.transactions || '—'}
Average transaction value: ${fmtD(facts.averageTransactionValue)}
Average fee per transaction (avg sale value × effective rate): ${fmtD(avgFeePerTxn)} — a DOLLAR value, NOT a fixed per-transaction fee
Monthly fee: ${fmtD(facts.monthlyFee)}
Terminal fees: ${fmtD(facts.terminalFees)}
Fixed per-transaction fee (if any): ${facts.perTransactionFee != null ? facts.perTransactionFee + 'c' : '—'}
Pricing model (observed): ${facts.pricingModel || '—'}
LCR status (observed): ${facts.lcrStatus || '—'}
Card mix: ${cardMixStr}

FEE BREAKDOWN (as printed):
${feeBreakdownStr}

CURRENT SETUP (factual components):
${setupStr}

FACTUAL OBSERVATIONS FROM THE STATEMENT:
${observationsStr}

MERCHANT PROFILE:
${programContext}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 12000, // headroom for the larger JSON (preamble + multi-paragraph fields)
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!claudeRes.ok) {
      const detail = await claudeRes.text();
      throw new Error(`Claude error: ${claudeRes.status} ${detail}`);
    }
    const claudeData = await claudeRes.json();

    if (claudeData.stop_reason === 'max_tokens') {
      console.warn('generate-report: narrative hit max_tokens — JSON may be truncated. Raise max_tokens.');
    }

    const rawText = claudeData.content?.find(b => b.type === 'text')?.text || '';
    let narrative;
    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd   = rawText.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('no JSON object found');
      narrative = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
    } catch (parseErr) {
      console.error('generate-report: failed to parse narrative JSON:', parseErr.message);
      console.error('Raw model output (first 500 chars):', rawText.slice(0, 500));
      throw new Error('Failed to parse narrative from model output');
    }

    // ── 4. Load the HTML template ─────────────────────────────────
    let html = buildTemplate();

    // ── 5. Helper to convert narrative text to HTML ───────────────
    function renderText(text) {
      if (!text) return '';
      return text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')   // **heading:** → <strong>
        .split('\n\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p style="margin-bottom:12px">${p}</p>`)
        .join('');
    }

    // ── 6. Build alert (Key Findings) replacements ────────────────
    // Findings are now produced by the generator (it has the Knowledge Base for
    // benchmark-based judgement). Colour follows the alert's OWN type.
    const alerts = Array.isArray(narrative.alerts) ? narrative.alerts : [];
    const alertClass = t =>
      t === 'good' ? 'alert-good' : t === 'warn' ? 'alert-warn' : 'alert-info';

    const alertReplacements = {};
    for (let i = 0; i < 3; i++) {
      const a = alerts[i] || {};
      alertReplacements[`{{key_finding_${i + 1}_class}}`]   = alertClass(a.type);
      alertReplacements[`{{key_finding_${i + 1}_heading}}`] = a.heading || '—';
      alertReplacements[`{{key_finding_${i + 1}_body}}`]    = a.body || '';
    }

    // ── 7. Build stack item replacements ──────────────────────────
    // Stack components + statuses are produced by the generator (status needs
    // Knowledge Base benchmarks). Status colour follows the item's OWN status.
    const stackItems  = Array.isArray(narrative.stackItems) ? narrative.stackItems : [];
    const statusLabel = { ok: '✓ OK', warn: '⚠ Review', gap: '✗ Gap' };
    const statusClass = { ok: 'td-status-ok', warn: 'td-status-warn', gap: 'td-status-gap' };
    const stackReplacements = {};
    for (let i = 0; i < 5; i++) {
      const item = stackItems[i] || { label: '—', value: '—', status: 'ok' };
      stackReplacements[`{{stack_item_${i + 1}_label}}`]        = item.label;
      stackReplacements[`{{stack_item_${i + 1}_value}}`]        = item.value;
      stackReplacements[`{{stack_item_${i + 1}_status}}`]       = statusLabel[item.status] || item.status;
      stackReplacements[`{{stack_item_${i + 1}_status_class}}`] = statusClass[item.status] || 'td-status-ok';
    }

    // ── 8. Merchant identity (from program context) ───────────────
    const merchantName  = programContext.match(/Name: (.+)/)?.[1]?.trim() || '—';
    const merchantEmail = programContext.match(/Email: (.+)/)?.[1]?.trim() || '—';

    // ── 9. Build full replacement map ─────────────────────────────
    const replacements = {
      '{{provider}}':               report.provider || '—',
      '{{period}}':                 report.period || '—',
      '{{effective_rate}}':         fmtP(report.effectiveRate),
      '{{total_fees}}':             fmtD(report.totalFees),
      '{{volume}}':                 fmtD(report.volume),
      '{{merchant_name}}':          merchantName,
      '{{merchant_email}}':         merchantEmail,
      '{{report_date}}':            today,
      '{{transactions}}':           report.transactions ? Number(report.transactions).toLocaleString('en-AU') : '—',
      '{{avg_fee_per_txn}}':        fmtD(avgFeePerTxn),
      '{{monthly_fee}}':            fmtD(report.monthlyFee),
      '{{terminal_fees}}':          fmtD(report.terminalFees),
      '{{pricing_model}}':          report.pricingModel || '—',
      '{{lcr_status}}':             report.lcrStatus || '—',
      '{{landscape_preamble}}':     renderText(narrative.landscapePreamble   || ''),
      '{{executive_summary}}':      renderText(narrative.executiveSummary     || ''),
      '{{pricing_model_analysis}}': renderText(narrative.pricingModelAnalysis || ''),
      '{{savings_opportunity}}':    renderText(narrative.savingsOpportunity   || ''),
      '{{lcr_analysis}}':           renderText(narrative.lcrAnalysis          || ''),
      '{{benchmark_comment}}':      renderText(narrative.benchmarkComment     || ''),
      '{{stack_assessment}}':       renderText(narrative.stackAssessment      || ''),
      '{{next_step_1}}':            narrative.nextStep1         || '',
      '{{next_step_2}}':            narrative.nextStep2         || '',
      '{{next_step_3}}':            narrative.nextStep3         || '',
      '{{key_recommendation}}':     narrative.keyRecommendation || '',
      ...alertReplacements,
      ...stackReplacements,
    };

    for (const [key, value] of Object.entries(replacements)) {
      html = html.split(key).join(value);
    }

    // ── 10. Store completed HTML in Supabase Storage ──────────────
    const timestamp    = Date.now();
    const safeName     = merchantName.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);
    const safeProvider = (report.provider || 'Unknown').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 20);
    const htmlPath     = `reports/${safeName}_${safeProvider}_${timestamp}.html`;

    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/statements/${htmlPath}`, {
      method: 'POST',
      headers: {
        apikey:         supabaseKey,
        Authorization:  `Bearer ${supabaseKey}`,
        'Content-Type': 'text/html',
        'x-upsert':     'true'
      },
      body: html
    });
    if (!uploadRes.ok) {
      const detail = await uploadRes.text();
      throw new Error(`Storage upload failed: ${uploadRes.status} ${detail}`);
    }

    // ── 11. Update submission status ──────────────────────────────
    await fetch(`${supabaseUrl}/rest/v1/submissions?id=eq.${submissionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization:  `Bearer ${supabaseKey}`
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
}

// ════════════════════════════════════════════════════════════════
//  HTML TEMPLATE
//  Page order: 1 Cover · 2 Landscape · 3 Exec Summary · 4 Fee Analysis
//              · 5 Savings/LCR/Benchmark · 6 Stack · 7 Opportunities · CTA
// ════════════════════════════════════════════════════════════════
function buildTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PaySwitch — Payments Review Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>

/* ── RESET & BASE ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #1a1a2e;
  background: #fff;
  font-size: 13px;
  line-height: 1.6;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── PAGE LAYOUT ── */
.page {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
  page-break-after: always;
}
.page:last-child { page-break-after: avoid; }

/* ── COVER PAGE ── */
.cover {
  background: #020408;
  min-height: 297mm;
  display: flex;
  flex-direction: column;
  padding: 14mm 16mm;
}
.cover-logo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: auto;
}
.cover-logo-mark { width: 32px; height: 32px; }

.cover-body { margin-top: auto; }

.cover-eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(58,138,255,0.8);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.cover-eyebrow::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(58,138,255,0.3);
}

.cover-title {
  font-size: 42px;
  font-weight: 800;
  color: white;
  letter-spacing: -0.04em;
  line-height: 1.05;
  margin-bottom: 8px;
}
.cover-title span { color: #3A8AFF; }

.cover-subtitle {
  font-size: 16px;
  font-weight: 300;
  color: rgba(200,210,240,0.55);
  margin-bottom: 40px;
}

.cover-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.08);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 40px;
}
.cover-stat { background: rgba(255,255,255,0.04); padding: 18px 20px; }
.cover-stat-val {
  font-size: 28px;
  font-weight: 700;
  color: white;
  letter-spacing: -0.04em;
  display: block;
  margin-bottom: 4px;
}
.cover-stat-lbl {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(200,210,240,0.35);
}

.cover-divider { height: 1px; background: rgba(255,255,255,0.08); margin-bottom: 28px; }

.cover-meta { display: flex; gap: 40px; margin-bottom: 28px; }
.cover-meta-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(200,210,240,0.28);
  margin-bottom: 4px;
}
.cover-meta-value { font-size: 13px; color: rgba(200,210,240,0.65); font-weight: 400; }

.cover-confidential {
  font-size: 9px;
  color: rgba(200,210,240,0.2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-top: 1px solid rgba(255,255,255,0.06);
  padding-top: 14px;
}

/* ── CONTENT PAGES ── */
.content-page {
  background: #fff;
  padding: 14mm 16mm 12mm;
  min-height: 297mm;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 2px solid #f0f2f7;
  margin-bottom: 28px;
}
.page-header-logo { font-size: 13px; font-weight: 800; color: #0d1628; letter-spacing: -0.01em; }
.page-header-logo span { color: #1A6BFF; }
.page-header-meta { font-size: 10px; color: #aab0c4; letter-spacing: 0.04em; }

.page-content { flex: 1; }

.page-footer {
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid #f0f2f7;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page-footer-left {
  font-size: 9px;
  color: #aab0c4;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.page-footer-right { font-size: 9px; color: #aab0c4; }

/* ── SECTIONS ── */
.section { margin-bottom: 28px; }
.section:last-child { margin-bottom: 0; }

.section-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #1A6BFF;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-label::after { content: ''; flex: 1; height: 1px; background: #e8ecf4; }

.section-title {
  font-size: 20px;
  font-weight: 700;
  color: #0d1628;
  letter-spacing: -0.03em;
  margin-bottom: 12px;
  line-height: 1.2;
}

.section-body { font-size: 13px; color: #3d4663; line-height: 1.75; }

.lead-in {
  font-size: 14px;
  color: #56607e;
  line-height: 1.7;
  margin-bottom: 22px;
  max-width: 60ch;
}

/* ── STAT CARDS ── */
.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.stat-card { background: #f7f9fc; border: 1px solid #e4e8f0; border-radius: 10px; padding: 16px 18px; }
.stat-card.dark { background: #0d1628; border-color: #0d1628; }
.stat-card.accent { background: #eef3ff; border-color: #c5d4f8; }
.stat-val {
  font-size: 24px;
  font-weight: 700;
  color: #0d1628;
  letter-spacing: -0.04em;
  display: block;
  margin-bottom: 3px;
}
.stat-card.dark .stat-val { color: white; }
.stat-val.high { color: #c0392b; }
.stat-val.mid  { color: #c8960c; }
.stat-val.low  { color: #0a7a52; }
.stat-lbl {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #7c8db0;
}
.stat-card.dark .stat-lbl { color: rgba(200,210,240,0.4); }

/* ── DATA TABLE ── */
.data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
.data-table th {
  padding: 8px 12px;
  text-align: left;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #7c8db0;
  border-bottom: 2px solid #e4e8f0;
  background: #f7f9fc;
}
.data-table td { padding: 10px 12px; border-bottom: 1px solid #f0f2f7; vertical-align: top; color: #3d4663; }
.data-table tr:last-child td { border-bottom: none; }
.data-table .td-label { color: #7c8db0; font-weight: 500; width: 42%; }
.data-table .td-value { font-weight: 600; color: #0d1628; }
.data-table .td-status-ok   { color: #0a7a52; font-weight: 700; text-align: center; }
.data-table .td-status-warn { color: #c8960c; font-weight: 700; text-align: center; }
.data-table .td-status-gap  { color: #c0392b; font-weight: 700; text-align: center; }

/* ── ALERT BOXES ── */
.alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.alert { padding: 12px 14px; border-radius: 6px; border-left: 4px solid; font-size: 12px; }
.alert-warn { background: #fdf6e3; border-color: #c8960c; }
.alert-good { background: #e8f5e9; border-color: #0a7a52; }
.alert-info { background: #eef3ff; border-color: #1A6BFF; }
.alert-heading { font-weight: 700; margin-bottom: 3px; font-size: 12px; }
.alert-warn .alert-heading { color: #92650a; }
.alert-good .alert-heading { color: #0a5c3e; }
.alert-info .alert-heading { color: #1a3a8a; }
.alert-body { color: #444; line-height: 1.55; }

/* ── OPPORTUNITIES ── */
.rec-list { display: flex; flex-direction: column; gap: 14px; }
.rec-item { display: flex; gap: 14px; align-items: flex-start; }
.rec-num {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #1A6BFF;
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.rec-body { flex: 1; font-size: 13px; color: #3d4663; line-height: 1.65; }
.rec-body strong { color: #0d1628; font-weight: 600; display: block; margin-bottom: 2px; }

.key-rec-box { background: #0d1628; border-radius: 10px; padding: 20px 22px; margin-top: 20px; }
.key-rec-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #3A8AFF;
  margin-bottom: 8px;
}
.key-rec-text { font-size: 14px; font-weight: 600; color: white; line-height: 1.45; letter-spacing: -0.01em; }

/* ── CTA PAGE ── */
.cta-page {
  background: #020408;
  min-height: 297mm;
  display: flex;
  flex-direction: column;
  padding: 14mm 16mm;
}
.cta-page-logo { font-size: 15px; font-weight: 800; color: white; letter-spacing: -0.02em; margin-bottom: auto; }
.cta-page-logo span { color: #3A8AFF; }
.cta-body { margin-top: auto; }
.cta-eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(58,138,255,0.7);
  margin-bottom: 18px;
}
.cta-title { font-size: 36px; font-weight: 800; color: white; letter-spacing: -0.04em; line-height: 1.08; margin-bottom: 16px; max-width: 480px; }
.cta-sub { font-size: 14px; font-weight: 300; color: rgba(200,210,240,0.55); line-height: 1.7; max-width: 440px; margin-bottom: 36px; }
.cta-divider { height: 1px; background: rgba(255,255,255,0.08); margin-bottom: 28px; }
.cta-contacts { display: flex; gap: 40px; margin-bottom: 28px; }
.cta-contact-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(200,210,240,0.28);
  margin-bottom: 4px;
}
.cta-contact-value { font-size: 13px; color: #3A8AFF; font-weight: 500; }
.cta-prepared { font-size: 11px; color: rgba(200,210,240,0.3); border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; }
.cta-confidential { font-size: 9px; color: rgba(200,210,240,0.15); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 10px; }

/* ── PRINT ── */
@media print {
  @page { size: A4; margin: 0; }
  body { margin: 0; }
  .page { page-break-after: always; width: 210mm; }
  .page:last-child { page-break-after: avoid; }
}

/* ── SCREEN PREVIEW ── */
@media screen {
  body { background: #e8ecf4; padding: 20px 0; }
  .page { box-shadow: 0 4px 32px rgba(0,0,0,0.15); margin-bottom: 20px; border-radius: 4px; }
}

</style>
</head>
<body>

<!-- ═══ PAGE 1 — COVER ═══ -->
<div class="page">
<div class="cover">
  <div class="cover-logo-row">
    <div style="font-size:20px;font-weight:800;color:white;letter-spacing:-0.02em">pay<span style="color:#3A8AFF">switch</span></div>
  </div>
  <div class="cover-body">
    <div class="cover-eyebrow">Payments Review Report</div>
    <div class="cover-title">Payments Stack<br><span>Analysis</span></div>
    <div class="cover-subtitle">{{provider}} &middot; {{period}}</div>
    <div class="cover-stats">
      <div class="cover-stat"><span class="cover-stat-val">{{effective_rate}}</span><span class="cover-stat-lbl">Effective Rate</span></div>
      <div class="cover-stat"><span class="cover-stat-val">{{total_fees}}</span><span class="cover-stat-lbl">Total Fees</span></div>
      <div class="cover-stat"><span class="cover-stat-val">{{volume}}</span><span class="cover-stat-lbl">Card Volume</span></div>
    </div>
    <div class="cover-divider"></div>
    <div class="cover-meta">
      <div><div class="cover-meta-label">Prepared for</div><div class="cover-meta-value">{{merchant_name}}</div></div>
      <div><div class="cover-meta-label">Report date</div><div class="cover-meta-value">{{report_date}}</div></div>
      <div><div class="cover-meta-label">Prepared by</div><div class="cover-meta-value">PaySwitch Advisory</div></div>
      <div><div class="cover-meta-label">Classification</div><div class="cover-meta-value">Confidential</div></div>
    </div>
    <div class="cover-confidential">
      This report is prepared exclusively for {{merchant_name}} and contains confidential commercial analysis. Not for distribution.
    </div>
  </div>
</div>
</div>

<!-- ═══ PAGE 2 — THE AUSTRALIAN PAYMENTS LANDSCAPE ═══ -->
<div class="page">
<div class="content-page">
  <div class="page-header">
    <div class="page-header-logo">pay<span>switch</span></div>
    <div class="page-header-meta">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>
  </div>
  <div class="page-content">
    <div class="section">
      <div class="section-label">The Australian Payments Landscape</div>
      <div class="section-title">Understanding what it costs to get paid</div>
      <div class="lead-in">Accepting card payments is now a core cost of doing business in Australia — yet it is one of the few costs many businesses set once and never revisit. Here is the bigger picture your own numbers sit within.</div>
      <div class="stat-row">
        <div class="stat-card dark"><span class="stat-val">$1.8B</span><span class="stat-lbl">Card surcharges paid each year</span></div>
        <div class="stat-card"><span class="stat-val">70% &rarr; 15%</span><span class="stat-lbl">Cash use, 2007 to 2025</span></div>
        <div class="stat-card accent"><span class="stat-val">1 Oct 2026</span><span class="stat-lbl">Major RBA reforms begin</span></div>
      </div>
      <div class="section-body">{{landscape_preamble}}</div>
    </div>
  </div>
  <div class="page-footer">
    <div class="page-footer-left">PaySwitch Advisory &middot; Confidential</div>
    <div class="page-footer-right">Page 2</div>
  </div>
</div>
</div>

<!-- ═══ PAGE 3 — EXECUTIVE SUMMARY ═══ -->
<div class="page">
<div class="content-page">
  <div class="page-header">
    <div class="page-header-logo">pay<span>switch</span></div>
    <div class="page-header-meta">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>
  </div>
  <div class="page-content">
    <div class="stat-row">
      <div class="stat-card dark"><span class="stat-val">{{effective_rate}}</span><span class="stat-lbl">Effective Rate</span></div>
      <div class="stat-card"><span class="stat-val">{{total_fees}}</span><span class="stat-lbl">Total Fees</span></div>
      <div class="stat-card accent"><span class="stat-val">{{volume}}</span><span class="stat-lbl">Card Volume</span></div>
    </div>
    <div class="section">
      <div class="section-label">Executive Summary</div>
      <div class="section-body">{{executive_summary}}</div>
    </div>
    <div class="section">
      <div class="section-label">Key Findings</div>
      <div class="alerts">
        <div class="alert {{key_finding_1_class}}">
          <div class="alert-heading">{{key_finding_1_heading}}</div>
          <div class="alert-body">{{key_finding_1_body}}</div>
        </div>
        <div class="alert {{key_finding_2_class}}">
          <div class="alert-heading">{{key_finding_2_heading}}</div>
          <div class="alert-body">{{key_finding_2_body}}</div>
        </div>
        <div class="alert {{key_finding_3_class}}">
          <div class="alert-heading">{{key_finding_3_heading}}</div>
          <div class="alert-body">{{key_finding_3_body}}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="page-footer">
    <div class="page-footer-left">PaySwitch Advisory &middot; Confidential</div>
    <div class="page-footer-right">Page 3</div>
  </div>
</div>
</div>

<!-- ═══ PAGE 4 — FEE ANALYSIS ═══ -->
<div class="page">
<div class="content-page">
  <div class="page-header">
    <div class="page-header-logo">pay<span>switch</span></div>
    <div class="page-header-meta">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>
  </div>
  <div class="page-content">
    <div class="section">
      <div class="section-label">Fee Analysis</div>
      <table class="data-table">
        <thead><tr><th style="width:42%">Component</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td class="td-label">Effective rate</td><td class="td-value">{{effective_rate}}</td></tr>
          <tr><td class="td-label">Total fees paid</td><td class="td-value">{{total_fees}}</td></tr>
          <tr><td class="td-label">Card volume processed</td><td class="td-value">{{volume}}</td></tr>
          <tr><td class="td-label">Total transactions</td><td class="td-value">{{transactions}}</td></tr>
          <tr><td class="td-label">Average fee per transaction</td><td class="td-value">{{avg_fee_per_txn}}</td></tr>
          <tr><td class="td-label">Monthly account fee</td><td class="td-value">{{monthly_fee}}</td></tr>
          <tr><td class="td-label">Terminal fees</td><td class="td-value">{{terminal_fees}}</td></tr>
          <tr><td class="td-label">Pricing model</td><td class="td-value">{{pricing_model}}</td></tr>
          <tr><td class="td-label">LCR status</td><td class="td-value">{{lcr_status}}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-label">Pricing Model Assessment</div>
      <div class="section-body">{{pricing_model_analysis}}</div>
    </div>
  </div>
  <div class="page-footer">
    <div class="page-footer-left">PaySwitch Advisory &middot; Confidential</div>
    <div class="page-footer-right">Page 4</div>
  </div>
</div>
</div>

<!-- ═══ PAGE 5 — SAVINGS & BENCHMARK ═══ -->
<div class="page">
<div class="content-page">
  <div class="page-header">
    <div class="page-header-logo">pay<span>switch</span></div>
    <div class="page-header-meta">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>
  </div>
  <div class="page-content">
    <div class="section">
      <div class="section-label">Opportunity Overview</div>
      <div class="section-body">{{savings_opportunity}}</div>
    </div>
    <div class="section">
      <div class="section-label">Least Cost Routing</div>
      <div class="section-body">{{lcr_analysis}}</div>
    </div>
    <div class="section">
      <div class="section-label">Market Benchmark</div>
      <div class="section-body">{{benchmark_comment}}</div>
    </div>
  </div>
  <div class="page-footer">
    <div class="page-footer-left">PaySwitch Advisory &middot; Confidential</div>
    <div class="page-footer-right">Page 5</div>
  </div>
</div>
</div>

<!-- ═══ PAGE 6 — PAYMENTS STACK ASSESSMENT ═══ -->
<div class="page">
<div class="content-page">
  <div class="page-header">
    <div class="page-header-logo">pay<span>switch</span></div>
    <div class="page-header-meta">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>
  </div>
  <div class="page-content">
    <div class="section">
      <div class="section-label">Payments Stack Assessment</div>
      <div class="section-body">{{stack_assessment}}</div>
    </div>
    <div class="section">
      <div class="section-label">Stack Component Review</div>
      <table class="data-table">
        <thead>
          <tr><th style="width:28%">Component</th><th>Current Setup</th><th style="width:14%;text-align:center">Status</th></tr>
        </thead>
        <tbody>
          <tr><td class="td-label">{{stack_item_1_label}}</td><td>{{stack_item_1_value}}</td><td class="{{stack_item_1_status_class}}">{{stack_item_1_status}}</td></tr>
          <tr><td class="td-label">{{stack_item_2_label}}</td><td>{{stack_item_2_value}}</td><td class="{{stack_item_2_status_class}}">{{stack_item_2_status}}</td></tr>
          <tr><td class="td-label">{{stack_item_3_label}}</td><td>{{stack_item_3_value}}</td><td class="{{stack_item_3_status_class}}">{{stack_item_3_status}}</td></tr>
          <tr><td class="td-label">{{stack_item_4_label}}</td><td>{{stack_item_4_value}}</td><td class="{{stack_item_4_status_class}}">{{stack_item_4_status}}</td></tr>
          <tr><td class="td-label">{{stack_item_5_label}}</td><td>{{stack_item_5_value}}</td><td class="{{stack_item_5_status_class}}">{{stack_item_5_status}}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="page-footer">
    <div class="page-footer-left">PaySwitch Advisory &middot; Confidential</div>
    <div class="page-footer-right">Page 6</div>
  </div>
</div>
</div>

<!-- ═══ PAGE 7 — OPPORTUNITIES IDENTIFIED ═══ -->
<div class="page">
<div class="content-page">
  <div class="page-header">
    <div class="page-header-logo">pay<span>switch</span></div>
    <div class="page-header-meta">Payments Stack Analysis &middot; Confidential &middot; {{report_date}}</div>
  </div>
  <div class="page-content">
    <div class="section">
      <div class="section-label">Areas to Explore</div>
      <div class="lead-in">These are areas where our analysis suggests there may be value worth examining more closely. They are starting points for a conversation, not prescribed changes — your PaySwitch advisor can work through what each could mean for your business.</div>
      <div class="rec-list">
        <div class="rec-item"><div class="rec-num">1</div><div class="rec-body">{{next_step_1}}</div></div>
        <div class="rec-item"><div class="rec-num">2</div><div class="rec-body">{{next_step_2}}</div></div>
        <div class="rec-item"><div class="rec-num">3</div><div class="rec-body">{{next_step_3}}</div></div>
      </div>
      <div class="key-rec-box">
        <div class="key-rec-label">Priority area to discuss</div>
        <div class="key-rec-text">{{key_recommendation}}</div>
      </div>
    </div>
  </div>
  <div class="page-footer">
    <div class="page-footer-left">PaySwitch Advisory &middot; Confidential</div>
    <div class="page-footer-right">Page 7</div>
  </div>
</div>
</div>

<!-- ═══ PAGE 8 — NEXT STEPS & CONTACT ═══ -->
<div class="page">
<div class="cta-page">
  <div style="font-size:16px;font-weight:800;color:white;letter-spacing:-0.02em">pay<span style="color:#3A8AFF">switch</span></div>
  <div class="cta-body">
    <div class="cta-eyebrow">Next Steps</div>
    <div class="cta-title">Let's turn these findings<br>into real savings.</div>
    <div class="cta-sub">This report shows where the opportunities appear to be. The next step is a conversation: your PaySwitch advisor will walk you through what each area means for your business and handle the specifics — what to change and how — at no cost to you. No lock-in contracts. No upfront fees.</div>
    <div class="cta-divider"></div>
    <div class="cta-contacts">
      <div><div class="cta-contact-label">Website</div><div class="cta-contact-value">payswitch.com.au</div></div>
      <div><div class="cta-contact-label">Email</div><div class="cta-contact-value">hello@payswitch.com.au</div></div>
    </div>
    <div class="cta-divider"></div>
    <div class="cta-prepared">
      Prepared for <strong style="color:rgba(200,210,240,0.55)">{{merchant_name}}</strong>
      &nbsp;&middot;&nbsp; {{merchant_email}} &nbsp;&middot;&nbsp; {{report_date}}
    </div>
    <div class="cta-confidential">Confidential &middot; PaySwitch Advisory &middot; Not for distribution</div>
  </div>
</div>
</div>

</body>
</html>`;
}
