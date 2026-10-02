// src/scripts/checkSize.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import Application from "../models/Application";

async function checkSize() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const app = await Application.findOne({
    applicationId: "SIL26097894519",
  });

  if (!app) {
    console.log("❌ Not found");
    return;
  }

  const idImage = app.idImage || "";
  const sizeKB = idImage.length / 1024;
  const sizeMB = sizeKB / 1024;

  console.log("📋 Application:", app.applicationId);
  console.log("👤 Name:", `${app.firstName} ${app.lastName}`);
  console.log(
    "📏 Image size:",
    sizeMB > 1 ? `${sizeMB.toFixed(2)} MB` : `${sizeKB.toFixed(2)} KB`,
  );
  console.log(
    "✅ Status:",
    sizeKB < 500 ? "COMPRESSED ✅" : "NOT COMPRESSED ❌",
  );
  console.log("📅 Created:", app.createdAt);
  console.log("📅 Updated:", app.updatedAt);

  await mongoose.disconnect();
}

checkSize();
