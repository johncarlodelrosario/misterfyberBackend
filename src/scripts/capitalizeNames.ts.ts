// src/scripts/capitalizeNames.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import Application from "../models/Application";

// Load .env from backend root (two levels up: scripts -> src -> backend)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ✅ ALL CAPS version
const toAllCaps = (str: string): string => {
  if (!str || typeof str !== "string") return "";
  return str.trim().toUpperCase();
};

async function run() {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

    if (!uri) {
      throw new Error("❌ No MongoDB URI found in .env");
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 60000,
    });
    console.log("✅ Connected\n");

    const apps = await Application.find().lean();
    console.log(`📊 Found ${apps.length} applications\n`);

    let updated = 0;
    let skipped = 0;

    for (const app of apps) {
      const newFirst = toAllCaps(app.firstName || "");
      const newLast = toAllCaps(app.lastName || "");
      const newMiddle = toAllCaps(app.middleName || "");

      if (
        newFirst !== (app.firstName || "") ||
        newLast !== (app.lastName || "") ||
        newMiddle !== (app.middleName || "")
      ) {
        await Application.updateOne(
          { _id: app._id },
          {
            $set: {
              firstName: newFirst,
              lastName: newLast,
              middleName: newMiddle,
            },
          },
        );
        updated++;
        console.log(
          `  ✅ ${app.applicationId}: "${app.firstName} ${app.lastName}" → "${newFirst} ${newLast}"`,
        );
      } else {
        skipped++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   Updated:  ${updated}`);
    console.log(`   Skipped:  ${skipped}`);
    console.log(`   Total:    ${apps.length}`);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected");
  }
}

run();
