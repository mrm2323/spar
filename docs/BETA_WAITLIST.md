# Beta waitlist

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

## Flow

- **Landing** → Join waitlist → `POST /api/waitlist` → row `pending`
- **Sign in / Sign up** → Clerk as usual
- **App routes** (`/dashboard`, `/session`, `/notes`, …) → middleware checks `beta_waitlist` for approved email
- Not approved → `/beta/pending`

## Clerk session token (optional)

If middleware ever fails to resolve email, ensure `GET /api/beta/verify` can still read the user via Clerk (already uses `clerkClient.users.getUser`).
