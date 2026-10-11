import mongoose from "mongoose";
import dotenv from "dotenv";
import Payment from "../models/Payment";
import Billing from "../models/Billing";

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

    const payments = await Payment.find({
      applicationId: target.appId,
    }).lean();

    console.log(`Payments found: ${payments.length}\n`);

    for (const p of payments) {
      console.log(`  Ref     : ${p.referenceNumber}`);
      console.log(`  Amount  : ₱${p.amount}`);
      console.log(`  Type    : ${p.paymentType}   ${p.paymentType === "pro_rated" ? "OK" : "<< DAPAT PRO_RATED"}`);
      console.log(`  Status  : ${p.status}`);
      console.log(`  BillID  : ${p.billingId || "WALA"}`);

      if (p.billingId) {
        const bill = await Billing.findById(p.billingId).lean();
        if (bill) {
          console.log(`    Bill invoice: ${bill.invoiceNumber}`);
          console.log(`    isProRated  : ${bill.isProRated}`);
          console.log(`    proRatedDays: ${bill.proRatedDays || 0}`);
          console.log(`    Total       : ₱${bill.total}`);
        }
      }
      console.log("");
    }
  }

  await mongoose.disconnect();
  console.log("Disconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
