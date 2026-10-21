// src/scripts/compress-local-uploads.ts
// Compresses image files in the local uploads/ folder
// Run: DRY_RUN=true npx ts-node src/scripts/compress-local-uploads.ts
// Then: DRY_RUN=false npx ts-node src/scripts/compress-local-uploads.ts

import fs from "fs";
import path from "path";
import sharp from "sharp";

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  folders: [
    path.join(process.cwd(), "uploads/id-cards"),
    path.join(process.cwd(), "uploads/payments"),
  ],
  extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  maxWidthOrHeight: 1280,
  quality: 75,
  minSizeToCompress: 100 * 1024,
  dryRun: process.env.DRY_RUN !== "false",
  backupFolder: path.join(process.cwd(), "uploads/_backup"),
};

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const getAllImages = (dir: string): string[] => {
  const images: string[] = [];
  if (!fs.existsSync(dir)) return images;

  const walk = (p: string) => {
    try {
      fs.readdirSync(p).forEach((file) => {
        const full = path.join(p, file);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (!full.includes("_backup")) walk(full);
          } else if (CONFIG.extensions.includes(path.extname(file).toLowerCase())) {
            images.push(full);
          }
        } catch {}
      });
    } catch {}
  };

  walk(dir);
  return images;
};

const compressFile = async (filePath: string) => {
  const originalSize = fs.statSync(filePath).size;

  if (originalSize < CONFIG.minSizeToCompress) {
    return { originalSize, newSize: originalSize, skipped: true };
  }

  const ext = path.extname(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const tempPath = path.join(dir, `${base}.__tmp_compressed.jpg`);

  const metadata = await sharp(filePath).metadata();
  let pipeline = sharp(filePath);
  if (
    (metadata.width && metadata.width > CONFIG.maxWidthOrHeight) ||
    (metadata.height && metadata.height > CONFIG.maxWidthOrHeight)
  ) {
    pipeline = pipeline.resize(CONFIG.maxWidthOrHeight, CONFIG.maxWidthOrHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  await pipeline
    .jpeg({ quality: CONFIG.quality, progressive: true, mozjpeg: true })
    .toFile(tempPath);

  const newSize = fs.statSync(tempPath).size;

  if (newSize >= originalSize) {
    fs.unlinkSync(tempPath);
    return { originalSize, newSize: originalSize, skipped: true };
  }

  if (CONFIG.dryRun) {
    fs.unlinkSync(tempPath);
    return { originalSize, newSize, skipped: false };
  }

  // Backup original
  const rel = path.relative(process.cwd(), filePath);
  const backupPath = path.join(CONFIG.backupFolder, rel);
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);

  // Replace with compressed
  fs.unlinkSync(filePath);
  const newPath = path.join(dir, `${base}.jpg`);
  fs.renameSync(tempPath, newPath);

  return { originalSize, newSize, skipped: false };
};

const main = async () => {
  console.log("🗜️  ============================================");
  console.log("🗜️  LOCAL UPLOADS COMPRESSION");
  console.log("🗜️  ============================================");
  console.log(`⚙️  Max dimension: ${CONFIG.maxWidthOrHeight}px`);
  console.log(`⚙️  Quality: ${CONFIG.quality}%`);
  console.log(`⚙️  Min size: ${formatSize(CONFIG.minSizeToCompress)}`);
  console.log(
    `⚙️  Mode: ${CONFIG.dryRun ? "DRY RUN (no changes)" : "LIVE (will modify files)"}`,
  );
  console.log("");

  let allImages: string[] = [];
  for (const folder of CONFIG.folders) {
    const imgs = getAllImages(folder);
    console.log(`📂 ${folder}: ${imgs.length} images`);
    allImages.push(...imgs);
  }
  allImages = [...new Set(allImages)];

  console.log(`\n📊 Total: ${allImages.length} images\n`);

  if (allImages.length === 0) {
    console.log("✨ Nothing to compress. Done!");
    return;
  }

  let totalOrig = 0;
  let totalNew = 0;
  let compressed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allImages.length; i++) {
    const img = allImages[i];
    process.stdout.write(`[${i + 1}/${allImages.length}] ${path.basename(img)}... `);

    try {
      const r = await compressFile(img);
      totalOrig += r.originalSize;
      totalNew += r.newSize;

      if (r.skipped) {
        console.log("⏭️  skipped");
        skipped++;
      } else {
        const saved = ((1 - r.newSize / r.originalSize) * 100).toFixed(0);
        console.log(
          `${formatSize(r.originalSize)} → ${formatSize(r.newSize)} (${saved}%)`,
        );
        compressed++;
      }
    } catch (err: any) {
      console.log(`❌ ${err.message}`);
      failed++;
    }
  }

  console.log("\n🗜️  ============================================");
  console.log("🗜️  SUMMARY");
  console.log("🗜️  ============================================");
  console.log(`✅ Compressed: ${compressed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📦 Original: ${formatSize(totalOrig)}`);
  console.log(`📦 New: ${formatSize(totalNew)}`);
  console.log(
    `💾 Saved: ${formatSize(totalOrig - totalNew)} (${totalOrig > 0 ? ((1 - totalNew / totalOrig) * 100).toFixed(1) : 0}%)`,
  );
  console.log("🗜️  ============================================");

  if (CONFIG.dryRun) {
    console.log("\n⚠️  DRY RUN — nothing was modified.");
  } else {
    console.log(`\n💾 Backup of originals: ${CONFIG.backupFolder}`);
  }
};

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});