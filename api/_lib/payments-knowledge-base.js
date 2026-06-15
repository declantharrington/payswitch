// api/_lib/payments-knowledge-base.js
// AUTO-GENERATED from docs/payments-knowledge-base.md — do not edit by hand.
// Edit the .md source of truth, then regenerate this module.
//
// Exported as a string so it bundles reliably with the serverless function
// (loose .md files are not guaranteed to be available at runtime on Vercel).

export const PAYMENTS_KB = `# PaySwitch Knowledge Base — The Australian Payments Landscape

**Purpose:** This is a grounding reference for the AI that analyses merchant statements (\`analyse.js\`) and writes client reports (\`generate-report.js\`). Everything below is calibrated to the Australian market as at **June 2026**. Feed it in as reference context so the model's claims, benchmarks and savings maths are accurate, current, and specific rather than generic.

**How to wire it in:**
- Prepend the relevant sections to the \`system\` prompt in **both** endpoints, or pass as a leading reference block in the user message. The *Statement interpretation* and *Accuracy guardrails* sections matter most for \`analyse.js\`; the *Regulatory reform*, *Benchmarks* and *Savings levers* sections matter most for \`generate-report.js\`.
- When a report makes a numerical claim (a benchmark, a cap, a saving), it should be traceable to a figure in this document. If a figure isn't here and isn't on the merchant's statement, the model should hedge ("typically", "in the order of") rather than invent precision.
- **Currency of figures:** The 2026 RBA reforms have hard commencement dates (1 Oct 2026 and 1 Apr 2027). Until those dates the *current* caps still apply. Reports should distinguish "what you pay today" from "what changes on [date]". Carry this distinction everywhere — it is the single biggest source of value PaySwitch can articulate right now.
- **How the report should read:** Before writing anything for \`generate-report.js\`, read the **Report philosophy, tone and structure** section immediately below. It governs the stance (educational, not prescriptive), the reading level, and the required landscape preamble.

---

## ★ Report philosophy, tone and structure (read first for \`generate-report.js\`)

This section governs *how* the client-facing report is written. It applies to every narrative field the model produces.

### Stance: open eyes, don't prescribe

The report's job is to **help the merchant see where money may be leaking and where opportunities exist — not to tell them exactly what to do about it.** PaySwitch delivers the specific solution (which provider, which plan, which change, and the implementation) as a consultant, in person. The written report is the diagnostic that earns that conversation.

In practice this means:
- **Surface, don't solve.** Frame findings as observations and questions worth exploring, not instructions. Write "your debit transactions appear to be routed via the international networks, which is typically a more expensive path — an area worth reviewing" rather than "switch on least-cost routing with provider X."
- **Quantify the opportunity, withhold the method.** It's good to say "businesses of your size and profile often pay materially less than this" or "this points to a potential saving in the order of $X per year." It's not the report's place to say *how* to capture it. The size of the prize creates the motivation to talk to PaySwitch; the method is the paid advice.
- **No named providers, no named products, no specific switching instructions** in the report. Keep it vendor-neutral. Recommendations of who to move to, what plan to adopt, or what to renegotiate are delivered by the consultant.
- **Reframe any "recommendation" or "next step" field accordingly.** Where the template asks for next steps or a key recommendation, populate them as *areas warranting review* or *questions to bring to a payments review*, phrased as observations — e.g. "A review of how your debit transactions are routed could be worthwhile" — not as directives. The single "priority" item should read as the highest-value area to explore, framed as an invitation to discuss, ending naturally toward a conversation with a PaySwitch advisor.

> **Note on the current template:** \`generate-report.js\` requests \`nextStep1/2/3\` and \`keyRecommendation\`, and the HTML has a "Recommendations" / "Priority recommendation" page. Under this philosophy those should be *opportunity and review-area* statements, not prescriptive actions. If you want the structure to match the stance more closely, consider relabelling that page "Areas to Explore" or "Opportunities Identified" and softening the priority box to a "Priority area to discuss."

### Reading level: written for a non-expert

The reader is typically a business owner who does **not** know payments jargon. The writing should be detailed and professional, but immediately understandable to a layperson.
- **Explain every concept in plain English the first time it appears.** Don't assume the reader knows what interchange, scheme fees, routing, blended pricing or effective rate mean. A one-line plain explanation alongside the term is enough (e.g. "interchange — the wholesale fee your provider passes through to the card-issuing bank").
- **Lead with the dollar impact, then the mechanism.** Owners care about money and risk first, mechanics second.
- **Use concrete, relatable framing.** "On every $100 you take by card, roughly $X goes to fees" lands better than an abstract percentage alone.
- **Avoid acronyms unless introduced.** Spell things out; if an acronym is used later, define it on first use.
- **Keep sentences short and the tone calm and authoritative** — a trusted adviser explaining, not a vendor selling.

### Visual comprehension

The report should be easy to absorb visually as well as textually:
- Short paragraphs (the template already enforces double-newline breaks — keep each point to 2–4 sentences).
- Use the headed sub-blocks the template supports (e.g. "Current situation", "Why this matters", "The opportunity") so a skim-reader can follow the logic.
- Let the stat cards, tables and alert boxes carry the numbers; let the prose carry the meaning. Don't repeat long figures in sentences when they're already shown in a card.
- One idea per section. If a section is doing two jobs, split it.

### Required opening: the landscape preamble

Early in the report — before diving into the merchant's own numbers — include a short **preamble that orients the reader in the Australian payments landscape** and explains why reviewing their payments stack matters. It should:
- Briefly set the scene: card payments are now how most Australians pay, and the cost of accepting them is a real, often-overlooked business expense.
- Call out a few genuinely interesting, credibility-building stats (drawn from this document), for example: Australians pay an estimated ~$1.8 billion a year in card surcharges; cash has fallen from ~70% of in-person payments in 2007 to ~15% in 2025; small businesses often pay roughly double the card-acceptance rate of large ones for the same sale; and a major RBA reform package lands on 1 October 2026 that removes surcharging and cuts the wholesale fees built into card costs.
- Make the "why review" case: payment costs are frequently set once and never revisited, pricing is complex and opaque by design, and the upcoming reforms make right now an unusually valuable moment to understand your stack.
- Stay general and educational here — this is scene-setting, not yet about the specific merchant. Keep it to a few tight paragraphs that make the reader think "I should understand this better," which is exactly the door PaySwitch walks through.

---

## 1. How the Australian card system actually works

Australia runs predominantly on a **four-party model** for Visa, Mastercard and eftpos. Understanding who pays whom is the foundation for reading any statement correctly.

The four parties on a card transaction:
1. **Cardholder** — the consumer paying.
2. **Issuer** — the cardholder's bank (issued the card).
3. **Acquirer** — the merchant's payments provider (settles funds to the merchant). Examples: CBA, NAB, Westpac, ANZ Worldline, Tyro, Square, Stripe, Zeller, Adyen, Fiserv.
4. **Card network / scheme** — Visa, Mastercard, or eftpos (eftpos is now part of Australian Payments Plus, "AP+").

**American Express is a three-party model** — Amex is both the network and (usually) the issuer. This is why Amex sits *outside* the RBA's interchange regulation, and why Amex acceptance generally costs merchants more for domestic cards. Keep this distinction sharp: interchange caps do **not** apply to Amex.

The money flow on a $100 four-party card sale, simplified:
- The merchant receives ~$98.50 (illustrative). The ~$1.50 "merchant service fee" (MSF) is split three ways:
  - **Interchange fee** → paid by the *acquirer* to the *issuer*. The largest and most regulated component.
  - **Scheme fees** → paid to *Visa/Mastercard/eftpos* by both acquirer and issuer.
  - **Acquirer margin** → the provider's own markup (their revenue).

The merchant only ever sees the *total* MSF unless they're on a transparent (unbundled) plan. The consulting job is to decompose that MSF and show the merchant which part is regulated wholesale cost (hard to change) versus acquirer margin and avoidable routing cost (very changeable).

---

## 2. Anatomy of the merchant service fee (MSF)

Every dollar of fee a merchant pays falls into one of these buckets. A good report names them explicitly.

| Component | Paid to | Regulated? | Changeable by the merchant? |
|---|---|---|---|
| **Interchange** | Issuer (via acquirer) | Yes — RBA caps | Indirectly: via card mix, LCR, and being on a plan that passes through reductions |
| **Scheme fees** | Visa / Mastercard / eftpos | Lightly (transparency only) | Mostly no, but network routing (LCR) changes which scheme is billed |
| **Acquirer margin** | The merchant's provider | No | Yes — this is the negotiable part |
| **Fixed/ancillary fees** | Provider | No | Yes — terminal rental, monthly minimums, PCI fees, paper statement fees, gateway fees |

**Effective rate** = total fees ÷ total card turnover, expressed as a percentage. It's the single most useful headline number because it bundles everything (including fixed fees) into one comparable figure. Caveat: for **low-volume merchants**, fixed monthly fees inflate the effective rate dramatically, so a high effective rate on low turnover is often a *fixed-cost* problem, not a *rate* problem — say so rather than implying the per-transaction pricing is bad.

---

## 3. Interchange caps — current and the 2026/27 reforms (THE core reference)

This is the most important table in the document. The RBA published its final **Conclusions Paper** on **31 March 2026** following its *Review of Merchant Card Payment Costs and Surcharging*. The reforms are confirmed, not proposed.

### Current caps (apply until 30 September 2026)

| Card type | Cap (current) | Weighted-average benchmark (current) |
|---|---|---|
| Domestic debit & prepaid | 10c fixed, or 0.20% ad valorem | 8c |
| Domestic credit (consumer + commercial) | 0.80% | 0.50% |
| Foreign-issued cards | *Unregulated* | — |

### New caps (domestic from **1 October 2026**; foreign from **1 April 2027**)

| Card type | New cap | Benchmark | Commences |
|---|---|---|---|
| Domestic debit & prepaid | **8c** fixed (or **0.16%** ad valorem) | Stays at **8c** (SNDC sub-benchmark also 8c) | 1 Oct 2026 |
| Domestic **consumer** credit | **0.30%** | **Abolished** (cap-only) | 1 Oct 2026 |
| Domestic **commercial** credit | **0.80%** (unchanged) | **Abolished** (cap-only) | 1 Oct 2026 |
| **Foreign-issued** cards (all types, card-present & online) | **1.00%** | n/a | 1 Apr 2027 |

**What this means in plain terms:**
- **Consumer credit is the headline cut** — the per-transaction cap more than halves from 0.80% to 0.30%. Small merchants benefit most because they currently sit at or near the 0.80% cap.
- **Debit barely moves** at the benchmark level (stays 8c) but the *cap* drops from 10c/0.20% to 8c/0.16%, compressing the gap between what small merchants and large "strategic" merchants pay.
- **Commercial credit stays at 0.80%** — deliberately, to keep four-party networks competitive with Amex in the business-card segment. If a merchant takes a lot of business/corporate cards, their blended credit cost won't fall as much as a consumer-heavy merchant's.
- **Foreign cards get capped for the first time at 1.00%** from April 2027. Today they're unregulated and average ~1.75%. This is a major, under-appreciated win for tourism, hospitality and online merchants with overseas customers.

### Reference points the model can cite for credibility

- Average **consumer credit** interchange today is ~**0.47%**; small merchants pay up to **0.80%**, while the largest merchants on strategic rates pay as little as **~0.18%**. (This dispersion is the cross-subsidy story: small merchants subsidise large ones.)
- Average **four-party commercial credit** interchange is ~**0.78%**.
- Weighted-average **debit** interchange is already ~**6c** (below the 8c benchmark), driven by competition and LCR.
- **Foreign-issued cards** are only ~**3%** of transactions but ~**20%** of all interchange merchants pay.
- The RBA's own **eligible issuer cost** estimates (the cost floor the caps are built on): debit ~**7c (0.13%)**, consumer credit ~**0.20%**, commercial credit ~**0.19%**, foreign ~**0.31–0.57%**. Useful for explaining *why* the cuts are justified: merchants are currently paying well above issuers' actual costs.
- The RBA estimates the reforms lower wholesale costs for merchants by ~**$910 million per year**.

---

## 4. Surcharging — the 2026 removal (huge talking point)

**From 1 October 2026, surcharging on eftpos, Mastercard and Visa (debit, prepaid AND credit) is being removed.** The RBA is lifting the prohibition on "no-surcharge" rules, and expects the networks to then ban surcharging outright. If that doesn't happen voluntarily, the government may legislate a ban.

Context the model can use:
- Australians pay an estimated **~$1.8 billion in card surcharges per year**, ~**$1.6 billion** of it borne by consumers.
- About **16% of merchants** currently surcharge. The other ~84% already absorb card costs into their prices.
- The framework is being scrapped because it no longer steers behaviour: most surcharging merchants apply a single blended rate across all cards, signage compliance is poor, and cash use has collapsed (cash was ~70% of in-person payments in 2007, ~15% in 2025).

**What this means for a merchant report:**
- If the merchant **currently surcharges**, this is a strategic flag: from 1 Oct 2026 they must either absorb card costs into margin or fold them into advertised prices. Getting their underlying MSF down *before* that date directly protects margin. This is a natural PaySwitch engagement hook.
- If the merchant **doesn't surcharge**, the message is simpler: lower interchange flows straight to their bottom line, provided their acquirer passes it through (see pass-through below).
- Merchants retain the right to offer **discounts** for preferred payment methods (e.g. a cash or account-to-account discount) — that's not banned.

---

## 5. Least-cost routing (LCR) — the most common avoidable cost

LCR ("merchant choice routing") lets a merchant send a **dual-network debit card (DNDC)** transaction down the **cheaper** network — almost always **eftpos** instead of Visa/Mastercard debit. Around **90% of Australian debit cards are DNDCs**, so most debit volume is routable.

**Why it matters:** the RBA estimates accepting debit costs **~20% less** for merchants with LCR on versus off. For a debit-heavy merchant, enabling LCR is frequently the single biggest quick win on the whole statement.

**Status as at June 2026 (latest RBA data, December 2025):**
- **In-person LCR:** enabled for **84%** of merchants (up from 50% in mid-2022). Widely available.
- **Online (card-not-present) LCR:** now available to **97%** of merchants and take-up rising, but still patchy — gateways and third parties are the bottleneck.
- **Mobile-wallet LCR:** the "final frontier". Mobile wallets are ~**40% of in-person transactions**, so debit volume locked inside Apple Pay / Google Pay often *can't* be routed to eftpos yet. This is where a lot of theoretical LCR savings still leak.
- The RBA kept LCR on an **expectations basis, not a mandate**. It did **not** mandate online/mobile-wallet LCR; that question is deferred to a consultation starting **mid-2026**. So don't tell a merchant LCR is "required" online — it's expected and improving, not law.

**LCR red flags to look for on a statement:**
- Debit transactions billed predominantly via "Visa Debit" / "Debit Mastercard" rather than eftpos → LCR likely off or not optimised.
- A **single-rate/flat plan** (see §7) — these usually *can't* benefit from LCR at all because everything is one price; the merchant pays the same whether the cheaper network was used or not.
- High in-store debit share + high effective debit cost → quantify the ~20% potential reduction on the debit component.

---

## 6. Cost-of-acceptance benchmarks (use these to position the merchant)

These RBA averages let a report say "you're paying X% versus the Y% typical for a business your size." Always frame as *typical/average*, not a guarantee.

| Merchant profile | Typical cost of acceptance (% of turnover) |
|---|---|
| **Small** merchant, **single-rate/blended** plan | ~**1.4%** |
| **Small** merchant, **unblended** (interchange-plus) plan | ~**0.9%** |
| **Large** merchant (typically unblended, strategic rates) | ~**0.6%** |

Supporting facts:
- Only ~**19% of small merchants** are on unblended plans — meaning the majority of small businesses are on the more expensive single-rate structure and often **don't realise a cheaper structure exists**. This is the core small-merchant value proposition.
- The dispersion *within* small merchants is large — two similar shops can pay very different rates purely due to plan type and provider. Transparency reform (below) is designed to expose this.

**Interpreting effective rate against these benchmarks:**
- Small merchant at **>1.4%** → almost certainly on a single-rate plan and/or carrying fixed fees; strong savings case.
- Small merchant at **~0.9–1.0%** → likely already unblended; savings come from margin negotiation, LCR optimisation, and card-mix, not a wholesale plan change.
- Anyone **below ~0.6%** → already sharp; be honest that the win is incremental (and the 2026 reforms will help them automatically).

---

## 7. Pricing models — how to identify which one the merchant is on

Identifying the pricing model from the statement is the most important analytical step, because it determines *which* savings levers are even available.

**1. Interchange-plus-plus (IC++)** — the most transparent. Statement itemises interchange + scheme fees + a fixed acquirer margin separately. Common for larger/sophisticated merchants. *Lever:* negotiate the margin; everything else is wholesale.

**2. Interchange-plus (IC+)** — interchange passed through at cost + a single acquirer markup (scheme fees often folded into the markup). *Lever:* margin negotiation; benefits automatically from interchange cuts.

**3. Bundled / blended** — one rate per card *category* (e.g. "Visa/MC credit 1.5%, debit 0.5%, Amex 1.8%"). Less transparent; the merchant can't see interchange vs margin. *Lever:* move to unblended to capture true wholesale + LCR.

**4. Single-rate / flat / simple** — **one** rate for everything regardless of card type (e.g. a flat ~1.5–1.6% tap rate). Simple and predictable, popular with micro-merchants (Square, Zeller flat plans). **The merchant overpays on cheap debit and gets no LCR benefit.** *Lever:* if debit-heavy, switching to unblended + LCR is often a large saving — this is the classic small-merchant finding.

**5. Subscription / fixed-monthly + low per-transaction** — a monthly fee buys lower transaction rates. *Lever:* only worth it above a turnover break-even; below it, the merchant is overpaying on fixed cost.

**Tell-tale signs on a statement:**
- One line, one rate, all cards → single-rate.
- Separate debit% and credit% only → blended.
- Line items for "interchange", "scheme fees" and "acquirer/processing margin" → unblended (IC+/IC++).
- A flat monthly charge that dominates a low-turnover statement → subscription or fixed-fee heavy.

---

## 8. Scheme fees (the quietly growing component)

Scheme fees are what Visa, Mastercard and eftpos charge for using their networks. They're separate from interchange, and they've been **rising and growing in complexity** for years. The RBA's 2026 reforms target them with **transparency** measures rather than caps:
- Networks must **publish** their interchange and scheme fees.
- Networks must **simplify** scheme fee schedules and **justify** increases to PSPs.
- This is designed to let acquirers scrutinise and push back, with savings flowing to merchants over time.

For reports: scheme fees are largely non-negotiable for the merchant directly, but on a **bundled** plan they're invisible and can hide margin. Moving to unblended at least makes them visible. Don't promise scheme-fee savings — frame them as a transparency/structural point.

---

## 9. Transparency reforms (from 1 Oct 2026, some from 1 Apr 2027)

These create concrete reasons for a merchant to shop around — and concrete tools PaySwitch can use:
- **Large acquirers** (processing **>$10 billion/year**, ~1% market share) must **publish their average cost of acceptance quarterly**, broken down by card type (debit/prepaid vs credit), card origin (domestic vs foreign), and merchant size (small/medium/all). The RBA will republish this — effectively a public league table of acquirer pricing.
- Acquirers must **publish merchant service fees and a measure of interchange pass-through**, so merchants can see which providers actually pass on the interchange cuts.
- **Pass-through monitoring:** the RBA will actively monitor and call out acquirers who *don't* pass interchange reductions through. This matters because a merchant on a **fixed/bundled** plan may **not** automatically receive the Oct 2026 interchange cut — the acquirer could simply keep the difference. Flagging this is high-value: "your interchange is dropping on 1 Oct 2026, but on your current plan structure that saving may not reach you unless your provider passes it on."

---

## 10. The Australian acquirer / PSP landscape (orientation)

The model should recognise providers and roughly where they sit. **Do not quote specific current pricing from memory** — provider rates change; rely on what's on the merchant's actual statement. Use this only for context and tone.

- **Major banks** — CBA, NAB, Westpac, ANZ (ANZ Worldline). Traditional acquiring, terminal fleets, often bundled/blended pricing for SMBs; competitive unblended deals for larger merchants.
- **Tyro** — ASX-listed, SME-focused (health, hospitality, retail), integrated EFTPOS.
- **Square (Block)** — flat-rate, micro/small merchants, all-in simplicity, strong LCR enablement.
- **Zeller** — Australian challenger, SMB, flat and custom plans.
- **Stripe** — online-first, developer/platform merchants, card-not-present.
- **Fat Zebra** — Australian-owned, independent payments company focused on **online / card-not-present** payments. Operates as both a **payment gateway** and an **acquirer/processor**, and runs an orchestration-style "connected platform" that can route across multiple acquirers, banks and schemes (with local routing/data residency, LCR, network tokenisation, 3DS2 and fraud tools). Processes hundreds of millions of transactions a year for tens of thousands of merchants and platforms, including some well-known Australian brands. Has consolidated several local players (Pin Payments, SecurePay, Adatree), so a merchant's gateway may be "Fat Zebra" under one of those legacy brands. **Crucially, Fat Zebra can be used as a gateway on top of a merchant's *existing* acquiring relationship** (see the multi-provider note below) — this is a common e-commerce setup.
- **Adyen** — enterprise/global, unblended, large merchants.
- **Fiserv, Suncorp**, and others — long tail of acquiring.
- **Schemes:** Visa, Mastercard, **eftpos** (now under **Australian Payments Plus / AP+**, which also runs BPAY and the New Payments Platform). **Amex** as three-party.

Account-to-account rails (**NPP / PayTo**) are an emerging lower-cost alternative for some flows (recurring, invoicing, B2B) and worth mentioning where relevant, especially for merchants with high commercial-card or invoice volume.

### Multiple providers: gateway vs acquirer (and why one statement may not tell the whole story)

A common and important misconception is that a merchant has *one* payments provider. In reality — **especially for online businesses** — the payments stack is often split across **separate providers** doing different jobs:

- The **acquirer** (e.g. Westpac, CBA, NAB, ANZ Worldline) settles the funds and is where interchange, scheme fees and the acquirer margin are charged. This is the "merchant statement" most people think of.
- The **payment gateway** (e.g. Fat Zebra, or a bank's own gateway) is the technical layer that captures the card details online, handles fraud screening, tokenisation, 3DS2 authentication and routing. The gateway typically charges its **own monthly fee and/or per-transaction fee**, billed **separately**.

So a merchant could run, for example, a **Fat Zebra gateway connected to Westpac acquiring**. In that setup:
- The **Westpac merchant statement** shows the acquiring costs (interchange, scheme fees, acquirer margin) — but it will **not** show the Fat Zebra gateway's per-transaction fee or monthly fee, because Fat Zebra bills those independently.
- (Indicatively, Fat Zebra publicly lists a gateway-only option that sits on an existing acquiring relationship from around $250/month plus ~$0.30 per transaction — treat this only as an illustration of *how gateway fees are structured*; do not quote it as the merchant's actual cost. Verify against their real invoices.)

**Why this matters analytically (critical):**
- An **effective rate calculated only from the acquirer statement will understate the merchant's true total cost of acceptance**, sometimes substantially, because the gateway fees live on a different invoice. For an online merchant with many small transactions, a $0.30 per-transaction gateway fee can dwarf the acquiring percentage cost.
- When analysing an **online / card-not-present** merchant, the report should flag (gently, per the philosophy) that the picture may be incomplete if only one provider's statement was supplied — e.g. "for online sales there is often a separate gateway cost that doesn't appear on this statement; understanding the full stack is an area worth reviewing."
- A multi-provider setup is also an **opportunity signal**: gateway and acquiring can sometimes be consolidated or re-tendered separately, and the merchant may not realise the two are unbundled. The report should surface this as an area to explore, not prescribe a consolidation.

---

## 11. Reading a statement — checklist and red flags

When analysing, work through:
1. **Turnover and transaction count** → average transaction value. (Low ATV + per-item fees = debit/LCR sensitivity; high ATV + credit mix = interchange sensitivity.)
2. **Effective rate** = total fees ÷ card turnover. Compare to the §6 benchmark for the merchant's size.
3. **Pricing model** (§7) — determines available levers.
4. **Card mix** — debit vs credit vs Amex vs foreign. Drives where the cost sits and which 2026 reform helps.
5. **LCR status** (§5) — is debit going to eftpos?
6. **Fixed/ancillary fees** — terminal rental, monthly minimums, PCI non-compliance, paper statement, gateway, minimum merchant service fee. These are pure avoidable cost on many statements.
7. **Surcharging setup** — present? Will be non-compliant from Oct 2026.
8. **Foreign card share** — tourism/online exposure → April 2027 cap is a big future saving.
9. **Is the stack complete?** Especially for online merchants — does this statement represent the *whole* cost, or could there be a separate **gateway** provider billing its own monthly and per-transaction fees elsewhere (§10)? If the merchant takes online payments and the statement shows no gateway line, the true cost of acceptance is probably higher than the statement implies. Note the gap rather than guessing the amount.

**Common red flags:**
- Single-rate/flat plan on a debit-heavy, in-store business.
- LCR off or debit routed to scheme networks.
- Premium/rewards-card-heavy mix inflating credit interchange (relief coming Oct 2026).
- Terminal *rental* where outright purchase or a no-rental provider is cheaper over the contract.
- Minimum monthly fees the merchant never reaches.
- PCI non-compliance fees (avoidable by completing self-assessment).
- A bundled plan where interchange cuts may not pass through.

---

## 12. The PaySwitch savings playbook (lever → when it applies → how to size it)

*Internal analytical reference.* These levers are how PaySwitch (and the analysis step) identifies and sizes opportunities. In the **client-facing report**, surface the *opportunity and its likely size* but **not the specific lever or method** — per the report philosophy, naming the fix is the consultant's job. E.g. the report says "an area worth reviewing that could be worth ~$X/year," not "enable least-cost routing."

| Lever | Applies when | How to quantify |
|---|---|---|
| **Enable / optimise LCR** | Debit-heavy, DNDCs, LCR off or scheme-routed | ~20% of the debit cost component (RBA estimate); size against debit turnover |
| **Switch single-rate → unblended (IC+/IC++)** | Small merchant on flat/blended plan | Gap between ~1.4% (blended) and ~0.9% (unblended) on small turnover; refine with actual card mix |
| **Negotiate acquirer margin** | Already unblended | The margin line is the only soft part; benchmark vs market |
| **Remove avoidable fixed fees** | Terminal rental, monthly minimums, PCI, statement fees | Direct dollar removal — often the easiest, cleanest saving |
| **Card-mix / interchange optimisation** | Credit/rewards-heavy | Consumer credit cap → 0.30% from 1 Oct 2026; model the before/after on credit turnover |
| **Foreign-card cap (future)** | Tourism, hospitality, cross-border online | Foreign interchange ~1.75% today → capped at 1.00% from 1 Apr 2027; size against foreign turnover |
| **Ensure pass-through** | Bundled/fixed plans | Interchange cut may be retained by acquirer; switching or renegotiating captures it |
| **A2A / PayTo for suitable flows** | Recurring, invoicing, B2B, commercial-card-heavy | Avoids card rails entirely on those flows |

**Sizing a saving honestly:** total fees − (turnover × achievable effective rate) = annual saving. Use *conservative* achievable rates (lean toward the higher/benchmark end), state assumptions, and separate "available today" from "available after [reform date]". Over-promising destroys credibility and the reports are client-facing.

---

## 13. Accuracy guardrails for the AI (read before writing any number)

These prevent the most common and most damaging errors.

- **Per-transaction fee units.** On a statement, fixed per-item fees are quoted in **cents** (e.g. "8c per transaction"), not dollars. Separately, the pipeline computes an *average MSF per transaction* as \`turnover ÷ transactions × effective rate\` — that result is a **dollar** value (the average fee on an average sale), **not** the fixed cents-based interchange. Never conflate the two. If you state a cents-based interchange figure, label it in cents; if you state an average fee per sale, label it in dollars.
- **Interchange ≠ scheme fees ≠ acquirer margin.** Three different recipients (issuer, network, provider). Don't merge them or attribute interchange revenue to the acquirer.
- **Caps are ceilings, benchmarks are weighted averages.** A cap limits any single category's rate; a benchmark limits the weighted average across categories. Don't describe a cap as "the rate everyone pays" — actual rates often sit below the cap.
- **Effective rate includes fixed fees.** For low-turnover merchants this inflates it; diagnose whether the problem is *rate* or *fixed cost* before recommending a plan change.
- **One statement may not be the whole cost.** A merchant can have a **separate gateway provider** (e.g. Fat Zebra) sitting on top of their acquirer (e.g. Westpac). Gateway monthly and per-transaction fees are billed independently and **won't appear on the acquirer statement**. Don't present an acquirer-only effective rate as the merchant's total cost of acceptance for an online business — note that a gateway cost may sit outside the figures shown.
- **Reform dates are firm but future.** Domestic interchange cuts and surcharging removal: **1 October 2026**. Foreign-card cap and some transparency rules: **1 April 2027**. Until then, current caps apply. Always phrase as "from [date]", never as already in effect.
- **Amex is unregulated.** Interchange caps do not touch Amex. Don't apply the 0.30%/0.80% logic to Amex lines.
- **LCR online/mobile is not mandated.** It's expected and improving, with a mid-2026 consultation pending. Don't claim it's legally required online.
- **Commercial vs consumer credit.** The 0.30% cut is **consumer** credit only. Commercial/business credit stays at **0.80%**. If the merchant is B2B or takes many corporate cards, their credit saving is smaller — say so.
- **Don't invent provider pricing.** Use the merchant's actual statement figures. Only use the benchmark ranges in this document for *comparison*, clearly labelled as typical/average.
- **Hedge unsupported precision.** If a figure isn't on the statement or in this document, use "typically/around/in the order of" rather than a fabricated exact number.

---

## 14. Quick glossary

- **MSF** — Merchant Service Fee: the total cost a merchant pays to accept card payments.
- **Interchange** — fee the acquirer pays the issuer; the regulated core of the MSF.
- **Scheme fees** — network (Visa/Mastercard/eftpos) charges; rising, complex, transparency-targeted.
- **Acquirer margin** — the provider's markup; the negotiable part.
- **Acquirer** — the provider that settles card funds to the merchant and bills interchange, scheme fees and margin (the "merchant statement").
- **Payment gateway** — the technical layer that captures and authorises online card payments (fraud screening, tokenisation, 3DS2, routing). Often a *separate* provider from the acquirer, with its own monthly and per-transaction fees billed independently.
- **Orchestration / connected platform** — a layer that routes transactions across multiple acquirers, banks and schemes for performance, cost and redundancy (e.g. Fat Zebra's connected platform).
- **Effective rate** — total fees ÷ card turnover, as a %.
- **DNDC** — Dual-Network Debit Card (carries eftpos + Visa/Mastercard debit); ~90% of AU debit cards.
- **SNDC** — Single-Network Debit Card (one network only); more common among small/customer-owned bank issuers.
- **LCR / MCR** — Least-Cost Routing / Merchant Choice Routing: send DNDC debit down the cheaper network.
- **CP / CNP** — Card-Present / Card-Not-Present (in-person vs online).
- **Ad valorem** — a percentage-of-value fee (vs a fixed cents fee).
- **Unblended** — pricing that passes interchange through and itemises components (IC+/IC++).
- **Single-rate / blended** — one rate across cards (or per category); hides components, blocks LCR benefit.
- **Strategic rates** — discounted interchange categories networks offer large merchants; source of the small-vs-large cross-subsidy.
- **PSB** — Payments System Board (the RBA body that sets these standards).
- **AP+** — Australian Payments Plus, operator of eftpos, BPAY and the NPP.
- **NPP / PayTo** — New Payments Platform and its account-to-account mandate service; non-card rails.

---

## 15. Source note

Regulatory figures and effective dates are drawn from the RBA's *Review of Merchant Card Payment Costs and Surcharging — Conclusions Paper* (31 March 2026) and the RBA's least-cost routing implementation data (December 2025, published March 2026). Cost-of-acceptance averages are the RBA's published figures. Verify against the latest RBA publications before each reporting cycle, as the post-reform monitoring data (pass-through league tables, updated cost-of-acceptance) will be republished quarterly from late 2026.
`;
