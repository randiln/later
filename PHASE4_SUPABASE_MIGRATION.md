# Phase 4 — Supabase-Only Migration Plan

**Status**: Deferred — execute after Phases 1–3 are stable in production.
**Estimated scope**: Dedicated sprint, 1–2 weeks.
**Goal**: Eliminate Firebase entirely. Consolidate auth, database, real-time, server-side logic, and storage on Supabase. One billing account, one SDK, one set of security policies.

---

## Prerequisites

Before starting Phase 4, confirm all of the following:

- [ ] Phases 1–3 are deployed and stable in production for at least 2 weeks
- [ ] No open bugs related to the `status` field, image transformations, or server-side deletion
- [ ] Supabase project upgraded to Pro ($25/month) if approaching free tier limits
- [ ] Google Cloud Console OAuth credentials accessible (needed to reconfigure redirect URLs)

---

## Sequencing

```
4.1 Auth Migration ──→ 4.2 Database Schema ──→ 4.3 Data Migration ──→ 4.4 Realtime ──→ 4.5 Edge Functions ──→ 4.6 Cleanup
                                                                                                                    │
                                              DO NOT START 4.2 UNTIL 4.1 IS STABLE ←──────────────────────────────────┘
```

> [!CAUTION]
> **Auth must migrate first.** If you migrate the database before auth, gallery ownership records (`creatorId`) will reference Firebase UIDs that Supabase Auth cannot verify. This creates a window where ownership checks fail silently.

---

## Task 4.1 — Migrate Authentication (Firebase Auth → Supabase Auth)

### What changes

| Current (Firebase) | Target (Supabase) |
|--------------------|--------------------|
| `signInWithPopup(auth, GoogleAuthProvider)` | `supabase.auth.signInWithOAuth({ provider: 'google' })` |
| `onAuthStateChanged(auth, callback)` | `supabase.auth.onAuthStateChange(callback)` |
| `auth.currentUser?.uid` | `session.user.id` (from `supabase.auth.getSession()`) |
| `auth.signOut()` | `supabase.auth.signOut()` |
| Firebase ID token (automatic) | Supabase JWT (automatic, stored in localStorage) |

### Steps

1. **Supabase Dashboard**: Enable Google as an OAuth provider under Authentication → Providers → Google.
2. **Google Cloud Console**: Add `https://<your-project>.supabase.co/auth/v1/callback` as an authorized redirect URI alongside the existing Firebase one. Do NOT remove the Firebase redirect yet.
3. **Update `src/lib/supabase.ts`**: Export auth helper functions:
   ```typescript
   export async function signInWithGoogle() {
     return supabase.auth.signInWithOAuth({ provider: 'google' });
   }
   
   export function onAuthStateChange(callback: (user: User | null) => void) {
     return supabase.auth.onAuthStateChange((event, session) => {
       callback(session?.user ?? null);
     });
   }
   
   export async function signOut() {
     return supabase.auth.signOut();
   }
   
   export async function getCurrentUser() {
     const { data } = await supabase.auth.getSession();
     return data.session?.user ?? null;
   }
   ```

4. **Files to update**:

   | File | Change |
   |------|--------|
   | `src/App.tsx` | Replace `onAuthStateChanged(auth, ...)` with `supabase.auth.onAuthStateChange(...)`. Replace `User` type from `firebase/auth` with Supabase's `User` type. |
   | `src/pages/Home.tsx` | Replace `signInWithPopup(auth, GoogleAuthProvider)` with `signInWithGoogle()` from supabase.ts. Remove `GoogleAuthProvider` import. |
   | `src/pages/Dashboard.tsx` | Replace `auth.currentUser.uid` with Supabase user ID from auth context. Replace `auth.signOut()`. |
   | `src/pages/EventManagement.tsx` | Replace `auth` references for ownership checks. |
   | `src/pages/GalleryView.tsx` | Replace `auth.currentUser?.uid` check for `isCreator`. |
   | `src/pages/CreateEvent.tsx` | Replace `auth.currentUser.uid` with Supabase user ID. |

5. **User impact**: Existing Firebase users will need to re-authenticate once. Supabase Auth creates new user records automatically. The `/users/{userId}` Firestore collection is replaced by Supabase's built-in `auth.users` table.

6. **Dual-auth transition period**: Run both auth systems in parallel for 48 hours. Firebase handles existing sessions; Supabase handles new sign-ins. After confirming no issues, remove the Firebase auth code path.

---

## Task 4.2 — Migrate Database Schema (Firestore → Supabase Postgres)

### Postgres Table Definitions

