import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Maximum number of storage paths to delete in a single Supabase request. */
const STORAGE_DELETE_BATCH_SIZE = 100;

/**
 * Creates an authenticated Supabase client using the service role key.
 * Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.
 */
function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new HttpsError(
      'failed-precondition',
      'Supabase environment variables are not configured.'
    );
  }

  return createClient(url, key);
}

/**
 * Deletes all Firestore documents in a subcollection using batched writes.
 *
 * @param collectionRef - Reference to the subcollection to delete
 */
async function deleteSubcollection(
  collectionRef: admin.firestore.CollectionReference
): Promise<void> {
  const snapshot = await collectionRef.get();
  if (snapshot.empty) return;

  let batch = db.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    count++;

    if (count >= 500) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

/**
 * HTTPS-callable function that fully deletes a gallery, including:
 * - All photos in Supabase Storage
 * - The `/photos` and `/contributors` Firestore subcollections
 * - The gallery document itself
 *
 * If storage deletion partially fails, undeleted paths are written to the
 * root-level `cleanup_queue` collection for later reconciliation.
 *
 * @remarks
 * Requires the caller to be authenticated and to be the gallery's creator.
 */
export const deleteGallery = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request) => {
    // --- Auth check ---
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'You must be signed in to delete a gallery.'
      );
    }

    const { galleryId } = request.data as { galleryId: string };

    if (!galleryId || typeof galleryId !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'A valid galleryId string is required.'
      );
    }

    // --- Fetch gallery and verify ownership ---
    const galleryRef = db.collection('galleries').doc(galleryId);
    const gallerySnap = await galleryRef.get();

    if (!gallerySnap.exists) {
      throw new HttpsError('not-found', 'Gallery not found.');
    }

    const galleryData = gallerySnap.data()!;

    if (request.auth.uid !== galleryData.creatorId) {
      throw new HttpsError(
        'permission-denied',
        'Only the gallery creator can delete this gallery.'
      );
    }

    // --- Delete files from Supabase Storage (Robust folder cleanup) ---
    const supabase = getSupabaseClient();
    const failedPaths: string[] = [];

    try {
      // List all items in the root of the gallery folder (usually contributor subfolders)
      const { data: rootItems, error: rootError } = await supabase.storage
        .from('gallery-photos')
        .list(galleryId);

      if (rootError) {
        logger.error(`deleteGallery: Failed to list root items for gallery ${galleryId}`, rootError);
      } else if (rootItems && rootItems.length > 0) {
        const filesToDelete: string[] = [];

        for (const item of rootItems) {
          // In Supabase storage list output, directories do not have an ID (or item.id is missing/null)
          const isFolder = !item.id;

          if (isFolder) {
            // It's a contributor folder. List and add all files inside it.
            const { data: subItems, error: subError } = await supabase.storage
              .from('gallery-photos')
              .list(`${galleryId}/${item.name}`);

            if (subError) {
              logger.error(`deleteGallery: Failed to list items in folder ${galleryId}/${item.name}`, subError);
            } else if (subItems) {
              for (const subItem of subItems) {
                filesToDelete.push(`${galleryId}/${item.name}/${subItem.name}`);
              }
            }
          } else {
            // It's a file sitting in the root of the gallery folder.
            filesToDelete.push(`${galleryId}/${item.name}`);
          }
        }

        // Delete all collected files in batches
        if (filesToDelete.length > 0) {
          logger.info(`deleteGallery: Attempting to delete ${filesToDelete.length} files from Supabase for gallery ${galleryId}`);
          for (let i = 0; i < filesToDelete.length; i += STORAGE_DELETE_BATCH_SIZE) {
            const batch = filesToDelete.slice(i, i + STORAGE_DELETE_BATCH_SIZE);
            const { error } = await supabase.storage
              .from('gallery-photos')
              .remove(batch);

            if (error) {
              logger.error(
                `deleteGallery: Failed to delete storage batch starting at index ${i} for gallery ${galleryId}`,
                error
              );
              failedPaths.push(...batch);
            }
          }
        }
      }

      // Write failed paths to cleanup_queue for later reconciliation
      if (failedPaths.length > 0) {
        await db.collection('cleanup_queue').add({
          paths: failedPaths,
          galleryId,
          attempts: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          flaggedForReview: false,
        });

        logger.warn(
          `deleteGallery: ${failedPaths.length} paths written to cleanup_queue for gallery ${galleryId}.`
        );
      }
    } catch (err) {
      logger.error(`deleteGallery: Exception during storage cleanup for gallery ${galleryId}`, err);
    }

    // Reference photos collection for Firestore subcollection cleanup
    const photosRef = galleryRef.collection('photos');

    // --- Delete Firestore subcollections ---
    await deleteSubcollection(photosRef);
    await deleteSubcollection(galleryRef.collection('contributors'));

    // --- Delete the gallery document ---
    await galleryRef.delete();

    logger.info(`deleteGallery: Successfully deleted gallery ${galleryId}.`);

    return { success: true };
  }
);
