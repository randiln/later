/**
 * One-off backfill script: adds the `status` field to any existing gallery
 * documents that lack it.
 *
 * Usage:
 *   npx tsx scripts/backfill-gallery-status.ts
 *
 * Prerequisites:
 *   - Set GOOGLE_APPLICATION_CREDENTIALS to a service account key JSON file
 *   - Or run `firebase login` and use the default credentials
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

async function backfill() {
  const snapshot = await db.collection("galleries").get();

  if (snapshot.empty) {
    console.log("No galleries found. Nothing to backfill.");
    return;
  }

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Skip if already has a status field
    if (data.status) {
      console.log(`  [SKIP] ${doc.id} — already has status: ${data.status}`);
      continue;
    }

    const startsAt = data.startsAt as admin.firestore.Timestamp;
    const revealAt = data.revealAt as admin.firestore.Timestamp;

    let status: string;
    if (revealAt.toMillis() <= now.toMillis()) {
      status = "revealed";
    } else if (startsAt.toMillis() <= now.toMillis()) {
      status = "active";
    } else {
      status = "upcoming";
    }

    batch.update(doc.ref, { status });
    count++;
    console.log(`  [SET] ${doc.id} → ${status}`);
  }

  if (count === 0) {
    console.log("All galleries already have a status field.");
    return;
  }

  await batch.commit();
  console.log(`\nBackfill complete. Updated ${count} gallery document(s).`);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
