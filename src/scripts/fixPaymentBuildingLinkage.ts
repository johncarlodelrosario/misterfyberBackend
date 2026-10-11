import mongoose from "mongoose";
import dotenv from "dotenv";
import Payment from "../models/Payment";
import Application from "../models/Application";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not found");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");
  console.log("==================================================");
  console.log("MIGRATION: Add buildingId + buildingName to Payments");
  console.log("==================================================\n");

  // Hanapin lahat ng payments na may applicationId pero WALANG buildingName
  const payments = await Payment.find({
    applicationId: { $exists: true, $ne: null },
    $or: [
      { buildingName: { $exists: false } },
      { buildingName: "" },
      { buildingName: null },
    ],
  }).lean();

  console.log(`Found ${payments.length} payments to fix\n`);

  let fixedCount = 0;
  let skippedNoApp = 0;
  const details: any[] = [];

  for (const payment of payments) {
    // Kunin ang application
    const app = await Application.findOne({
      applicationId: payment.applicationId,
    }).lean();

    if (!app) {
      skippedNoApp++;
      console.log(`SKIP (no application): ${payment.referenceNumber} (appId: ${payment.applicationId})`);
      continue;
    }

    const buildingId = (app as any).buildingId;
    const buildingName = (app as any).buildingName;

    if (!buildingName) {
      console.log(`SKIP (app has no building): ${payment.referenceNumber} (appId: ${payment.applicationId})`);
      continue;
    }

    // I-update ang payment
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          buildingId: buildingId || null,
          buildingName: buildingName,
        },
      },
    );

    fixedCount++;
    details.push({
      referenceNumber: payment.referenceNumber,
      applicationId: payment.applicationId,
      buildingName: buildingName,
      amount: payment.amount,
      paymentType: payment.paymentType,
    });

    console.log(`FIXED ${payment.referenceNumber} -> ${buildingName}`);
  }

  console.log("\n==================================================");
  console.log("MIGRATION COMPLETE");
  console.log("==================================================");
  console.log(`Fixed                : ${fixedCount}`);
  console.log(`Skipped (no app)     : ${skippedNoApp}`);
  console.log("==================================================\n");

  if (details.length > 0) {
    console.log("Details:");
    console.log(JSON.stringify(details, null, 2));
  }

  await mongoose.disconnect();
  console.log("\nDisconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
