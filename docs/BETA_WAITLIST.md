# Beta waitlist

## Landing page

- **Logged out:** Header has no Sign in / Sign up — only **Join waitlist** in the hero.
- **Footer:** Subtle “Already invited to the beta?” → **Sign in** · **Create account** for people you’ve approved.
- **Logged in:** Header shows **Profile** as before.

## Database

Run migration `008_beta_waitlist.sql` in Supabase (SQL Editor or `supabase db push`).

Table: **`beta_waitlist`**

| Column     | Meaning |
|-----------|---------|
| `email`   | Lowercase; unique |
| `status`  | `pending` → you set `approved` in Table Editor |
| `notes`   | Optional internal note |

## Approve someone

1. Open **Supabase → Table Editor → `beta_waitlist`**
2. Find the row (or insert if you’re adding manually)
3. Set **`status`** to **`approved`**
4. They should use the **same email** in Clerk as in this table

## Bypass (internal)

Comma-separated Clerk user IDs in `.env.local`:

```bash
SPAR_BETA_BYPASS_USER_IDS=user_xxx,user_yyy
```

Same pattern as `SPAR_CAP_EXEMPT_USER_IDS`.

## Email alerts when someone joins (optional)

So you don’t have to watch Supabase manually:

1. Create a free **[Resend](https://resend.com)** account and an API key.
2. Add to **`.env.local`** (and production env on Vercel):

   ```bash
   RESEND_API_KEY=re_xxxxxxxx
   WAITLIST_NOTIFY_EMAIL=your@email.com
   ```

   Multiple inboxes: `WAITLIST_NOTIFY_EMAIL=a@b.com,c@d.com`

3. **From address:** With Resend’s test domain, use the default `SPAR <onboarding@resend.dev>` (works for testing). For production, verify your domain in Resend and set:

   ```bash
   WAITLIST_FROM_EMAIL=SPAR <waitlist@yourdomain.com>
   ```

You get an email **only when a new email is added** (not when someone submits a duplicate). Implementation: `src/lib/waitlist-notify.ts`.

## Flow

- **Landing** → Join waitlist → `POST /api/waitlist` → row `pending`
- **Sign in / Sign up** → Clerk as usual
- **App routes** (`/dashboard`, `/session`, `/notes`, …) → middleware checks `beta_waitlist` for approved email
- Not approved → `/beta/pending`

## Clerk session token (optional)

If middleware ever fails to resolve email, ensure `GET /api/beta/verify` can still read the user via Clerk (already uses `clerkClient.users.getUser`).
