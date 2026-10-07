// backend/src/scripts/runProRatedMigration.ts

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

// ✅ CRITICAL: I-load muna ang .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ==================== FORCE-REGISTER ALL MODELS ====================
// Ito ang workaround para siguradong naka-register lahat ng models
import "../models/Payment";
import "../models/Billing";
import "../models/BillingCycle";
import "../models/User";
import "../models/Application";
import "../models/Plan";
import "../models/Invoice";

import Payment from "../models/Payment";

async function runMigration() {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      process.env.MONGODB_URL ||
      "";

    if (!mongoUri) {
      console.error("❌ ERROR: MONGODB_URI not set in .env");
      process.exit(1);
    }

    console.log("========================================");
    console.log("🔧 PRO-RATED PAYMENT TYPE MIGRATION");
    console.log("========================================");
    console.log("🔌 Connecting to MongoDB...");

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB\n");

    // ==================== DEBUG: I-check kung naka-register lahat ====================
    console.log("📋 Registered models:");
    const models = mongoose.modelNames();
    console.log("   - Payment:", models.includes("Payment") ? "✅" : "❌");
    console.log("   - Billing:", models.includes("Billing") ? "✅" : "❌");
    console.log("   - BillingCycle:", models.includes("BillingCycle") ? "✅" : "❌");
    console.log("   - User:", models.includes("User") ? "✅" : "❌");
    console.log("   - Application:", models.includes("Application") ? "✅" : "❌");
    console.log("   - Plan:", models.includes("Plan") ? "✅" : "❌");
    console.log("   - Invoice:", models.includes("Invoice") ? "✅" : "❌");
    console.log("\n📋 All registered models:", models.join(", "));
    console.log("");

    // ✅ KUNG WALA PA RIN ANG BILLING, I-LOAD DIRECTLY
    if (!models.includes("Billing")) {
      console.log("⚠️  Billing model NOT registered — attempting direct load...");
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const BillingModule = require("../models/Billing");
        console.log("   ✅ Billing module loaded:", Object.keys(BillingModule));
        console.log("   After load, models:", mongoose.modelNames().join(", "));
      } catch (err: any) {
        console.error("   ❌ Failed to load Billing module:", err.message);
        console.error(err.stack);
        throw new Error("Cannot load Billing model. Check src/models/Billing.ts");
      }
    }

    console.log("\n🔍 Searching for misclassified payments...\n");

    const payments = await Payment.find({
      billingId: { $exists: true, $ne: null },
    })
      .populate("billingId", "isProRated isInstallationBill installationFee")
      .lean();

    console.log(`📊 Total payments with billing: ${payments.length}\n`);

    let fixedToProRated = 0;
    let fixedToInstallation = 0;
    let fixedToSubscription = 0;
    const details: any[] = [];

    for (const payment of payments) {
      const billing = payment.billingId as any;
      if (!billing) continue;

      let correctType = payment.paymentType;

      if (billing.isInstallationBill === true) {
        correctType = "installation";
      } else if (billing.installationFee && billing.installationFee > 0) {
        correctType = "installation";
      } else if (billing.isProRated === true) {
        correctType = "pro_rated";
      } else if (
        payment.paymentType !== "subscription" &&
        payment.paymentType !== "installation" &&
        payment.paymentType !== "pro_rated" &&
        payment.paymentType !== "others"
      ) {
        correctType = "subscription";
      }

      if (correctType !== payment.paymentType) {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { paymentType: correctType } },
        );

        if (correctType === "pro_rated") fixedToProRated++;
        else if (correctType === "installation") fixedToInstallation++;
        else if (correctType === "subscription") fixedToSubscription++;

        details.push({
          referenceNumber: payment.referenceNumber,
          oldType: payment.paymentType,
          newType: correctType,
        });

        console.log(
          `✅ ${payment.referenceNumber}: "${payment.paymentType}" → "${correctType}" (₱${payment.amount})`,
        );
      }
    }

    console.log("\n========================================");
    console.log("🎉 MIGRATION COMPLETE");
    console.log("========================================");
    console.log(`   → pro_rated:      ${fixedToProRated}`);
    console.log(`   → installation:   ${fixedToInstallation}`);
    console.log(`   → subscription:   ${fixedToSubscription}`);
    console.log(
      `   Total fixed:      ${fixedToProRated + fixedToInstallation + fixedToSubscription}`,
    );
    console.log(`   Total checked:    ${payments.length}`);
    console.log("========================================\n");

    if (details.length > 0) {
      console.log("📋 Detailed changes:");
      details.forEach((d, i) => {
        console.log(`   ${i + 1}. ${d.referenceNumber}: ${d.oldType} → ${d.newType}`);
      });
      console.log("");
    } else {
      console.log("ℹ️  No misclassified payments found.\n");
    }

    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
    console.log("✅ Migration done!\n");
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ Migration failed:", error.message);
    console.error(error.stack);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  }
}

runMigration();
