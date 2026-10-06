/**
 * One-off backfill: generates the display (1600px) and thumb (480px) sizes for
 * photos uploaded before the client started producing them, and records their
 * paths on each photo document. Safe to re-run — photos that already have both
 * sizes are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-thumbnails.ts --dry-run          # report only
 *   npx tsx scripts/backfill-thumbnails.ts                    # all galleries
 *   npx tsx scripts/backfill-thumbnails.ts --gallery=<id>     # one gallery
 *
 * Prerequisites:
 *   - Firebase Admin auth: `service-account.json` in the repo root, or GOOGLE_APPLICATION_CREDENTIALS
 *   - `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or `functions/.env`
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "functions/.env" });

// Keep in sync with src/lib/imageProcessing.ts
const BUCKET = "gallery-photos";
const CACHE_SECONDS = "31536000";
const SIZES = {
  displayPath: { maxEdge: 1600, quality: 80, suffix: "_md" },
  thumbPath: { maxEdge: 480, quality: 70, suffix: "_th" },
} as const;
const CONCURRENCY = 4;

const dryRun = process.argv.includes("--dry-run");
const galleryArg = process.argv.find((a) => a.startsWith("--gallery="))?.split("=")[1];

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("\nError: Missing Supabase URL or Service Role Key.");
  console.error("Add VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local or functions/.env.\n");
  process.exit(1);
}

const firebaseConfig = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
const initOptions: any = { projectId: firebaseConfig.projectId };
if (fs.existsSync("service-account.json")) {
  initOptions.credential = cert("service-account.json");
}
initializeApp(initOptions);
const db = getFirestore();
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const stats = { scanned: 0, skipped: 0, updated: 0, failed: 0 };

async function processPhoto(photoDoc: QueryDocumentSnapshot) {
  const data = photoDoc.data();
  stats.scanned++;
  if (data.displayPath && data.thumbPath) {
    stats.skipped++;
    return;
  }
  const storagePath = data.storagePath as string | undefined;
  if (!storagePath || !storagePath.endsWith(".jpg")) {
    console.warn(`  [WARN] ${photoDoc.ref.path} — unexpected storagePath "${storagePath}", skipping`);
    stats.failed++;
    return;
  }
  if (dryRun) {
    console.log(`  [DRY] would generate sizes for ${storagePath}`);
    stats.updated++;
    return;
  }

  try {
    const { data: original, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !original) throw error || new Error("empty download");
    const input = Buffer.from(await original.arrayBuffer());

    const update: Record<string, string> = {};
    for (const [field, size] of Object.entries(SIZES)) {
      if (data[field]) continue;
      const output = await sharp(input)
        .rotate() // honour EXIF orientation if present
        .resize({ width: size.maxEdge, height: size.maxEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: size.quality, mozjpeg: true })
        .toBuffer();
      const path = storagePath.replace(/\.jpg$/, `${size.suffix}.jpg`);
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, output, {
        contentType: "image/jpeg",
        cacheControl: CACHE_SECONDS,
        upsert: true,
      });
      if (upErr) throw upErr;
      update[field] = path;
    }

    await photoDoc.ref.update(update);
    stats.updated++;
    console.log(`  [OK] ${storagePath}`);
  } catch (err) {
    stats.failed++;
    console.error(`  [FAIL] ${storagePath}`, err);
  }
}

async function runPool(docs: QueryDocumentSnapshot[]) {
  let next = 0;
  const worker = async () => {
    while (next < docs.length) await processPhoto(docs[next++]);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function backfill() {
  console.log(dryRun ? "Dry run — nothing will be written.\n" : "Backfilling photo sizes...\n");

  const galleryIds = galleryArg
    ? [galleryArg]
    : (await db.collection("galleries").get()).docs.map((d) => d.id);

  for (const galleryId of galleryIds) {
    const photos = await db.collection("galleries").doc(galleryId).collection("photos").get();
    if (photos.empty) continue;
    console.log(`Gallery ${galleryId}: ${photos.size} photos`);
    await runPool(photos.docs);
  }

  console.log(
    `\nDone. Scanned ${stats.scanned}, already had sizes ${stats.skipped}, ` +
      `${dryRun ? "would update" : "updated"} ${stats.updated}, failed ${stats.failed}.`
  );
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
