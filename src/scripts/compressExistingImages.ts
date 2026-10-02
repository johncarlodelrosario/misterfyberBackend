// src/scripts/compressExistingImages.ts
import mongoose from "mongoose";
import sharp from "sharp";
import dotenv from "dotenv";
import path from "path";

// ✅ Load .env from backend root (2 levels up from src/scripts/)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ✅ Import Application model (1 level up to src/, then into models/)
import Application from "../models/Application";

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  maxWidthOrHeight: 1280,
  jpegQuality: 75,
  minSizeToCompress: 500, // KB
  batchSize: 5,
  dryRun: false,
  mongoOptions: {
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    maxPoolSize: 5,
  },
};

interface Stats {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  originalSizeTotal: number;
  compressedSizeTotal: number;
}

const stats: Stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  originalSizeTotal: 0,
  compressedSizeTotal: 0,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function compressBase64Image(base64DataUrl: string): Promise<{
  compressed: string;
  originalBytes: number;
  compressedBytes: number;
} | null> {
  try {
    const matches = base64DataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      console.warn("  ⚠️ Invalid data URL format, skipping");
      return null;
    }

    const [, , base64Data] = matches;
    const originalBuffer = Buffer.from(base64Data, "base64");
    const originalBytes = originalBuffer.length;

    const metadata = await sharp(originalBuffer).metadata();
    console.log(
      `  📐 Original: ${metadata.width}x${metadata.height}, ${formatBytes(originalBytes)}`,
    );

    const compressedBuffer = await sharp(originalBuffer)
      .resize(CONFIG.maxWidthOrHeight, CONFIG.maxWidthOrHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: CONFIG.jpegQuality,
        progressive: true,
        mozjpeg: true,
      })
      .toBuffer();

    const compressedBytes = compressedBuffer.length;
    const compressedDataUrl = `data:image/jpeg;base64,${compressedBuffer.toString("base64")}`;

    return {
      compressed: compressedDataUrl,
      originalBytes,
      compressedBytes,
    };
  } catch (error) {
    console.error("  ❌ Compression error:", error);
    return null;
  }
}

// ============================================================
// ✅ Process batch helper
// ============================================================
async function processBatch(
  batch: any[],
  batchNum: number,
  totalBatches: number,
) {
  console.log(
    `📦 Batch ${batchNum}/${totalBatches} (${batch.length} applications)`,
  );
  console.log("─".repeat(70));

  for (const app of batch) {
    const appLabel = `${app.applicationId || app._id} (${app.firstName} ${app.lastName})`;
    console.log(`\n🖼️  Processing: ${appLabel}`);

    try {
      const idImage = (app.idImage as string) || "";

      if (!idImage.startsWith("data:image/")) {
        console.log(`  ⏭️  Not a base64 image, skipping`);
        stats.skipped++;
        continue;
      }

      const originalBytes = idImage.length;
      const originalKB = originalBytes / 1024;

      if (originalKB < CONFIG.minSizeToCompress) {
        console.log(
          `  ⏭️  Skipping - already small (${formatBytes(originalBytes)})`,
        );
        stats.skipped++;
        continue;
      }

      const result = await compressBase64Image(idImage);
      if (!result) {
        console.log(`  ❌ Failed to compress`);
        stats.failed++;
        continue;
      }

      const { compressed, originalBytes: origBytes, compressedBytes } = result;
      const savedPercent = ((1 - compressedBytes / origBytes) * 100).toFixed(1);

      console.log(
        `  ✅ Compressed: ${formatBytes(origBytes)} → ${formatBytes(compressedBytes)} (-${savedPercent}%)`,
      );

      if (!CONFIG.dryRun) {
        await Application.updateOne(
          { _id: app._id },
          { $set: { idImage: compressed } },
        );
        console.log(`  💾 Saved to database`);
      } else {
        console.log(`  🔍 DRY RUN - would save`);
      }

      stats.processed++;
      stats.originalSizeTotal += origBytes;
      stats.compressedSizeTotal += compressedBytes;
    } catch (error) {
      console.error(`  ❌ Error processing ${appLabel}:`, error);
      stats.failed++;
    }
  }

  console.log("");
}

// ============================================================
// MAIN
// ============================================================
async function compressExistingImages() {
  console.log("🚀 Starting existing image compression...\n");
  console.log("⚙️  Configuration:", CONFIG);
  console.log("");

  if (CONFIG.dryRun) {
    console.log("⚠️  DRY RUN MODE - no changes will be saved\n");
  }

  const startTime = Date.now();

  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI or MONGO_URI not found. Check .env file.");
    }

    console.log("📡 Connecting to MongoDB...");
    await mongoose.connect(mongoUri, CONFIG.mongoOptions);
    console.log("✅ Connected to MongoDB\n");

    // ✅ Step 1: Count total (fixed: $nin instead of duplicate $ne)
    console.log("🔢 Counting applications with base64 images...");
    const totalCount = await Application.countDocuments({
      idImage: { $exists: true, $nin: [null, ""] },
    });
    stats.total = totalCount;
    console.log(`✅ Found ${totalCount} applications to check\n`);

    if (totalCount === 0) {
      console.log("✨ Nothing to compress!");
      return;
    }

    console.log("━".repeat(70));
    console.log("");

    // ✅ Step 2: Cursor streaming (fixed: $nin instead of duplicate $ne)
    const cursor = Application.find({
      idImage: { $exists: true, $nin: [null, ""] },
    })
      .select("_id applicationId firstName lastName idImage")
      .batchSize(CONFIG.batchSize)
      .cursor();

    let batchCount = 0;
    let currentBatch: any[] = [];
    const totalBatches = Math.ceil(totalCount / CONFIG.batchSize);

    for await (const app of cursor) {
      currentBatch.push(app);

      if (currentBatch.length >= CONFIG.batchSize) {
        batchCount++;
        await processBatch(currentBatch, batchCount, totalBatches);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      batchCount++;
      await processBatch(currentBatch, batchCount, totalBatches);
    }

    // SUMMARY
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const totalSaved = stats.originalSizeTotal - stats.compressedSizeTotal;
    const totalSavedPercent =
      stats.originalSizeTotal > 0
        ? ((totalSaved / stats.originalSizeTotal) * 100).toFixed(1)
        : "0";

    console.log("\n" + "━".repeat(70));
    console.log("📊 COMPRESSION SUMMARY");
    console.log("━".repeat(70));
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📋 Total found: ${stats.total}`);
    console.log(`✅ Processed: ${stats.processed}`);
    console.log(`⏭️  Skipped (already small): ${stats.skipped}`);
    console.log(`❌ Failed: ${stats.failed}`);
    console.log("");
    console.log(`📉 Original total: ${formatBytes(stats.originalSizeTotal)}`);
    console.log(
      `📈 Compressed total: ${formatBytes(stats.compressedSizeTotal)}`,
    );
    console.log(
      `💰 Space saved: ${formatBytes(totalSaved)} (-${totalSavedPercent}%)`,
    );
    console.log("━".repeat(70));

    if (CONFIG.dryRun) {
      console.log("\n⚠️  DRY RUN - no changes were saved to database");
      console.log("💡 Set CONFIG.dryRun = false to actually save changes");
    } else {
      console.log("\n🎉 Compression complete!");
    }
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
    process.exit(0);
  }
}

compressExistingImages();
