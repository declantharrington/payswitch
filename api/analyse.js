// api/analyse.js
// Uses native Node.js pipe to stream Anthropic's response directly to the client.
// This keeps the connection alive for the full 60s without a hanging reader loop.

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

  try {
    console.log('Calling Anthropic (non-streaming)...');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // abort at 55s

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
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

    clearTimeout(timeout);
    console.log('Anthropic status:', anthropicRes.status);

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error('Anthropic error:', anthropicRes.status, errorText);
      return res.status(anthropicRes.status).json({ error: 'Upstream API error', detail: errorText });
    }

    const data = await anthropicRes.json();
    console.log('Response received. Output tokens:', data?.usage?.output_tokens);

    return res.status(200).json(data);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('Anthropic request timed out after 55s');
      return res.status(504).json({ error: 'Analysis timed out. Please try again.' });
    }
    console.error('analyse.js error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
