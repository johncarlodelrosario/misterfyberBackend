// src/scripts/compress-mongodb-images.ts
// Compresses base64 images stored directly in MongoDB (Application.idImage)
// Run: DRY_RUN=true npx ts-node src/scripts/compress-mongodb-images.ts
// Then: DRY_RUN=false npx ts-node src/scripts/compress-mongodb-images.ts

import mongoose from "mongoose";
import sharp from "sharp";
import dotenv from "dotenv";
import path from "path";

// ============================================================
// LOAD .env (same style as your app.ts)
// ============================================================
const envPath = path.join(process.cwd(), ".env");
console.log(`📁 Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });
console.log(`✅ .env file loaded successfully\n`);

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  mongoUri: process.env.MONGODB_URI || "",
  maxWidthOrHeight: 1280,
  quality: 75,
  minSizeToCompress: 100 * 1024, // 100KB
  dryRun: process.env.DRY_RUN !== "false",
};

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// ============================================================
// COMPRESS A SINGLE BASE64 STRING
// ============================================================
const compressBase64 = async (
  base64String: string,
): Promise<{ compressed: string; originalSize: number; newSize: number }> => {
  const matches = base64String.match(/^data:([A-Za-z0-9-+/]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid base64 format");
  }

  const buffer = Buffer.from(matches[2], "base64");
  const originalSize = buffer.length;

  if (originalSize < CONFIG.minSizeToCompress) {
    return { compressed: base64String, originalSize, newSize: originalSize };
  }

  const metadata = await sharp(buffer).metadata();

  let pipeline = sharp(buffer);
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

  const compressedBuffer = await pipeline
    .jpeg({ quality: CONFIG.quality, progressive: true, mozjpeg: true })
    .toBuffer();

  return {
    compressed: `data:image/jpeg;base64,${compressedBuffer.toString("base64")}`,
    originalSize,
    newSize: compressedBuffer.length,
  };
};

// ============================================================
// MAIN
// ============================================================
const main = async () => {
  console.log("🗜️  ============================================");
  console.log("🗜️  MONGODB BASE64 IMAGE COMPRESSION");
  console.log("🗜️  ============================================");
  console.log(`⚙️  Max dimension: ${CONFIG.maxWidthOrHeight}px`);
  console.log(`⚙️  Quality: ${CONFIG.quality}%`);
  console.log(`⚙️  Min size: ${formatSize(CONFIG.minSizeToCompress)}`);
  console.log(
    `⚙️  Mode: ${CONFIG.dryRun ? "DRY RUN (no changes)" : "LIVE (will modify DB)"}`,
  );
  console.log("");

  if (!CONFIG.mongoUri) {
    throw new Error("MONGODB_URI not set in .env");
  }

  console.log("🔗 Connecting to MongoDB...");
  await mongoose.connect(CONFIG.mongoUri, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 60000,
  });
  console.log("✅ Connected\n");

  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not available");

  const collection = db.collection("applications");

  const applications = await collection
    .find({ idImage: { $regex: "^data:" } })
    .project({
      _id: 1,
      applicationId: 1,
      idImage: 1,
      firstName: 1,
      lastName: 1,
    })
    .toArray();

  console.log(
    `📊 Found ${applications.length} applications with base64 images\n`,
  );

  if (applications.length === 0) {
    console.log("✨ Nothing to compress. Done!");
    await mongoose.disconnect();
    return;
  }

  let totalOrig = 0;
  let totalNew = 0;
  let compressed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < applications.length; i++) {
    const app: any = applications[i];
    const size = app.idImage?.length || 0;

    console.log(
      `\n[${i + 1}/${applications.length}] ${app.applicationId} - ${app.firstName} ${app.lastName}`,
    );
    console.log(`   Original: ${formatSize(size)}`);

    if (size < CONFIG.minSizeToCompress) {
      console.log(`   ⏭️  Skipped (too small)`);
      skipped++;
      continue;
    }

    try {
      const result = await compressBase64(app.idImage);
      totalOrig += result.originalSize;
      totalNew += result.newSize;

      if (result.newSize >= result.originalSize) {
        console.log(`   ⏭️  Skipped (no gain)`);
        skipped++;
        continue;
      }

      const saved = ((1 - result.newSize / result.originalSize) * 100).toFixed(
        1,
      );
      console.log(
        `   Compressed: ${formatSize(result.originalSize)} → ${formatSize(result.newSize)} (${saved}% saved)`,
      );

      if (!CONFIG.dryRun) {
        await collection.updateOne(
          { _id: app._id },
          { $set: { idImage: result.compressed } },
        );
        console.log(`   ✅ Saved to MongoDB`);
      } else {
        console.log(`   🔍 [DRY RUN] Would update`);
      }

      compressed++;
    } catch (err: any) {
      console.error(`   ❌ Failed: ${err.message}`);
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
    console.log("   Run with DRY_RUN=false to apply.");
  }

  await mongoose.disconnect();
  console.log("\n✅ Disconnected");
};

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
