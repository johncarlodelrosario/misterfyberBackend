import mongoose from "mongoose";
import dotenv from "dotenv";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import Invoice from "../models/Invoice";
import Payment from "../models/Payment";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) { console.error("No URI"); process.exit(1); }

  await mongoose.connect(mongoUri);
  console.log("Connected\n");

  const wrongBills = await Billing.find({
    isProRated: true,
    isInstallationBill: false,
    proRatedDays: 1,
  }).lean();

  console.log(`Found ${wrongBills.length} candidates\n`);

  let revertedCount = 0;

  for (const bill of wrongBills) {
    const start = new Date(bill.billingPeriod.start);
    if (start.getDate() !== 1) continue;

    const cycle = await BillingCycle.findById(bill.billingCycleId).lean();
    if (!cycle) continue;

    const monthlyRate = cycle.monthlyRate;

    if (Math.abs(bill.total - monthlyRate) < 0.01) {
      await Billing.updateOne(
        { _id: bill._id },
        { $set: { isProRated: false, proRatedDays: 0 } },
      );

      const invoice = await Invoice.findOne({ billingId: bill._id });
      if (invoice) {
        await Invoice.updateOne(
          { _id: invoice._id },
          { $set: { isProRated: false, proRatedDays: 0 } },
        );
      }

      const payment = await Payment.findOne({ billingId: bill._id });
      if (payment && payment.paymentType === "pro_rated") {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { paymentType: "subscription" } },
        );
      }

      revertedCount++;
      console.log(`REVERTED ${bill.invoiceNumber} (₱${bill.total})`);
    }
  }

  console.log(`\nTotal reverted: ${revertedCount}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
