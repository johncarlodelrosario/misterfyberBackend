import mongoose from "mongoose";
import dotenv from "dotenv";
import Payment from "../models/Payment";
import Application from "../models/Application";

dotenv.config();

const TARGETS = [
  { appId: "NEW26094666842", name: "Angelica Mae Gonda" },
  { appId: "NEW26092834120", name: "Rj Lasiste" },
  { appId: "NEW26103270419", name: "HIyasmin Villamor" },
];

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not found");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB\n");

  for (const target of TARGETS) {
    console.log("==================================================");
    console.log(`${target.name} (${target.appId})`);
    console.log("==================================================");

    // Get the application
    const app = await Application.findOne({
      applicationId: target.appId,
    }).lean();

    if (app) {
      console.log(`Application:`);
      console.log(`  buildingId  : ${(app as any).buildingId || "WALA"}`);
      console.log(`  buildingName: ${(app as any).buildingName || "WALA"}`);
      console.log(`  email       : ${app.email}`);
    } else {
      console.log(`  APPLICATION NOT FOUND!`);
    }

    // Get payments
    const payments = await Payment.find({
      applicationId: target.appId,
    }).lean();

    console.log(`\nPayments (${payments.length}):`);
    for (const p of payments) {
      console.log(`  ${p.referenceNumber}`);
      console.log(`    paymentType : ${p.paymentType}`);
      console.log(`    amount      : ₱${p.amount}`);
      console.log(`    status      : ${p.status}`);
      console.log(`    applicationId: ${p.applicationId}`);
      console.log(`    buildingId  : ${(p as any).buildingId || "WALA"}`);
      console.log(`    buildingName: ${(p as any).buildingName || "WALA"}`);
      console.log(`    customerName: ${p.customerName || "(walang laman)"}`);
    }

    console.log("");
  }

  await mongoose.disconnect();
  console.log("Disconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