```sql
-- Galleries
CREATE TABLE galleries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description TEXT CHECK (char_length(description) <= 500),
  starts_at TIMESTAMPTZ NOT NULL,
  reveal_at TIMESTAMPTZ NOT NULL,
  max_shots INTEGER NOT NULL CHECK (max_shots BETWEEN 1 AND 100),
  max_contributors INTEGER NOT NULL CHECK (max_contributors BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'revealed')),
  theme_color TEXT,
  welcome_message TEXT,
  cover_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contributors
CREATE TABLE contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 20),
  session_id TEXT NOT NULL,
  shots_taken INTEGER NOT NULL DEFAULT 0 CHECK (shots_taken >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photos
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES contributors(id),
  storage_path TEXT NOT NULL CHECK (char_length(storage_path) BETWEEN 1 AND 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleanup Queue (for orphaned storage assets)
CREATE TABLE cleanup_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paths TEXT[] NOT NULL,
  gallery_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  flagged_for_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_galleries_creator ON galleries(creator_id);
CREATE INDEX idx_galleries_status ON galleries(status) WHERE status != 'revealed';
CREATE INDEX idx_contributors_gallery ON contributors(gallery_id);
CREATE INDEX idx_photos_gallery ON photos(gallery_id);
```

### Row Level Security (RLS) Policies

These replace `firestore.rules` entirely.

```sql
-- Enable RLS on all tables
ALTER TABLE galleries ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- GALLERIES --
-- Anyone can read a gallery (needed for join page)
CREATE POLICY "galleries_select" ON galleries FOR SELECT USING (true);
-- Authenticated + verified users can create
CREATE POLICY "galleries_insert" ON galleries FOR INSERT
  WITH CHECK (auth.uid() = creator_id AND status = 'upcoming');
-- Only creator can update, and cannot change status
CREATE POLICY "galleries_update" ON galleries FOR UPDATE
  USING (auth.uid() = creator_id);
-- Only creator can delete
CREATE POLICY "galleries_delete" ON galleries FOR DELETE
  USING (auth.uid() = creator_id);

-- CONTRIBUTORS --
-- Anyone can read contributors
CREATE POLICY "contributors_select" ON contributors FOR SELECT USING (true);
-- Anyone can join (no auth required for contributors)
CREATE POLICY "contributors_insert" ON contributors FOR INSERT
  WITH CHECK (shots_taken = 0);
-- Only the same session can increment shots (by exactly 1)
CREATE POLICY "contributors_update" ON contributors FOR UPDATE
  USING (session_id = (SELECT session_id FROM contributors WHERE id = contributors.id));

-- PHOTOS --
-- Photos can only be read after reveal
CREATE POLICY "photos_select" ON photos FOR SELECT
  USING ((SELECT status FROM galleries WHERE id = gallery_id) = 'revealed');
-- Photos can only be inserted during active window
CREATE POLICY "photos_insert" ON photos FOR INSERT
  WITH CHECK (
    (SELECT status FROM galleries WHERE id = gallery_id) = 'active'
    AND (SELECT shots_taken FROM contributors WHERE id = contributor_id)
        < (SELECT max_shots FROM galleries WHERE id = gallery_id)
  );
-- Only gallery creator can delete photos
CREATE POLICY "photos_delete" ON photos FOR DELETE
  USING (
    auth.uid() = (SELECT creator_id FROM galleries WHERE id = gallery_id)
  );
```

> [!NOTE]
> Postgres RLS is evaluated at query time against the JWT claims. The `auth.uid()` function reads from the Supabase session token automatically — no manual token passing required.

### Naming Convention Change

Firestore uses camelCase field names. Postgres convention is snake_case. The migration requires updating all field references in the client:

| Firestore | Postgres |
|-----------|----------|
| `creatorId` | `creator_id` |
| `startsAt` | `starts_at` |
| `revealAt` | `reveal_at` |
| `maxShots` | `max_shots` |
| `maxContributors` | `max_contributors` |
| `galleryId` | `gallery_id` |
| `contributorId` | `contributor_id` |
| `storagePath` | `storage_path` |
| `shotsTaken` | `shots_taken` |
| `sessionId` | `session_id` |
| `createdAt` | `created_at` |

Update the TypeScript interfaces in `src/types/index.ts` accordingly.

---

## Task 4.3 — Data Migration Script

### File: `scripts/migrate-firestore-to-supabase.ts`

```
1. Export all Firestore data using Firebase Admin SDK
   - Read all galleries, contributors (subcollection), photos (subcollection)
   - Flatten subcollection data into arrays

2. Transform
   - Map Firestore document IDs (strings) → keep as text PKs or generate UUIDs
   - Convert Firestore Timestamps → ISO 8601 strings
   - Rename camelCase fields → snake_case

3. Insert into Supabase Postgres
   - Use the Supabase service role key (bypasses RLS)
   - Insert order: galleries → contributors → photos (respect FK constraints)
   - Use batch inserts (chunks of 1000 rows)

4. Verify
   - Compare row counts: Firestore collection sizes vs Postgres table counts
   - Spot-check: pick 5 random galleries and verify all fields match
   - Verify FK integrity: all contributor.gallery_id values exist in galleries
```

### Cutover Plan

1. Announce a 30-minute maintenance window
2. Set Firestore to read-only mode (update security rules to deny all writes)
3. Run the migration script
4. Verify counts and data integrity
5. Switch the client to Supabase reads/writes (deploy updated frontend)
6. Keep Firestore in read-only mode for 48 hours as a rollback option
7. After 48 hours with no issues, proceed to Task 4.6 (cleanup)

