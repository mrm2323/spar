# Build alignment — cofounder handoff (updated 2026-03-20)

> **Security:** Never commit `.env.local`. Rotate any keys that ever appeared in `Build_V1.pdf` Tab 1.

## Canonical safety branch (merged into `main` locally — push to GitHub)

| Item | Value |
|------|--------|
| **Branch** | `chore/safety-deploy-readiness-2026-03-20` |
| **Latest commit (pre-merge tip)** | `3b9f213` |
| **Open PR** | https://github.com/mrm2323/spar/pull/new/chore/safety-deploy-readiness-2026-03-20 |

After you merge/push `main`, the PR may auto-close or you can close it manually — **source of truth should be `main`** with this work included.

**Stack correction (from cofounder):** Safety edge functions use **OpenAI**, not Google. Set **`OPENAI_API_KEY`** on functions (and `crisis-detection` / `kabir-respond` read it in code).

---

## Owner / admin checklist (do after `main` includes safety branch)

### 1) Supabase project + access

- [ ] Add cofounder as **collaborator** on the Supabase project whose URL matches `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] Confirm **project ref** = subdomain of that URL (e.g. `https://<PROJECT_REF>.supabase.co`).

### 2) Deploy Edge Functions (Supabase CLI, repo root)

**One script (after `supabase login`):** run in your **Mac/Linux terminal** at repo root (not the Supabase SQL Editor — that is only for `.sql` migrations):

```bash
cd /path/to/spar   # your clone
./scripts/owner-supabase-deploy.sh
# optional: POST smoke tests to all three functions
SMOKE=1 ./scripts/owner-supabase-deploy.sh
```

**Manual equivalent:**

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy crisis-detection
supabase functions deploy content-safety
supabase functions deploy kabir-respond
```

`supabase/config.toml` is in-repo (from `supabase init`); seed file is disabled until you add `supabase/seed.sql`.

### 3) Edge Function secrets (Dashboard → Project → Edge Functions → Secrets, or CLI)

| Secret | Notes |
|--------|--------|
| `SUPABASE_URL` | `https://<PROJECT_REF>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (server-only) |
| `OPENAI_API_KEY` | Used by `crisis-detection` and `kabir-respond` |
| `SUPERMEMORY_API_KEY` | Only if memory path is enabled in `kabir-respond` / app |

`content-safety` uses Supabase vars only (verify in `supabase/functions/content-safety/index.ts` if you change behavior).

### 4) Migrations

- [ ] Apply **all** files under `supabase/migrations/` to the **same** project (CLI `supabase db push` or SQL Editor).

✅ **Resolved:** safety tables now use **`user_id TEXT`** (migration `002_user_id_text_alignment.sql`) so Clerk IDs like `user_...` are supported.

### 5) Smoke tests (after deploy)

`POST` each (body per function’s expected JSON — check each `index.ts`):

- `https://<PROJECT_REF>.supabase.co/functions/v1/crisis-detection`
- `https://<PROJECT_REF>.supabase.co/functions/v1/content-safety`
- `https://<PROJECT_REF>.supabase.co/functions/v1/kabir-respond`

Header: `Authorization: Bearer <NEXT_PUBLIC_SUPABASE_ANON_KEY>` (unless the function docs say otherwise).

**Example bodies:**

| Function | JSON body (minimal) |
|----------|---------------------|
| `crisis-detection` | `{"message":"Hello","userId":"<uuid>"}` |
| `content-safety` | `{"userMessage":"Hi","aiResponse":"I hear you.","userId":"<uuid>"}` |
| `kabir-respond` | `{"message":"Say hi in one sentence.","userId":"<uuid>"}` |

Clerk-style IDs are supported. Example: `{"userId":"user_test_123"}`.

Or run `SMOKE=1 ./scripts/owner-supabase-deploy.sh` (uses `user_test_123`).

### 6) GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret |
|--------|
| `NEXT_PUBLIC_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `NEXT_PUBLIC_OPENAI_API_KEY` |
| `NEXT_PUBLIC_SUPERMEMORY_API_KEY` |
| `SUPERMEMORY_API_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` |
| `OPENAI_API_KEY` |

Optional for Vercel deploy job in `.github/workflows/safety-check.yml`:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

Ensure Actions can run for collaborators / target branch.

---

## After deploy — cofounder validation

Ping her when steps 1–6 are done. She runs:

```bash
SAFETY_TEST_MODE=integration npm run test:safety
```

…plus final integration validation.

---

## Tab 2 / Tab 3 (PDF) summary

- **Tab 2 roadmap:** Phased safety → UI → core (`kabir-respond`, memory) → monitoring/CI → launch checklist (see original `Build_V1.pdf`).
- **Tab 3:** Local safety stack + mock-mode tests green; integration depends on deployed functions + secrets above.
