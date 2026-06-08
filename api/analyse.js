// api/analyse.js
// Secure server-side proxy for Anthropic API calls.
// The ANTHROPIC_API_KEY environment variable is set in Vercel — never in client code.

export const config = {
  maxDuration: 60, // allow up to 60s for large statement analysis
};

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Forward the request body straight to Anthropic
  // The client sends the same payload shape it used to send directly
  const { model, max_tokens, messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
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

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errorText);
      return res.status(anthropicRes.status).json({ error: 'Upstream API error', detail: errorText });
    }

    const data = await anthropicRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('analyse.js fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
