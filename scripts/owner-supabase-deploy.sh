#!/usr/bin/env bash
#
# ⚠️  RUN IN YOUR COMPUTER TERMINAL — NOT in Supabase SQL Editor.
#     (SQL Editor only accepts .sql files like supabase/migrations/001_safety_tables.sql)
#
# Owner one-shot: link project, set Edge Function secrets, deploy functions, push DB, optional smoke tests.
# Prerequisites: Supabase CLI (`brew install supabase/tap/supabase` or use npx), `supabase login` once.
# Reads secrets from `.env.local` (never commit that file).
#
# Usage:  cd /path/to/spar && ./scripts/owner-supabase-deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.local.example and fill values."
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

SUPABASE_CMD=(supabase)
if ! command -v supabase &>/dev/null; then
  SUPABASE_CMD=(npx --yes supabase)
  echo "Using npx supabase (install CLI for faster runs: brew install supabase/tap/supabase)"
fi

URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
if [[ -z "$URL" ]]; then
  echo "Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in $ENV_FILE"
  exit 1
fi

# https://<ref>.supabase.co → ref
REF="$(echo "$URL" | sed -E 's|https?://([a-z0-9]+)\.supabase\.co/?.*|\1|')"
if [[ -z "$REF" || "$REF" == "$URL" ]]; then
  echo "Could not parse project ref from URL: $URL"
  exit 1
fi

OAI="${OPENAI_API_KEY:-}"
ANON="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
if [[ -z "$OAI" ]]; then
  echo "OPENAI_API_KEY missing in $ENV_FILE (required for crisis-detection + kabir-respond)"
  exit 1
fi

echo "==> Linking project ref: $REF"
"${SUPABASE_CMD[@]}" link --project-ref "$REF"

echo "==> Setting Edge Function secrets (OPENAI_* + optional SUPERMEMORY_*)"
# Supabase provides project URL/keys in function env; custom SUPABASE_* names are reserved.
SECRETS=(OPENAI_API_KEY="$OAI")
if [[ -n "${SUPERMEMORY_API_KEY:-}" ]]; then
  SECRETS+=(SUPERMEMORY_API_KEY="$SUPERMEMORY_API_KEY")
fi
"${SUPABASE_CMD[@]}" secrets set "${SECRETS[@]}"

echo "==> Deploying Edge Functions"
for fn in crisis-detection content-safety kabir-respond; do
  "${SUPABASE_CMD[@]}" functions deploy "$fn"
done

echo "==> Applying migrations (db push)"
"${SUPABASE_CMD[@]}" db push

echo ""
echo "Deploy steps finished."
echo ""
echo "NOTE: user_id columns are aligned to TEXT for Clerk IDs (see 002_user_id_text_alignment.sql)."
echo ""

if [[ "${SMOKE:-}" == "1" ]]; then
  if [[ -z "$ANON" ]]; then
    echo "SMOKE=1 set but NEXT_PUBLIC_SUPABASE_ANON_KEY missing — skipping curl tests."
    exit 0
  fi
  BASE="https://${REF}.supabase.co/functions/v1"
  AUTH=( -H "Authorization: Bearer ${ANON}" -H "Content-Type: application/json" )
  # Clerk-style ID now supported by safety tables
  U="user_test_123"

  echo "==> Smoke: crisis-detection"
  curl -sS "${AUTH[@]}" -d "{\"message\":\"Hello\",\"userId\":\"$U\"}" "$BASE/crisis-detection" | head -c 400
  echo ""

  echo "==> Smoke: content-safety"
  curl -sS "${AUTH[@]}" -d "{\"userMessage\":\"Hi\",\"aiResponse\":\"I hear you.\",\"userId\":\"$U\"}" "$BASE/content-safety" | head -c 400
  echo ""

  echo "==> Smoke: kabir-respond"
  curl -sS "${AUTH[@]}" -d "{\"message\":\"Say hi in one sentence.\",\"userId\":\"$U\"}" "$BASE/kabir-respond" | head -c 400
  echo ""
fi

echo "Done. Run with SMOKE=1 to POST each function once (needs NEXT_PUBLIC_SUPABASE_ANON_KEY)."
