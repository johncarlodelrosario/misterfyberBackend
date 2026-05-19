// models/Index.ts - COMPLETE WITH AGGRESSIVE INDEX FIX
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

export async function ensureIndexes() {
  console.log("🔍 Creating/Ensuring database indexes for performance...");
  const startTime = Date.now();

  try {
    // ==================== DROP ALL PROBLEMATIC INDEXES FIRST ====================
    console.log("🔄 Dropping problematic indexes...");

    // Drop ALL indexes from Billing collection except _id
    try {
      const billingIndexes = await Billing.collection.indexes();
      for (const idx of billingIndexes) {
        if (idx.name !== "_id_") {
          await Billing.collection.dropIndex(idx.name);
          console.log(`✅ Dropped Billing index: ${idx.name}`);
        }
      }
      console.log("✅ All Billing indexes cleared");
    } catch (err) {
      console.log("⚠️ Error dropping Billing indexes:", err);
    }

    // Drop ALL indexes from Payment collection except _id
    try {
      const paymentIndexes = await Payment.collection.indexes();
      for (const idx of paymentIndexes) {
        if (idx.name !== "_id_") {
          await Payment.collection.dropIndex(idx.name);
          console.log(`✅ Dropped Payment index: ${idx.name}`);
        }
      }
      console.log("✅ All Payment indexes cleared");
    } catch (err) {
      console.log("⚠️ Error dropping Payment indexes:", err);
    }

    // Drop ALL indexes from Building collection except _id
    try {
      const buildingIndexes = await Building.collection.indexes();
      for (const idx of buildingIndexes) {
        if (idx.name !== "_id_") {
          await Building.collection.dropIndex(idx.name);
          console.log(`✅ Dropped Building index: ${idx.name}`);
        }
      }
      console.log("✅ All Building indexes cleared");
    } catch (err) {
      console.log("⚠️ Error dropping Building indexes:", err);
    }

    // ==================== USER INDEXES ====================
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ username: 1 }, { unique: true });
    await User.collection.createIndex({ status: 1 });
    await User.collection.createIndex({ planId: 1 });
    await User.collection.createIndex({ createdAt: -1 });
    await User.collection.createIndex({ "mikrotik.username": 1 });
    await User.collection.createIndex({ "billingInfo.billingCycleId": 1 });
    await User.collection.createIndex({ status: 1, createdAt: -1 });
    await User.collection.createIndex({ firstName: 1, lastName: 1 });
    await User.collection.createIndex({ email: 1, status: 1 });
    await User.collection.createIndex({ status: 1, planId: 1, createdAt: -1 });
    console.log("✅ User indexes created");

    // ==================== PAYMENT INDEXES ====================
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
    await Payment.collection.createIndex({ status: 1, createdAt: 1 });
    await Payment.collection.createIndex({
      status: 1,
      createdAt: 1,
      amount: 1,
    });
    console.log("✅ Payment indexes created");

    // ==================== BILLING INDEXES ====================
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
    await Billing.collection.createIndex({
      status: 1,
      dueDate: 1,
      reminder7DaySent: 1,
    });
    await Billing.collection.createIndex({
      billingCycleId: 1,
      status: 1,
      dueDate: 1,
    });
    console.log("✅ Billing indexes created");

    // ==================== BILLING CYCLE INDEXES ====================
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
    await BillingCycle.collection.createIndex({
      nextBillingDate: 1,
      status: 1,
    });
    await BillingCycle.collection.createIndex({
      userId: 1,
      status: 1,
      proRatedPaid: 1,
    });
    console.log("✅ BillingCycle indexes created");

    // ==================== APPLICATION INDEXES ====================
    await Application.collection.createIndex({ applicationId: 1 });
    await Application.collection.createIndex({ email: 1 });
    await Application.collection.createIndex({ status: 1 });
    await Application.collection.createIndex({ createdAt: -1 });
    await Application.collection.createIndex({ buildingId: 1 });
    await Application.collection.createIndex({ status: 1, createdAt: -1 });
    await Application.collection.createIndex({ email: 1, status: 1 });
    await Application.collection.createIndex({ buildingId: 1, status: 1 });
    await Application.collection.createIndex({ registeredUserId: 1 });
    await Application.collection.createIndex({
      status: 1,
      createdAt: -1,
      buildingId: 1,
    });
    await Application.collection.createIndex({ planId: 1, status: 1 });
    await Application.collection.createIndex({ reviewedBy: 1, reviewedAt: -1 });
    console.log("✅ Application indexes created");

    // ==================== ADMIN INDEXES ====================
    await Admin.collection.createIndex({ email: 1 }, { unique: true });
    await Admin.collection.createIndex({ username: 1 }, { unique: true });
    await Admin.collection.createIndex({ role: 1 });
    await Admin.collection.createIndex({ status: 1 });
    console.log("✅ Admin indexes created");

    // ==================== PLAN INDEXES ====================
    await Plan.collection.createIndex({ isActive: 1 });
    await Plan.collection.createIndex({ price: 1 });
    await Plan.collection.createIndex({ name: 1 }, { unique: true });
    await Plan.collection.createIndex({ isActive: 1, price: 1 });
    console.log("✅ Plan indexes created");

    // ==================== BUILDING INDEXES ====================
    await Building.collection.createIndex(
      { buildingName: 1 },
      { unique: true },
    );
    await Building.collection.createIndex({ isActive: 1 });
    await Building.collection.createIndex({ city: 1, isActive: 1 });
    console.log("✅ Building indexes created");

    // ==================== NOTIFICATION INDEXES ====================
    await Notification.collection.createIndex({ userId: 1, createdAt: -1 });
    await Notification.collection.createIndex({ isRead: 1 });
    await Notification.collection.createIndex({
      userId: 1,
      isRead: 1,
      createdAt: -1,
    });
    await Notification.collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 2592000 },
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
    console.log(`✅ All database indexes created in ${duration}ms`);
  } catch (error) {
    console.error("❌ Error in ensureIndexes:", error);
    console.log("⚠️ Continuing with existing indexes - app will still work");
    // Don't throw - allow app to continue
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
