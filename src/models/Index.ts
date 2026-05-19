// models/Index.ts - COMPLETE WITH ALL OPTIMIZED INDEXES AND ERROR HANDLING
import mongoose from "mongoose";
import User from "./User";
import Admin from "./Admin";
import Plan from "./Plan";
import Payment from "./Payment";
import Billing from "./Billing";
import BillingCycle from "./BillingCycle";
import BillingSettings from "./BillingSettings";
import Application from "./Application";
import Building from "./Building";
import Notification from "./Notification";

// Helper function to safely create indexes with conflict handling
async function safeCreateIndex(
  collection: mongoose.Collection,
  keys: any,
  options: any = {},
) {
  try {
    await collection.createIndex(keys, options);
  } catch (error: any) {
    if (error.code === 86) {
      // Index conflict - try to drop and recreate
      const indexName = options.name || Object.keys(keys).join("_") + "_1";
      console.log(
        `⚠️ Index conflict detected for ${indexName}, attempting to recreate...`,
      );
      try {
        await collection.dropIndex(indexName);
        await collection.createIndex(keys, options);
        console.log(`✅ Recreated index: ${indexName}`);
      } catch (dropError: any) {
        if (dropError.code !== 27) {
          // 27 = IndexNotFound
          console.log(
            `⚠️ Could not recreate index ${indexName}:`,
            dropError.message,
          );
        }
      }
    } else {
      throw error;
    }
  }
}

