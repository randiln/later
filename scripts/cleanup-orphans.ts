/**
 * One-off cleanup script: scans the 'gallery-photos' Supabase Storage bucket
 * for folders whose galleryId does not exist in the Firestore 'galleries' collection,
 * and recursively deletes all files inside them to reclaim storage space.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphans.ts
 *
 * Prerequisites:
 *   - Set up Firebase Admin authentication (e.g. run `firebase login` or set GOOGLE_APPLICATION_CREDENTIALS)
 *   - Add `SUPABASE_SERVICE_ROLE_KEY` to your `.env.local` or `functions/.env` file
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "functions/.env" });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("\nError: Missing Supabase URL or Service Role Key.");
  console.error("Please add VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your .env.local or functions/.env file.");
  console.error("You can get the service role key from your Supabase Dashboard -> Settings -> API -> service_role.\n");
  process.exit(1);
}

// Load project config to get project ID
const firebaseConfig = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));

const initOptions: any = {
  projectId: firebaseConfig.projectId
};

if (fs.existsSync("service-account.json")) {
  initOptions.credential = cert("service-account.json");
}

initializeApp(initOptions);
const db = getFirestore();
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanup() {
  console.log("Initializing cleanup...");
  console.log("Checking for orphaned gallery folders in Supabase Storage...\n");

  // 1. Get all active gallery IDs from Firestore
  const gallerySnap = await db.collection("galleries").get();
  const activeGalleryIds = new Set<string>();
  gallerySnap.forEach((doc) => activeGalleryIds.add(doc.id));
  console.log(`Found ${activeGalleryIds.size} active galleries in Firestore.`);

  // 2. List all items in the root of 'gallery-photos' bucket
  const { data: rootItems, error: listError } = await supabase.storage
    .from("gallery-photos")
    .list();

  if (listError) {
    console.error("Failed to list Supabase storage bucket:", listError);
    return;
  }

  if (!rootItems || rootItems.length === 0) {
    console.log("Supabase storage bucket is empty. Nothing to clean up.");
    return;
  }

  let totalDeletedFiles = 0;
  let totalDeletedFolders = 0;

  for (const item of rootItems) {
    // If it has no id, it is a directory. The directory name is the galleryId.
    const isFolder = !item.id;
    const galleryId = item.name;

    if (isFolder) {
      if (!activeGalleryIds.has(galleryId)) {
        console.log(`\nFound orphaned folder: "${galleryId}/"`);
        
        const filesToDelete: string[] = [];

        // List subfolders (contributor folders)
        const { data: contributorFolders, error: subFolderError } = await supabase.storage
          .from("gallery-photos")
          .list(galleryId);

        if (subFolderError) {
          console.error(`  [ERROR] Failed to list subfolders in "${galleryId}/":`, subFolderError);
          continue;
        }

        if (contributorFolders) {
          for (const folder of contributorFolders) {
            const isSubFolder = !folder.id;
            if (isSubFolder) {
              // List files inside contributor folder
              const { data: files } = await supabase.storage
                .from("gallery-photos")
                .list(`${galleryId}/${folder.name}`);

              if (files) {
                for (const file of files) {
                  filesToDelete.push(`${galleryId}/${folder.name}/${file.name}`);
                }
              }
            } else {
              // File in the root of gallery folder (unlikely, but handled)
              filesToDelete.push(`${galleryId}/${folder.name}`);
            }
          }
        }

        if (filesToDelete.length > 0) {
          console.log(`  Found ${filesToDelete.length} orphaned file(s). Deleting...`);
          
          // Delete files in batches of 100
          for (let i = 0; i < filesToDelete.length; i += 100) {
            const batch = filesToDelete.slice(i, i + 100);
            const { error: deleteError } = await supabase.storage
              .from("gallery-photos")
              .remove(batch);

            if (deleteError) {
              console.error(`  [ERROR] Failed to delete batch:`, deleteError);
            } else {
              totalDeletedFiles += batch.length;
              batch.forEach(path => console.log(`  [DELETED] ${path}`));
            }
          }
        } else {
          console.log("  Folder is already empty.");
        }
        totalDeletedFolders++;
      } else {
        console.log(`Folder "${galleryId}/" matches active Firestore gallery. Skipping.`);
      }
    }
  }

  console.log(`\nCleanup complete! Deleted ${totalDeletedFolders} orphaned folders containing ${totalDeletedFiles} files.`);
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
