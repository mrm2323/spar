# Access control (MVP)

## How sessions and notes are protected

- **Next.js API routes** use **Clerk `auth()`** to get `userId`, then **`createSupabaseAdmin()`** (service role) to read/write Supabase.
- **Ownership checks** use `src/lib/session-access.ts`: a session must belong to the Clerk `user_id` **or** the linked `phone:…` pseudo-user when a phone is linked in `user_memory`.

## Deletes

- `DELETE /api/session/[id]` verifies ownership, then deletes the row in `sessions`.  
- `forensics_reports` rows are removed by **`ON DELETE CASCADE`** from `sessions` (see `supabase/schema.sql`).

## Supabase RLS vs Clerk

- Table **RLS** in `schema.sql` references `request.jwt.claims` (Supabase Auth).  
- **Clerk** does not populate that JWT in Supabase unless you configure the **Clerk ↔ Supabase** integration.  
- **Today**, the app does **not** rely on browser-side Supabase + RLS for these tables; it relies on **server routes + explicit checks**. That is intentional for MVP.

To harden later: sync Clerk JWT to Supabase or use Supabase-only auth for data paths.

## Copy vs encryption

- UI copy may say “encrypted” for user trust; ensure your **actual** retention and encryption story matches your privacy policy and infra (Supabase, Vercel, Vapi).
