// api/analyse.js
//
// This is the PROXY endpoint. It receives { system, messages, model?, max_tokens? }
// from the front end (analyser.html) and forwards the request to the Anthropic
// API, returning the raw response. It does NOT contain the analyser prompt —
// that is sent by the front end. (The canonical copy of the prompt text lives in
// api/_lib/analyse-prompt.js; do not paste it into this file.)

export const config = {
  maxDuration: 120,
  // Statements are sent as base64 inside the JSON body. The default 1mb limit
  // (Next.js API routes) is far too small for a PDF, which is what caused the
  // 500. (On plain Vercel Functions this is ignored and the hard cap is ~4.5MB —
  // if a single file ever exceeds that, upload it to storage first rather than
  // inlining base64.)
  api: { bodyParser: { sizeLimit: '15mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { model, max_tokens, messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // The analyser now returns a small, factual JSON object, so it no longer needs
  // a huge output budget — but we keep a sensible floor and cap so a low/blank
  // client value can't truncate the response, and a high cap is free headroom
  // (you only pay for tokens generated; the model stops on its own at end_turn).
  const MODEL = model || 'claude-haiku-4-5-20251001';
  const MODEL_OUTPUT_CAP = 64000; // Haiku 4.5 max output tokens
  const resolvedMaxTokens = Math.min(
    MODEL_OUTPUT_CAP,
    Math.max(8192, Number(max_tokens) || 8192)
  );

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: resolvedMaxTokens,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error('Anthropic error:', anthropicRes.status, errorText);
      return res.status(anthropicRes.status).json({ error: 'Upstream API error', detail: errorText });
    }

    const data = await anthropicRes.json();

    if (data && data.stop_reason === 'max_tokens') {
      console.warn(
        `analyse.js: response stopped at max_tokens (${resolvedMaxTokens}). ` +
        `The output was truncated - raise the cap or check the prompt.`
      );
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('analyse.js error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