---

## Task 4.4 — Migrate Real-Time Subscriptions

Replace all Firestore `onSnapshot` listeners with Supabase Realtime channels.

| Current (Firestore) | Target (Supabase) |
|---------------------|--------------------|
| `onSnapshot(doc(db, 'galleries', id), cb)` | `supabase.channel('gallery-' + id).on('postgres_changes', { event: '*', schema: 'public', table: 'galleries', filter: 'id=eq.' + id }, cb)` |
| `onSnapshot(collection(db, 'galleries', id, 'contributors'), cb)` | `supabase.channel('contributors-' + id).on('postgres_changes', { event: '*', schema: 'public', table: 'contributors', filter: 'gallery_id=eq.' + id }, cb)` |
| `onSnapshot(query(collection(...), orderBy(...)), cb)` | `supabase.channel('photos-' + id).on('postgres_changes', { event: '*', schema: 'public', table: 'photos', filter: 'gallery_id=eq.' + id }, cb)` |

### Files affected
- `src/pages/Dashboard.tsx` — gallery list listener
- `src/pages/EventManagement.tsx` — gallery + contributors listeners
- `src/pages/Capture.tsx` — gallery + contributor listeners
- `src/pages/GalleryView.tsx` — photos listener

### Supabase Realtime setup
Enable Realtime on the `galleries`, `contributors`, and `photos` tables via Dashboard → Database → Replication.

---

## Task 4.5 — Migrate Cloud Functions → Supabase Edge Functions

| Firebase Cloud Function | Supabase Edge Function |
|------------------------|----------------------|
| `advanceGalleryStatus` (scheduled, every 60s) | Supabase `pg_cron` extension — a SQL-based cron job running directly in Postgres. No Edge Function needed. |
| `deleteGallery` (HTTPS-callable) | Edge Function (Deno) invoked via `supabase.functions.invoke('delete-gallery', { body: { galleryId } })` |
| `reconcileOrphanedAssets` (scheduled, weekly) | `pg_cron` + Edge Function hybrid, or a standalone Edge Function triggered by cron |

### Gallery Status Advancement via pg_cron

This is simpler than a Cloud Function — it's a SQL statement scheduled directly in Postgres:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule status advancement every minute
SELECT cron.schedule(
  'advance-gallery-status',
  '* * * * *',
  $$
    UPDATE galleries SET status = 'revealed'
    WHERE status != 'revealed' AND reveal_at <= now();
    
    UPDATE galleries SET status = 'active'
    WHERE status = 'upcoming' AND starts_at <= now();
  $$
);
```

This eliminates the entire `advanceGalleryStatus.ts` Cloud Function with 2 lines of SQL.

### Edge Function: delete-gallery

Create `supabase/functions/delete-gallery/index.ts` (Deno runtime):
- Verify the caller's JWT via `supabase.auth.getUser()`
- Verify ownership
- Batch-delete storage files
- Delete database rows (CASCADE handles subcollections automatically via FK constraints)
- Write failures to `cleanup_queue`

---

## Task 4.6 — Remove Firebase SDK and All Dependencies

### Files to delete
- `src/lib/firebase.ts`
- `firebase-applet-config.json`
- `firebase-blueprint.json`
- `firestore.rules`
- `storage.rules`
- `functions/` (entire directory)

### Dependencies to remove from `package.json`
- `firebase`

### Environment variables to remove
- Any `VITE_FIREBASE_*` variables from `.env.local` and `.env.example`
- Firebase project credentials from Vercel environment settings

### Post-cleanup
- Archive (do not delete) the Firebase project for 30 days
- Remove the Firebase redirect URI from Google Cloud Console OAuth config
- Update `ARCHITECTURE.md` to reflect the Supabase-only architecture

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Users lose sessions during auth migration | Existing Firebase sessions remain valid until expiry. Users re-authenticate once via Supabase. |
| Data loss during Firestore → Postgres migration | Run migration in a maintenance window. Keep Firestore read-only for 48h as rollback. Verify row counts before cutover. |
| RLS policies don't match Firestore rules exactly | Test all policies in a staging Supabase project before touching production. Write integration tests. |
| Realtime subscription limits (200 on Free, 500 on Pro) | Monitor concurrent connections. If approaching limits, upgrade or implement connection pooling. |
| `pg_cron` not available on Free tier | pg_cron requires Supabase Pro. Confirm your plan includes it before migrating the scheduled function. |

---

## Estimated Effort

| Task | Effort | Dependency |
|------|--------|------------|
| 4.1 Auth migration | 1–2 days | None |
| 4.2 Postgres schema + RLS | 1–2 days | 4.1 stable |
| 4.3 Data migration script | 1 day | 4.2 complete |
| 4.4 Realtime subscriptions | 1–2 days | 4.2 complete |
| 4.5 Edge Functions | 1 day | 4.2 complete |
| 4.6 Firebase cleanup | 0.5 day | All above stable |
| **Total** | **~6–9 days** | |
