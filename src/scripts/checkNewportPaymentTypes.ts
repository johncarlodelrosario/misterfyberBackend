import mongoose from "mongoose";
import dotenv from "dotenv";
import Payment from "../models/Payment";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not found");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB\n");

  const payments = await Payment.find({
    customerName: { $exists: true },
  }).lean();

  console.log(`Total payments: ${payments.length}\n`);
  console.log("==================================================");
  console.log("PAYMENT TYPE BREAKDOWN (ALL PAYMENTS)");
  console.log("==================================================");

  const byType: Record<string, number> = {};
  for (const p of payments) {
    const t = p.paymentType || "(walang type)";
    byType[t] = (byType[t] || 0) + 1;
  }

  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type.padEnd(15)} : ${count}`);
  }

  console.log("\n==================================================");
  console.log("NEWPORT CUSTOMERS — PAYMENT TYPES");
  console.log("==================================================\n");

  const newportPayments = await Payment.find({
    $or: [
      { buildingName: "Newport Residences" },
      { customerName: { $exists: true } },
    ],
  }).lean();

  // Filter: hanapin ang payments ng 3 customers na may 3 payments
  const targets = [
    "Angelica Mae Gonda",
    "Rj Lasiste",
    "HIyasmin Villamor",
  ];

  for (const name of targets) {
    const custPayments = await Payment.find({
      customerName: { $regex: name, $options: "i" },
    }).lean();

    console.log(`\n${name} (${custPayments.length} payments):`);
    for (const p of custPayments) {
      console.log(
        `  ${p.referenceNumber} | ₱${p.amount} | type: ${p.paymentType} | status: ${p.status} | billingId: ${p.billingId || "WALA"}`,
      );
    }
  }

  await mongoose.disconnect();
  console.log("\nDisconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
