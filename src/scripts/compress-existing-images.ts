// backend/src/scripts/compress-existing-images.ts
import fs from "fs";
import path from "path";
import sharp from "sharp";

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  // Directories to scan for images
  targetDirs: [
    path.join(process.cwd(), "uploads/id-cards"),
    path.join(process.cwd(), "uploads/payments"),
    path.join(process.cwd(), "uploads"),
  ],
  // Image extensions to process
  extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  // Compression settings
  maxWidthOrHeight: 1280,
  quality: 75,
  // Backup original images
  createBackup: true,
  backupDir: path.join(process.cwd(), "uploads/_backup_originals"),
  // Dry run mode (set to false to actually compress)
  dryRun: false,
};

// ============================================================
// HELPERS
// ============================================================
const formatSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const getAllImages = (dir: string): string[] => {
  const images: string[] = [];

  if (!fs.existsSync(dir)) {
    console.log(`⚠️ Directory does not exist: ${dir}`);
    return images;
  }

  const walkDir = (currentPath: string) => {
    const files = fs.readdirSync(currentPath);

    files.forEach((file) => {
      const fullPath = path.join(currentPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip backup directory
        if (!fullPath.includes("_backup")) {
          walkDir(fullPath);
        }
      } else {
        const ext = path.extname(file).toLowerCase();
        if (CONFIG.extensions.includes(ext)) {
          images.push(fullPath);
        }
      }
    });
  };

  walkDir(dir);
  return images;
};

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// ============================================================
// COMPRESS SINGLE IMAGE
// ============================================================
const compressImage = async (
  imagePath: string,
): Promise<{
  success: boolean;
  originalSize: number;
  newSize: number;
  savings: number;
  error?: string;
}> => {
  try {
    const stats = fs.statSync(imagePath);
    const originalSize = stats.size;

    // Skip if already small (< 200KB)
    if (originalSize < 200 * 1024) {
      return {
        success: true,
        originalSize,
        newSize: originalSize,
        savings: 0,
      };
    }

    const ext = path.extname(imagePath).toLowerCase();
    const dir = path.dirname(imagePath);
    const filename = path.basename(imagePath, ext);

    // Get image metadata
    const metadata = await sharp(imagePath).metadata();

    // Create backup
    if (CONFIG.createBackup) {
      const relativePath = path.relative(process.cwd(), imagePath);
      const backupPath = path.join(CONFIG.backupDir, relativePath);
      ensureDir(path.dirname(backupPath));

      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(imagePath, backupPath);
      }
    }

    // Compress to temp file first
    const tempPath = path.join(dir, `${filename}.compressed.jpg`);

    let pipeline = sharp(imagePath);

    // Resize if larger than max
    if (
      (metadata.width && metadata.width > CONFIG.maxWidthOrHeight) ||
      (metadata.height && metadata.height > CONFIG.maxWidthOrHeight)
    ) {
      pipeline = pipeline.resize(
        CONFIG.maxWidthOrHeight,
        CONFIG.maxWidthOrHeight,
        {
          fit: "inside",
          withoutEnlargement: true,
        },
      );
    }

    // Convert to JPEG with compression
    await pipeline
      .jpeg({ quality: CONFIG.quality, progressive: true, mozjpeg: true })
      .toFile(tempPath);

    const newStats = fs.statSync(tempPath);
    const newSize = newStats.size;

    if (CONFIG.dryRun) {
      // Dry run: just report, don't replace
      fs.unlinkSync(tempPath);
      console.log(
        `🔍 [DRY RUN] ${path.basename(imagePath)}: ${formatSize(originalSize)} → ${formatSize(newSize)} (${((1 - newSize / originalSize) * 100).toFixed(1)}% saved)`,
      );
    } else {
      // Actually replace the file
      fs.unlinkSync(imagePath);
      const newImagePath = path.join(dir, `${filename}.jpg`);
      fs.renameSync(tempPath, newImagePath);
      console.log(
        `✅ ${path.basename(imagePath)}: ${formatSize(originalSize)} → ${formatSize(newSize)} (${((1 - newSize / originalSize) * 100).toFixed(1)}% saved)`,
      );
    }

    return {
      success: true,
      originalSize,
      newSize,
      savings: originalSize - newSize,
    };
  } catch (error: any) {
    console.error(`❌ Failed to compress ${imagePath}:`, error.message);
    return {
      success: false,
      originalSize: 0,
      newSize: 0,
      savings: 0,
      error: error.message,
    };
  }
};

// ============================================================
// MAIN FUNCTION
// ============================================================
const main = async () => {
  console.log("🗜️  ============================================");
  console.log("🗜️  IMAGE COMPRESSION SCRIPT");
  console.log("🗜️  ============================================");
  console.log(`📁 Working directory: ${process.cwd()}`);
  console.log(`⚙️  Max dimension: ${CONFIG.maxWidthOrHeight}px`);
  console.log(`⚙️  Quality: ${CONFIG.quality}%`);
  console.log(
    `⚙️  Dry run: ${CONFIG.dryRun ? "YES (no changes)" : "NO (will modify files)"}`,
  );
  console.log(
    `⚙️  Backup: ${CONFIG.createBackup ? `YES (${CONFIG.backupDir})` : "NO"}`,
  );
  console.log("");

  let allImages: string[] = [];

  for (const dir of CONFIG.targetDirs) {
    const images = getAllImages(dir);
    console.log(`📂 ${dir}: ${images.length} images`);
    allImages = [...allImages, ...images];
  }

  // Remove duplicates
  allImages = [...new Set(allImages)];

  console.log(`\n📊 Total images found: ${allImages.length}\n`);

  if (allImages.length === 0) {
    console.log("✨ No images to compress. Done!");
    return;
  }

  let totalOriginal = 0;
  let totalNew = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < allImages.length; i++) {
    const imagePath = allImages[i];
    console.log(
      `\n[${i + 1}/${allImages.length}] Processing: ${path.basename(imagePath)}`,
    );

    const result = await compressImage(imagePath);

    if (result.success) {
      totalOriginal += result.originalSize;
      totalNew += result.newSize;

      if (result.savings > 0) {
        successCount++;
      } else {
        skippedCount++;
        console.log(`⏭️  Skipped (already small enough)`);
      }
    } else {
      failCount++;
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n🗜️  ============================================");
  console.log("🗜️  COMPRESSION SUMMARY");
  console.log("🗜️  ============================================");
  console.log(`✅ Compressed: ${successCount}`);
  console.log(`⏭️  Skipped: ${skippedCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📦 Total original: ${formatSize(totalOriginal)}`);
  console.log(`📦 Total new: ${formatSize(totalNew)}`);
  console.log(
    `💾 Total saved: ${formatSize(totalOriginal - totalNew)} (${totalOriginal > 0 ? ((1 - totalNew / totalOriginal) * 100).toFixed(1) : 0}%)`,
  );
  console.log("🗜️  ============================================");

  if (CONFIG.dryRun) {
    console.log("\n⚠️  DRY RUN MODE - No files were modified.");
    console.log("   Set CONFIG.dryRun = false to actually compress.");
  }
};

// Run
main().catch((error) => {
  console.error("❌ Script failed:", error);
  process.exit(1);
});