export async function ensureIndexes() {
  console.log("🔍 Creating/Ensuring database indexes for performance...");
  const startTime = Date.now();

  try {
    // ==================== USER INDEXES ====================
    await safeCreateIndex(User.collection, { email: 1 }, { unique: true });
    await safeCreateIndex(User.collection, { username: 1 }, { unique: true });
    await safeCreateIndex(User.collection, { status: 1 });
    await safeCreateIndex(User.collection, { planId: 1 });
    await safeCreateIndex(User.collection, { createdAt: -1 });
    await safeCreateIndex(User.collection, { "mikrotik.username": 1 });
    await safeCreateIndex(User.collection, { "billingInfo.billingCycleId": 1 });
    await safeCreateIndex(User.collection, { status: 1, createdAt: -1 });
    await safeCreateIndex(User.collection, { firstName: 1, lastName: 1 });
    await safeCreateIndex(User.collection, { email: 1, status: 1 });
    await safeCreateIndex(User.collection, {
      status: 1,
      planId: 1,
      createdAt: -1,
    });
    console.log("✅ User indexes created");

    // ==================== PAYMENT INDEXES ====================
    await safeCreateIndex(Payment.collection, { userId: 1, createdAt: -1 });
    await safeCreateIndex(Payment.collection, { status: 1, createdAt: -1 });
    await safeCreateIndex(
      Payment.collection,
      { referenceNumber: 1 },
      { unique: true, sparse: true, name: "referenceNumber_idx" }, // Changed name to avoid conflict
    );
    await safeCreateIndex(Payment.collection, { billingId: 1 });
    await safeCreateIndex(Payment.collection, { status: 1, paidAt: -1 });
    await safeCreateIndex(Payment.collection, { createdAt: -1 });
    await safeCreateIndex(Payment.collection, {
      userId: 1,
      status: 1,
      paidAt: -1,
    });
    await safeCreateIndex(Payment.collection, { status: 1, createdAt: 1 });
    await safeCreateIndex(Payment.collection, {
      status: 1,
      createdAt: 1,
      amount: 1,
    });
    console.log("✅ Payment indexes created");

    // ==================== BILLING INDEXES ====================
    await safeCreateIndex(Billing.collection, {
      userId: 1,
      status: 1,
      dueDate: 1,
    });
    await safeCreateIndex(Billing.collection, { userId: 1, createdAt: -1 });
    await safeCreateIndex(Billing.collection, { status: 1, dueDate: 1 });
    await safeCreateIndex(
      Billing.collection,
      { invoiceNumber: 1 },
      { unique: true, name: "invoiceNumber_idx" },
    );
    await safeCreateIndex(Billing.collection, { billingCycleId: 1 });
    await safeCreateIndex(Billing.collection, { isProRated: 1, status: 1 });
    await safeCreateIndex(Billing.collection, { dueDate: 1, status: 1 });
    await safeCreateIndex(Billing.collection, {
      userId: 1,
      isProRated: 1,
      status: 1,
    });
    await safeCreateIndex(Billing.collection, {
      status: 1,
      dueDate: 1,
      reminder7DaySent: 1,
    });
    await safeCreateIndex(Billing.collection, {
      billingCycleId: 1,
      status: 1,
      dueDate: 1,
    });
    console.log("✅ Billing indexes created");

    // ==================== BILLING CYCLE INDEXES ====================
    await safeCreateIndex(BillingCycle.collection, { userId: 1, status: 1 });
    await safeCreateIndex(BillingCycle.collection, { userId: 1 });
    await safeCreateIndex(BillingCycle.collection, {
      status: 1,
      nextBillingDate: 1,
    });
    await safeCreateIndex(BillingCycle.collection, {
      "pendingPlanChange.status": 1,
    });
    await safeCreateIndex(BillingCycle.collection, {
      status: 1,
      proRatedPaid: 1,
      manualBillStart: 1,
    });
    await safeCreateIndex(BillingCycle.collection, {
      nextBillingDate: 1,
      status: 1,
    });
    await safeCreateIndex(BillingCycle.collection, {
      userId: 1,
      status: 1,
      proRatedPaid: 1,
    });
    console.log("✅ BillingCycle indexes created");

    // ==================== APPLICATION INDEXES (OPTIMIZED) ====================
    await safeCreateIndex(Application.collection, { applicationId: 1 });
    await safeCreateIndex(Application.collection, { email: 1 });
    await safeCreateIndex(Application.collection, { status: 1 });
    await safeCreateIndex(Application.collection, { createdAt: -1 });
    await safeCreateIndex(Application.collection, { buildingId: 1 });
    await safeCreateIndex(Application.collection, { status: 1, createdAt: -1 });
    await safeCreateIndex(Application.collection, { email: 1, status: 1 });
    await safeCreateIndex(Application.collection, { buildingId: 1, status: 1 });
    await safeCreateIndex(Application.collection, { registeredUserId: 1 });
    await safeCreateIndex(Application.collection, {
      status: 1,
      createdAt: -1,
      buildingId: 1,
    });
    await safeCreateIndex(Application.collection, { planId: 1, status: 1 });
    await safeCreateIndex(Application.collection, {
      reviewedBy: 1,
      reviewedAt: -1,
    });
    console.log("✅ Application indexes created");

    // ==================== ADMIN INDEXES ====================
    await safeCreateIndex(Admin.collection, { email: 1 }, { unique: true });
    await safeCreateIndex(Admin.collection, { username: 1 }, { unique: true });
    await safeCreateIndex(Admin.collection, { role: 1 });
    await safeCreateIndex(Admin.collection, { status: 1 });
    console.log("✅ Admin indexes created");

    // ==================== PLAN INDEXES ====================
    await safeCreateIndex(Plan.collection, { isActive: 1 });
    await safeCreateIndex(Plan.collection, { price: 1 });
    await safeCreateIndex(Plan.collection, { name: 1 }, { unique: true });
    await safeCreateIndex(Plan.collection, { isActive: 1, price: 1 });
    console.log("✅ Plan indexes created");

    // ==================== BUILDING INDEXES ====================
    await safeCreateIndex(
      Building.collection,
      { buildingName: 1 },
      { unique: true, name: "buildingName_idx" },
    );
    await safeCreateIndex(Building.collection, { isActive: 1 });
    await safeCreateIndex(Building.collection, { city: 1, isActive: 1 });
    console.log("✅ Building indexes created");

    // ==================== NOTIFICATION INDEXES ====================
    await safeCreateIndex(Notification.collection, {
      userId: 1,
      createdAt: -1,
    });
    await safeCreateIndex(Notification.collection, { isRead: 1 });
    await safeCreateIndex(Notification.collection, {
      userId: 1,
      isRead: 1,
      createdAt: -1,
    });
    await safeCreateIndex(
      Notification.collection,
      { createdAt: 1 },
      { expireAfterSeconds: 2592000, name: "createdAt_expire_idx" },
    );
    console.log("✅ Notification indexes created");

    // ==================== BILLING SETTINGS ====================
    const settingsExists = await BillingSettings.findOne();
    if (!settingsExists) {
      await BillingSettings.create({
        reminderDays: [7, 3, 1],
        dueDateDaysAfterPeriod: 5,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
        freeDays: 1,
      });
      console.log("✅ Default billing settings created");
    }

    const duration = Date.now() - startTime;
    console.log(`✅ All database indexes verified/created in ${duration}ms`);
  } catch (error) {
    console.error("❌ Error creating indexes:", error);
    // Don't throw - allow app to continue with existing indexes
    console.log("⚠️ Continuing with existing indexes...");
  }
}

export {
  User,
  Admin,
  Plan,
  Payment,
  Billing,
  BillingCycle,
  BillingSettings,
  Application,
  Building,
  Notification,
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
  Building,
  Notification,
  ensureIndexes,
};
