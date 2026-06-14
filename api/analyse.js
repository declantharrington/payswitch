// api/analyse.js
export const config = {
  maxDuration: 120,
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

  // The payments report is a large JSON object - several prose fields plus four
  // arrays of objects (feeBreakdown, alerts, nextSteps, stackItems). If the
  // output cap is too low the JSON gets cut off mid-array and fails to parse.
  // Claude Haiku 4.5 supports up to 64k output tokens, so we give the report
  // comfortable headroom and enforce a floor so a low/blank client value can't
  // reintroduce truncation. (You only pay for tokens actually generated, and
  // the model stops on its own at end_turn, so a high cap is free headroom.)
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

    // If the model still hit the ceiling, say so in the logs so it's obvious
    // the cap (or the report length) needs another look.
    if (data && data.stop_reason === 'max_tokens') {
      console.warn(
        `analyse.js: response stopped at max_tokens (${resolvedMaxTokens}). ` +
        `The report was truncated - raise resolvedMaxTokens.`
      );
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('analyse.js error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
