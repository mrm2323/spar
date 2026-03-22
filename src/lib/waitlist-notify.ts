/**
 * Notify owner(s) when someone new joins the beta waitlist.
 * Uses Resend (https://resend.com) — set RESEND_API_KEY and WAITLIST_NOTIFY_EMAIL in .env.local
 */

function parseRecipients(): string[] {
  const raw = process.env.WAITLIST_NOTIFY_EMAIL?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

/**
 * Fire-and-forget after a new pending waitlist row. No-op if not configured.
 */
export async function notifyWaitlistSignup(signupEmail: string): Promise<void> {
  const recipients = parseRecipients();
  if (recipients.length === 0) {
    return;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[waitlist] WAITLIST_NOTIFY_EMAIL is set but RESEND_API_KEY is missing — email not sent"
    );
    return;
  }

  const from =
    process.env.WAITLIST_FROM_EMAIL?.trim() ||
    "SPAR <onboarding@resend.dev>";

  const subject = `New SPAR waitlist signup: ${signupEmail}`;
  const html = `
    <p><strong>Someone joined the waitlist.</strong></p>
    <p>Email: <code>${escapeHtml(signupEmail)}</code></p>
    <p>Approve them in <strong>Supabase → Table Editor → beta_waitlist</strong> (set <code>status</code> to <code>approved</code>).</p>
    <p style="color:#64748b;font-size:12px;margin-top:24px">This email was sent by your SPAR app when the waitlist form was submitted.</p>
  `.trim();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text.slice(0, 500)}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
