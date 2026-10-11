import mongoose from "mongoose";
import dotenv from "dotenv";
import Payment from "../models/Payment";
import Billing from "../models/Billing";

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
  console.log("MIGRATION: Fix paymentType for old pro-rated bills");
  console.log("==================================================\n");

  // Get all payments with billingId
  const payments = await Payment.find({
    billingId: { $exists: true, $ne: null },
  }).lean();

  console.log(`Found ${payments.length} payments to inspect\n`);

  let fixedCount = 0;
  let alreadyCorrect = 0;
  let notProRated = 0;
  const details: any[] = [];

  for (const payment of payments) {
    const bill = await Billing.findById(payment.billingId).lean();
    if (!bill) continue;

    // Only fix bills that ARE pro-rated but payment type is wrong
    if (bill.isProRated !== true) {
      notProRated++;
      continue;
    }

    if (payment.paymentType === "pro_rated") {
      alreadyCorrect++;
      continue;
    }

    // Fix it
    const oldType = payment.paymentType;
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { paymentType: "pro_rated" } },
    );

    fixedCount++;
    details.push({
      paymentId: payment._id,
      referenceNumber: payment.referenceNumber,
      invoiceNumber: bill.invoiceNumber,
      oldType,
      newType: "pro_rated",
      amount: payment.amount,
    });

    console.log(`FIXED ${payment.referenceNumber}: ${oldType} -> pro_rated (₱${payment.amount})`);
  }

  console.log("\n==================================================");
  console.log("MIGRATION COMPLETE");
  console.log("==================================================");
  console.log(`Fixed to pro_rated       : ${fixedCount}`);
  console.log(`Already correct          : ${alreadyCorrect}`);
  console.log(`Not pro-rated (skip)     : ${notProRated}`);
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
