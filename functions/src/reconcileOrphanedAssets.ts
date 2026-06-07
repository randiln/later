import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Creates an authenticated Supabase client using the service role key.
 * Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.
 */
function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are not configured.'
    );
  }

  return createClient(url, key);
}

/**
 * Weekly scheduled function that retries deletion of orphaned storage assets
 * from the `cleanup_queue` collection.
 *
 * Runs at 3 AM every Sunday. For each queued item:
 * - Attempts to remove the listed paths from Supabase Storage
 * - On success, deletes the queue document
 * - On failure, increments `attempts`; if `attempts >= 3`, sets `flaggedForReview: true`
 *
 * Items flagged for review require manual intervention.
 */
export const reconcileOrphanedAssets = onSchedule(
  {
    schedule: '0 3 * * 0',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const snapshot = await db.collection('cleanup_queue').get();

    if (snapshot.empty) {
      logger.info('reconcileOrphanedAssets: No items in cleanup_queue.');
      return;
    }

    const supabase: SupabaseClient = getSupabaseClient();

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const doc of snapshot.docs) {
      processed++;
      const data = doc.data();
      const paths = data.paths as string[];
      const attempts = (data.attempts as number) || 0;

      const { error } = await supabase.storage
        .from('gallery-photos')
        .remove(paths);

      if (!error) {
        // Successfully deleted — remove from queue
        await doc.ref.delete();
        succeeded++;
        logger.info(
          `reconcileOrphanedAssets: Cleaned up ${paths.length} paths for gallery ${data.galleryId}.`
        );
      } else {
        failed++;
        const newAttempts = attempts + 1;
        const updates: Record<string, unknown> = { attempts: newAttempts };

        if (newAttempts >= 3) {
          updates.flaggedForReview = true;
          logger.warn(
            `reconcileOrphanedAssets: Item ${doc.id} (gallery ${data.galleryId}) flagged for review after ${newAttempts} failed attempts.`,
            error
          );
        } else {
          logger.error(
            `reconcileOrphanedAssets: Retry failed for item ${doc.id} (gallery ${data.galleryId}), attempt ${newAttempts}.`,
            error
          );
        }

        await doc.ref.update(updates);
      }
    }

    logger.info(
      `reconcileOrphanedAssets: Processed ${processed} items — ${succeeded} succeeded, ${failed} failed.`
    );
  }
);
