// api/analyse.js — non-streaming with extended timeout workaround
// Anthropic responds in ~2s for text-only, ~30s for PDFs.
// We avoid the reader loop entirely and just await the full response.

export const config = {
  maxDuration: 60,
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

  try {
    console.log('Calling Anthropic...');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 4096,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    console.log('Anthropic status:', anthropicRes.status);

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error('Anthropic error:', anthropicRes.status, errorText);
      return res.status(anthropicRes.status).json({ error: 'Upstream API error', detail: errorText });
    }

    const data = await anthropicRes.json();
    console.log('Anthropic response received. Tokens:', data.usage?.output_tokens);

    return res.status(200).json(data);

  } catch (err) {
    console.error('analyse.js error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
