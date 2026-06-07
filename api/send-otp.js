// api/send-otp.js
// Generates and verifies a 6-digit OTP sent via Resend email

// In-memory store — codes expire after 10 minutes
// Note: this works fine for a single Vercel serverless instance.
// For high traffic, swap for a Redis/Supabase store.
const otpStore = {};

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, firstName, verify } = req.body;

  if (!email) return res.status(400).json({ error: 'Email required' });

  // ── VERIFY MODE ──────────────────────────────────────────────────
  if (verify) {
    const record = otpStore[email.toLowerCase()];
    if (!record) return res.status(400).json({ valid: false, error: 'No code found for this email. Please request a new one.' });

    const expired = Date.now() - record.createdAt > 10 * 60 * 1000; // 10 minutes
    if (expired) {
      delete otpStore[email.toLowerCase()];
      return res.status(400).json({ valid: false, error: 'Code expired. Please request a new one.' });
    }

    if (record.attempts >= 5) {
      delete otpStore[email.toLowerCase()];
      return res.status(400).json({ valid: false, error: 'Too many attempts. Please request a new code.' });
    }

    if (verify !== record.code) {
      otpStore[email.toLowerCase()].attempts++;
      return res.status(400).json({ valid: false });
    }

    // Valid — clean up
    delete otpStore[email.toLowerCase()];
    return res.status(200).json({ valid: true });
  }

  // ── SEND MODE ────────────────────────────────────────────────────
  const code = generateOtp();
  otpStore[email.toLowerCase()] = {
    code,
    createdAt: Date.now(),
    attempts: 0
  };

  const name = firstName || 'there';
  const resendKey = process.env.RESEND_API_KEY;

  const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:0}
.wrap{max-width:480px;margin:0 auto;background:white}
.hdr{background:#0d1628;padding:28px 32px;text-align:center}
.hdr-title{font-size:18px;font-weight:700;color:white;margin-bottom:4px}
.hdr-sub{font-size:12px;color:rgba(255,255,255,.35)}
.body{padding:32px}
.code-wrap{text-align:center;margin:24px 0}
.code{font-size:42px;font-weight:800;letter-spacing:0.2em;color:#0d1628;font-family:'Courier New',monospace}
.note{font-size:13px;color:#888;line-height:1.65;margin-top:20px;text-align:center}
.footer{padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#bbb;text-align:center}
</style></head>
<body><div class="wrap">
  <div class="hdr">
    <div class="hdr-title">Payswitch · Verification Code</div>
    <div class="hdr-sub">AI-powered payments review</div>
  </div>
  <div class="body">
    <p style="font-size:15px;color:#333;line-height:1.7;margin-bottom:8px">Hi ${name},</p>
    <p style="font-size:14px;color:#666;line-height:1.7">Here is your verification code to confirm your email address:</p>
    <div class="code-wrap">
      <div class="code">${code}</div>
    </div>
    <p class="note">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
  </div>
  <div class="footer">Payswitch · AI-powered merchant services review</div>
</div></body></html>`;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Payswitch <onboarding@resend.dev>',
        to: [email],
        subject: `${code} is your Payswitch verification code`,
        html: emailHtml
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      throw new Error(err.message || 'Email send failed');
    }

    return res.status(200).json({ sent: true });

  } catch(err) {
    console.error('OTP send error:', err.message);
    // Clean up on failure
    delete otpStore[email.toLowerCase()];
    return res.status(500).json({ error: err.message });
  }
};
