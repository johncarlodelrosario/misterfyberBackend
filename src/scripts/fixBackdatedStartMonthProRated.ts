// backend/scripts/fixBackdatedStartMonthProRated.ts
// RUN: npx ts-node scripts/fixBackdatedStartMonthProRated.ts
// Or:  npx ts-node-dev scripts/fixBackdatedStartMonthProRated.ts

import mongoose from "mongoose";
import dotenv from "dotenv";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import Invoice from "../models/Invoice";
import Application from "../models/Application";

dotenv.config();

// ==================== HELPERS ====================
function formatDateForDisplay(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function getEndOfMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not found in .env");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("✅ Connected to MongoDB");
  console.log("==================================================");
  console.log("🔧 MIGRATION: Fix backdated start-month pro-rated");
  console.log("==================================================\n");

  // Get all billing cycles created via backdated billing
  const cycles = await BillingCycle.find({
    manualBillStart: true,
    applicationId: { $exists: true, $ne: null },
  }).lean();

  console.log(`📊 Found ${cycles.length} backdated billing cycles\n`);

  let inspectedCount = 0;
  let fixedCount = 0;
  let skippedAlreadyProRated = 0;
  let skippedNoBills = 0;
  let skippedPaid = 0;

  const fixedDetails: any[] = [];

  for (const cycle of cycles) {
    inspectedCount++;

    // Find the FIRST bill for this cycle (sorted by billingPeriod.start)
    const firstBill = await Billing.findOne({
      billingCycleId: cycle._id,
      isInstallationBill: false,
    })
      .sort({ "billingPeriod.start": 1 })
      .lean();

    if (!firstBill) {
      skippedNoBills++;
      continue;
    }

    // Already pro-rated? Skip.
    if (firstBill.isProRated === true) {
      skippedAlreadyProRated++;
      console.log(
        `⏭️  Cycle ${cycle._id} (${cycle.applicationId}) — already pro-rated, skip`,
      );
      continue;
    }

    // Already paid? Skip to avoid disrupting paid records.
    if (firstBill.status === "paid") {
      skippedPaid++;
      console.log(
        `⏭️  Cycle ${cycle._id} (${cycle.applicationId}) — first bill already PAID, skip (manual review needed)`,
      );
      continue;
    }

    // Determine the original service start from the first bill's billingPeriod.start
    const startDate = new Date(firstBill.billingPeriod.start);
    startDate.setHours(0, 0, 0, 0);

    const daysInMonth = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      0,
    ).getDate();
    const daysUsed = daysInMonth - startDate.getDate() + 1;
    const dailyRate = (cycle.monthlyRate * 12) / 365;

    let proRatedAmount: number;
    if (startDate.getDate() === 1 && daysInMonth === 31) {
      proRatedAmount = cycle.monthlyRate;
    } else {
      proRatedAmount = Math.round(dailyRate * daysUsed * 100) / 100;
    }

    const monthEnd = getEndOfMonth(startDate);

    const oldTotal = firstBill.total;
    const oldInvoiceNumber = firstBill.invoiceNumber;

    // ==================== UPDATE BILL ====================
    await Billing.updateOne(
      { _id: firstBill._id },
      {
        $set: {
          isProRated: true,
          proRatedDays: daysUsed,
          billingPeriod: { start: startDate, end: monthEnd },
          items: [
            {
              description: `Pro-rated payment from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(monthEnd)} (${daysUsed} days) - [MIGRATED]`,
              quantity: daysUsed,
              rate: dailyRate,
              amount: proRatedAmount,
            },
          ],
          subtotal: proRatedAmount,
          tax: 0,
          discount: 0,
          total: proRatedAmount,
        },
      },
    );

    // ==================== UPDATE INVOICE ====================
    const invoice = await Invoice.findOne({ billingId: firstBill._id });
    if (invoice) {
      await Invoice.updateOne(
        { _id: invoice._id },
        {
          $set: {
            isProRated: true,
            proRatedDays: daysUsed,
            invoiceType: "pro-rated",
            billingPeriod: { start: startDate, end: monthEnd },
            items: [
              {
                description: `Pro-rated payment from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(monthEnd)} (${daysUsed} days) - [MIGRATED]`,
                quantity: daysUsed,
                rate: dailyRate,
                amount: proRatedAmount,
                type: "pro-rated",
              },
            ],
            subtotal: proRatedAmount,
            taxRate: 0,
            taxAmount: 0,
            discountAmount: 0,
            total: proRatedAmount,
          },
        },
      );
    }

    fixedCount++;
    fixedDetails.push({
      cycleId: cycle._id.toString(),
      applicationId: cycle.applicationId,
      invoiceNumber: oldInvoiceNumber,
      startDate: startDate.toISOString().slice(0, 10),
      daysUsed,
      oldTotal,
      newTotal: proRatedAmount,
    });

    console.log(
      `✅ FIXED ${oldInvoiceNumber} (app ${cycle.applicationId}): monthly ₱${oldTotal} → pro-rated ₱${proRatedAmount} (${daysUsed} days)`,
    );
  }

  console.log("\n==================================================");
  console.log("🎉 MIGRATION COMPLETE");
  console.log("==================================================");
  console.log(`Total cycles inspected        : ${inspectedCount}`);
  console.log(`✅ Fixed to pro-rated         : ${fixedCount}`);
  console.log(`⏭️  Skipped (already pro-rated): ${skippedAlreadyProRated}`);
  console.log(`⏭️  Skipped (already PAID)     : ${skippedPaid}`);
  console.log(`⏭️  Skipped (no bills found)   : ${skippedNoBills}`);
  console.log("==================================================\n");

  if (fixedDetails.length > 0) {
    console.log("📋 Details of fixed bills:");
    console.log(JSON.stringify(fixedDetails, null, 2));
  }

  await mongoose.disconnect();
  console.log("\n✅ Disconnected from MongoDB");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
