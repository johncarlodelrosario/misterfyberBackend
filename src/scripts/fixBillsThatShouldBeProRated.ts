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
  console.log("Connected");
  console.log("==================================================");
  console.log("MIGRATION: Fix bills that should be pro-rated");
  console.log("==================================================\n");

  // Hanapin lahat ng bills na:
  // - Hindi installation
  // - Hindi pro-rated (mali)
  // - Ang billing period ay partial month (start day != 1 o end day != last day)
  const allBills = await Billing.find({
    isInstallationBill: false,
    isProRated: false,
  }).lean();

  console.log(`Total non-pro-rated monthly bills: ${allBills.length}\n`);

  let fixedCount = 0;
  const details: any[] = [];

  for (const bill of allBills) {
    const start = new Date(bill.billingPeriod.start);
    const end = new Date(bill.billingPeriod.end);

    const startDay = start.getDate();
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const endDay = end.getDate();

    // Kung start day ay 1 at end day ay last day ng month → regular monthly
    const isFullMonth = startDay === 1 && endDay === daysInMonth;

    if (isFullMonth) continue;

    // Ito ay dapat pro-rated — pero naka-tag as regular
    console.log(`FIX: ${bill.invoiceNumber}`);
    console.log(`  Period: ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`);
    console.log(`  Total : ₱${bill.total}`);
    console.log(`  Days  : ${endDay - startDay + 1}`);

    const cycle = await BillingCycle.findById(bill.billingCycleId).lean();
    const monthlyRate = cycle?.monthlyRate || 0;
    const dailyRate = (monthlyRate * 12) / 365;
    const proRatedDays = endDay - startDay + 1;

    await Billing.updateOne(
      { _id: bill._id },
      {
        $set: {
          isProRated: true,
          proRatedDays: proRatedDays,
        },
      },
    );

    const invoice = await Invoice.findOne({ billingId: bill._id });
    if (invoice) {
      await Invoice.updateOne(
        { _id: invoice._id },
        { $set: { isProRated: true, proRatedDays: proRatedDays } },
      );
    }

    // Fix associated payment
    const payment = await Payment.findOne({ billingId: bill._id });
    if (payment && payment.paymentType === "subscription") {
      await Payment.updateOne(
        { _id: payment._id },
        { $set: { paymentType: "pro_rated" } },
      );
      console.log(`  Payment fixed: subscription -> pro_rated`);
    }

    fixedCount++;
    details.push({
      invoiceNumber: bill.invoiceNumber,
      applicationId: bill.applicationId,
      period: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
      proRatedDays,
      total: bill.total,
    });
    console.log("");
  }

  console.log("==================================================");
  console.log("MIGRATION COMPLETE");
  console.log("==================================================");
  console.log(`Fixed: ${fixedCount}`);
  console.log("==================================================\n");

  if (details.length > 0) {
    console.log("Details:");
    console.log(JSON.stringify(details, null, 2));
  }

  await mongoose.disconnect();
  console.log("Disconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
