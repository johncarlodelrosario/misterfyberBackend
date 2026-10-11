import mongoose from "mongoose";
import dotenv from "dotenv";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import Invoice from "../models/Invoice";

dotenv.config();

function formatDateForDisplay(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not found");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");
  console.log("==================================================");
  console.log("MIGRATION: Start-of-month bills -> full monthly rate");
  console.log("==================================================\n");

  // Find all pro-rated bills where start date is 1st of month
  const proRatedBills = await Billing.find({
    isProRated: true,
    isInstallationBill: false,
  }).lean();

  console.log(`Found ${proRatedBills.length} pro-rated bills to inspect\n`);

  let fixedCount = 0;
  let skippedNotFirst = 0;
  let skippedAlreadyFull = 0;
  let skippedPaid = 0;
  const details: any[] = [];

  for (const bill of proRatedBills) {
    const startDate = new Date(bill.billingPeriod.start);

    // Only fix bills that started on the 1st of the month
    if (startDate.getDate() !== 1) {
      skippedNotFirst++;
      continue;
    }

    // Skip if paid — avoid disturbing financial records
    if (bill.status === "paid") {
      skippedPaid++;
      console.log(`SKIP (paid): ${bill.invoiceNumber} — start 1st, needs manual review`);
      continue;
    }

    // Get the billing cycle to know the monthly rate
    const cycle = await BillingCycle.findById(bill.billingCycleId).lean();
    if (!cycle) {
      console.log(`SKIP (no cycle): ${bill.invoiceNumber}`);
      continue;
    }

    const monthlyRate = cycle.monthlyRate;
    const currentTotal = bill.total;

    // Already full rate? Skip.
    if (Math.abs(currentTotal - monthlyRate) < 0.01) {
      skippedAlreadyFull++;
      console.log(`OK: ${bill.invoiceNumber} — already ₱${monthlyRate}`);
      continue;
    }

    // Fix it — charge full monthly rate
    const daysInMonth = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      0,
    ).getDate();

    const newItems = [
      {
        description: `Pro-rated payment from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(new Date(startDate.getFullYear(), startDate.getMonth(), daysInMonth, 23, 59, 59, 999))} (${daysInMonth} days) - [START-OF-MONTH FIX]`,
        quantity: daysInMonth,
        rate: monthlyRate / daysInMonth,
        amount: monthlyRate,
      },
    ];

    await Billing.updateOne(
      { _id: bill._id },
      {
        $set: {
          proRatedDays: daysInMonth,
          items: newItems,
          subtotal: monthlyRate,
          total: monthlyRate,
        },
      },
    );

    const invoice = await Invoice.findOne({ billingId: bill._id });
    if (invoice) {
      await Invoice.updateOne(
        { _id: invoice._id },
        {
          $set: {
            proRatedDays: daysInMonth,
            items: newItems.map((i) => ({ ...i, type: "pro-rated" })),
            subtotal: monthlyRate,
            total: monthlyRate,
          },
        },
      );
    }

    fixedCount++;
    details.push({
      invoiceNumber: bill.invoiceNumber,
      applicationId: bill.applicationId,
      startDate: startDate.toISOString().slice(0, 10),
      daysInMonth,
      oldTotal: currentTotal,
      newTotal: monthlyRate,
    });

    console.log(`FIXED ${bill.invoiceNumber}: ₱${currentTotal} -> ₱${monthlyRate} (full month, ${daysInMonth} days, tagged pro-rated)`);
  }

  console.log("\n==================================================");
  console.log("MIGRATION COMPLETE");
  console.log("==================================================");
  console.log(`Fixed to full monthly rate   : ${fixedCount}`);
  console.log(`Skipped (not 1st of month)   : ${skippedNotFirst}`);
  console.log(`Skipped (already full rate)  : ${skippedAlreadyFull}`);
  console.log(`Skipped (paid - manual)      : ${skippedPaid}`);
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
