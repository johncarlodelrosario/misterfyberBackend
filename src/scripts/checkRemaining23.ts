import mongoose from "mongoose";
import dotenv from "dotenv";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) process.exit(1);

  await mongoose.connect(mongoUri);
  console.log("Connected\n");

  const wrong = await Billing.find({
    isProRated: true,
    isInstallationBill: false,
    proRatedDays: 1,
  }).lean();

  console.log(`Found ${wrong.length} remaining wrong bills\n`);
  console.log("==================================================");

  for (const bill of wrong) {
    const cycle = await BillingCycle.findById(bill.billingCycleId).lean();
    const monthlyRate = cycle?.monthlyRate || 0;

    console.log(`\nInvoice : ${bill.invoiceNumber}`);
    console.log(`App ID  : ${bill.applicationId}`);
    console.log(`Total   : ₱${bill.total}`);
    console.log(`Monthly : ₱${monthlyRate}`);
    console.log(`Match?  : ${Math.abs(bill.total - monthlyRate) < 0.01 ? "YES" : "NO"}`);
    console.log(`Period  : ${bill.billingPeriod.start.toISOString().slice(0, 10)} to ${bill.billingPeriod.end.toISOString().slice(0, 10)}`);
    console.log(`Status  : ${bill.status}`);
    console.log(`CycleID : ${bill.billingCycleId || "WALA"}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
