import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Scheduled function that advances gallery statuses based on their
 * configured timing thresholds.
 *
 * Runs every 60 seconds and transitions galleries:
 * - `upcoming` → `active` when `startsAt <= now`
 * - any non-revealed status → `revealed` when `revealAt <= now`
 *
 * Uses batched writes to stay within Firestore limits (max 500 per batch).
 */
export const advanceGalleryStatus = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const now = admin.firestore.Timestamp.now();

    const snapshot = await db
      .collection('galleries')
      .where('status', '!=', 'revealed')
      .get();

    if (snapshot.empty) {
      logger.info('advanceGalleryStatus: No galleries to advance.');
      return;
    }

    let advancedCount = 0;
    let batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const startsAt = data.startsAt as admin.firestore.Timestamp | undefined;
      const revealAt = data.revealAt as admin.firestore.Timestamp | undefined;
      const status = data.status as string;

      let newStatus: string | null = null;

      // Check reveal transition first (higher priority)
      if (revealAt && revealAt.toMillis() <= now.toMillis() && status !== 'revealed') {
        newStatus = 'revealed';
      } else if (startsAt && startsAt.toMillis() <= now.toMillis() && status === 'upcoming') {
        newStatus = 'active';
      }

      if (newStatus) {
        batch.update(doc.ref, { status: newStatus });
        advancedCount++;
        batchCount++;

        if (batchCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // Commit any remaining writes
    if (batchCount > 0) {
      await batch.commit();
    }

    logger.info(`advanceGalleryStatus: Advanced ${advancedCount} galleries.`);
  }
);
