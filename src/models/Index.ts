// models/index.ts
import mongoose from "mongoose";

// Import all models
import User from "./User";
import Admin from "./Admin";
import Plan from "./Plan";
import Payment from "./Payment";
import Billing from "./Billing";
import BillingCycle from "./BillingCycle";
import BillingSettings from "./BillingSettings";
import Application from "./Application";

// Function to ensure all indexes are created
export async function ensureIndexes() {
  console.log("🔍 Creating database indexes for performance...");

  const startTime = Date.now();

  try {
    // User indexes
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ username: 1 }, { unique: true });
    await User.collection.createIndex({ status: 1 });
    await User.collection.createIndex({ planId: 1 });
    await User.collection.createIndex({ createdAt: -1 });
    await User.collection.createIndex({ "mikrotik.username": 1 });
    await User.collection.createIndex({ "billingInfo.billingCycleId": 1 });
    await User.collection.createIndex({ status: 1, createdAt: -1 });

    // Payment indexes
    await Payment.collection.createIndex({ userId: 1, createdAt: -1 });
    await Payment.collection.createIndex({ status: 1, createdAt: -1 });
    await Payment.collection.createIndex(
      { referenceNumber: 1 },
      { unique: true, sparse: true },
    );
    await Payment.collection.createIndex({ billingId: 1 });
    await Payment.collection.createIndex({ status: 1, paidAt: -1 });
    await Payment.collection.createIndex({ createdAt: -1 });
    await Payment.collection.createIndex({ userId: 1, status: 1, paidAt: -1 });

    // Billing indexes
    await Billing.collection.createIndex({ userId: 1, status: 1, dueDate: 1 });
    await Billing.collection.createIndex({ userId: 1, createdAt: -1 });
    await Billing.collection.createIndex({ status: 1, dueDate: 1 });
    await Billing.collection.createIndex(
      { invoiceNumber: 1 },
      { unique: true },
    );
    await Billing.collection.createIndex({ billingCycleId: 1 });
    await Billing.collection.createIndex({ isProRated: 1, status: 1 });
    await Billing.collection.createIndex({ dueDate: 1, status: 1 });
    await Billing.collection.createIndex({
      userId: 1,
      isProRated: 1,
      status: 1,
    });

    // BillingCycle indexes
    await BillingCycle.collection.createIndex({ userId: 1, status: 1 });
    await BillingCycle.collection.createIndex({ userId: 1 });
    await BillingCycle.collection.createIndex({
      status: 1,
      nextBillingDate: 1,
    });
    await BillingCycle.collection.createIndex({
      "pendingPlanChange.status": 1,
    });
    await BillingCycle.collection.createIndex({
      status: 1,
      proRatedPaid: 1,
      manualBillStart: 1,
    });

    // Application indexes
    await Application.collection.createIndex({ applicationId: 1 });
    await Application.collection.createIndex({ email: 1 });
    await Application.collection.createIndex({ status: 1 });
    await Application.collection.createIndex({ createdAt: -1 });
    await Application.collection.createIndex({ status: 1, createdAt: -1 });

    // Admin indexes
    await Admin.collection.createIndex({ email: 1 }, { unique: true });
    await Admin.collection.createIndex({ username: 1 }, { unique: true });

    // Plan indexes
    if (Plan.collection) {
      await Plan.collection.createIndex({ isActive: 1 });
      await Plan.collection.createIndex({ price: 1 });
    }

    const duration = Date.now() - startTime;
    console.log(`✅ All database indexes created in ${duration}ms`);
  } catch (error) {
    console.error("❌ Error creating indexes:", error);
    throw error;
  }
}

// Re-export all models
export {
  User,
  Admin,
  Plan,
  Payment,
  Billing,
  BillingCycle,
  BillingSettings,
  Application,
};

export default {
  User,
  Admin,
  Plan,
  Payment,
  Billing,
  BillingCycle,
  BillingSettings,
  Application,
  ensureIndexes,
};
