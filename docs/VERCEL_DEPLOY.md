# Deploy SPAR on Vercel

## Before you deploy

1. **Commit and push** your latest code to GitHub (`origin` should point at your repo, e.g. `github.com/mrm2323/spar`).
2. Have **production values** ready for Clerk, Supabase, Vapi, OpenAI, etc. (see `.env.local.example`). Do **not** commit `.env.local`.

---

## Option A — Vercel Dashboard (recommended)

1. Go to [vercel.com](https://vercel.com) → **Add New…** → **Project**.
2. **Import** your Git repository (`mrm2323/spar` or your fork).
3. **Framework Preset:** Next.js (auto-detected).
4. **Build & Output:** defaults — `npm run build`, output `.next`.
5. **Environment Variables** — add every variable your app uses **for Production** (and Preview if you want staging deploys to work):

   Copy names from `.env.local.example`. Minimum set:

   | Variable | Notes |
   |----------|--------|
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk |
   | `CLERK_SECRET_KEY` | Clerk (server) |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | e.g. `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | e.g. `/sign-up` |
   | `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | e.g. `/dashboard` |
   | `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | e.g. `/dashboard` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | **server-only** – never expose to client |
   | `OPENAI_API_KEY` | Used server-side |
   | `NEXT_PUBLIC_OPENAI_API_KEY` | Only if your app reads client-side OpenAI (see code) |
   | `SUPERMEMORY_API_KEY` | If memory features enabled |
   | `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | Vapi web SDK |
   | `VAPI_PRIVATE_KEY` | Vapi server / webhooks |

   Optional: `SPAR_CAP_EXEMPT_USER_IDS`, `SPAR_BETA_BYPASS_USER_IDS`, `RESEND_*`, `WAITLIST_*`, etc.

6. **Deploy.**

---

## Clerk: production URLs

After the first deploy, Vercel gives you a URL like `https://spar-xxxxx.vercel.app` (and your custom domain later).

In [Clerk Dashboard](https://dashboard.clerk.com) → your application → **Domains**:

- Add your **Vercel production domain** (and `www` if used).
- Under **Paths / URLs**, ensure sign-in / sign-up / callback URLs match your deployed app (Clerk’s UI will walk you through allowed origins and redirects).

---

## Supabase

- Use the **same** Supabase project as local dev unless you intentionally create a **production** project.
- If you use a **custom domain** for the app, add it anywhere your app or Supabase expects an allowed redirect (if applicable).

---

## Vapi webhooks (if used)

If your Vapi assistant posts to `https://your-domain/api/vapi/webhook`, set that URL in the Vapi dashboard and ensure the **production** `VAPI_PRIVATE_KEY` matches.

---

## Option B — Vercel CLI

```bash
npm i -g vercel   # or: npx vercel
cd /path/to/spar
vercel login
vercel            # link project, first deploy to preview
vercel --prod     # production
```

Set env vars in the dashboard or via `vercel env add`.

If `npx vercel` fails with **npm cache / EACCES**, fix npm permissions or use `sudo` only as a last resort; prefer [dashboard deploy](#option-a--vercel-dashboard-recommended).

---

## Troubleshooting

- **Build fails:** `npm run build` locally and fix errors first.
- **Auth works locally but not on Vercel:** Clerk domain + redirect URLs not updated for production URL.
- **API routes 500:** Missing or wrong `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, or Vapi keys in Vercel **Environment Variables** (Production).

---

## After deploy

- Smoke test: sign in, start a short session, open notes.
- Point a **custom domain** in Vercel → Project → **Domains**, then add the same domain in Clerk.
