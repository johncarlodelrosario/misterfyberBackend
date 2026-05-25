// controllers/billingController.ts - COMPLETE WORKING VERSION (FINAL FIXED)
import { Request, Response, NextFunction } from "express";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import BillingSettings from "../models/BillingSettings";
import User from "../models/User";
import Plan from "../models/Plan";
import Payment from "../models/Payment";
import emailService from "../services/emailService";
import mikrotikService from "../services/mikrotikService";
import mongoose from "mongoose";

type AuthRequest = Request & { user?: any };

// ==================== CACHE SYSTEM ====================
let billingSettingsCache: any = null;
let billingSettingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60 * 60 * 1000;

let billingCyclesCache: Map<string, { data: any; timestamp: number }> =
  new Map();
let billsCache: Map<string, { data: any; timestamp: number }> = new Map();
let summaryCache: { data: any; timestamp: number } | null = null;
const SUMMARY_CACHE_TTL = 2 * 60 * 1000;
const LIST_CACHE_TTL = 30 * 1000;

function generateInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `INV-${year}${month}-${timestamp}${random}`;
}

function getCacheKey(params: any): string {
  return JSON.stringify(params);
}

function clearAllCache(): void {
  billingSettingsCache = null;
  billingCyclesCache.clear();
  billsCache.clear();
  summaryCache = null;
  console.log("🗑️ Billing cache cleared");
}

// ==================== HELPER FUNCTIONS ====================

async function getOrCreateSettings(): Promise<any> {
  let settings = await BillingSettings.findOne().lean();
  if (!settings) {
    const defaultSettings = {
      reminderDays: [7, 3, 1],
      dueDateDaysAfterPeriod: 5,
      gracePeriodDays: 5,
      autoGenerateBills: true,
      autoSendReminders: true,
      autoSuspendOnNonPayment: true,
      billingCycleDay: 1,
      proRatedDueDay: 25,
      monthlyDueDay: 5,
      billingCutoffDay: 24,
      enableAutoBilling: true,
      sendInvoiceOnInstall: true,
      requireAdminActivation: false,
    };
    settings = await BillingSettings.create(defaultSettings);
    console.log("✅ Default billing settings created");
  }
  return settings;
}

function getDueDateForProRated(installationDate: Date, settings: any): Date {
  const year = installationDate.getFullYear();
  const month = installationDate.getMonth();
  let dueDay = settings.proRatedDueDay || 25;
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  if (dueDay > lastDayOfMonth) {
    dueDay = lastDayOfMonth;
  }
  // Due date is 25th of the same month
  const dueDate = new Date(year, month, dueDay, 23, 59, 59, 999);
  if (dueDate < installationDate) {
    return new Date(year, month, lastDayOfMonth, 23, 59, 59, 999);
  }
  return dueDate;
}

function getDueDateForMonthly(billingStartDate: Date, settings: any): Date {
  const dueDay = settings.monthlyDueDay || 5;
  const dueDate = new Date(billingStartDate);
  dueDate.setMonth(dueDate.getMonth() + 1);
  let targetDay = dueDay;
  const lastDayOfMonth = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth() + 1,
    0,
  ).getDate();
  if (targetDay > lastDayOfMonth) {
    targetDay = lastDayOfMonth;
  }
  dueDate.setDate(targetDay);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate;
}

function getDueDateForRegularMonthly(currentDate: Date, settings: any): Date {
  const dueDay = settings.monthlyDueDay || 5;
  const dueDate = new Date(currentDate);
  dueDate.setMonth(dueDate.getMonth() + 1);
  let targetDay = dueDay;
  const lastDayOfMonth = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth() + 1,
    0,
  ).getDate();
  if (targetDay > lastDayOfMonth) {
    targetDay = lastDayOfMonth;
  }
  dueDate.setDate(targetDay);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate;
}

// FIXED: Get the last day of the month for a given date
function getEndOfMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  // This correctly returns the last day of the month (e.g., May 31, not June 1)
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

function getStartOfNextMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month + 1, 1, 0, 0, 0, 0);
}

function formatDateForDisplay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// ==================== START BILLING WITH CORRECT FORMULA ====================
export const startBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, startDate, customAmount, notes } = req.body;

    console.log(`🚀 Starting billing for user: ${userId}`);

    const user = await User.findById(userId).populate("planId").lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.planId) {
      return res
        .status(400)
        .json({ success: false, message: "User has no plan assigned" });
    }

    const settings = await getOrCreateSettings();
    const billingCutoffDay = settings.billingCutoffDay || 24;

    const plan = user.planId as any;
    const monthlyRate = plan.price;

    // Daily Rate = (Monthly Price × 12) ÷ 365
    const dailyRate = (monthlyRate * 12) / 365;

    let installationDate = startDate ? new Date(startDate) : new Date();
    installationDate.setHours(0, 0, 0, 0);

    const existingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["active", "paused", "pending_activation"] },
    }).lean();

    if (existingCycle) {
      return res.status(400).json({
        success: false,
        message: "User already has a billing cycle",
        data: { billingCycle: existingCycle },
      });
    }

    const installationDay = installationDate.getDate();
    // Get end of current month (e.g., May 31, 2026)
    const currentMonthEnd = getEndOfMonth(installationDate);
    const daysInMonth = currentMonthEnd.getDate();
    // Days from installation to end of month (inclusive)
    const actualBillableDays = daysInMonth - installationDay + 1;
    const isAfterCutoff = installationDay > billingCutoffDay;

    let proRatedAmount = 0;
    let billingStartDateForCycle: Date;
    let billingEndDateForCycle: Date;
    let nextBillingDate: Date;
    let createdBill: any = null;
    let billingStatus = "pending_activation";

    if (isAfterCutoff) {
      // SCENARIO B: Installation Day 25-31 (after cutoff)
      proRatedAmount = Math.round(dailyRate * actualBillableDays * 100) / 100;
      if (customAmount) {
        proRatedAmount = customAmount;
      }

      billingStartDateForCycle = getStartOfNextMonth(installationDate);
      billingEndDateForCycle = getEndOfMonth(billingStartDateForCycle);
      nextBillingDate = getStartOfNextMonth(billingStartDateForCycle);

      const billingCycle = await BillingCycle.create(
        [
          {
            userId,
            planId: plan._id,
            billingStartDate: billingStartDateForCycle,
            billingEndDate: billingEndDateForCycle,
            nextBillingDate: nextBillingDate,
            status: billingStatus,
            monthlyRate: monthlyRate,
            currentProRatedAmount: proRatedAmount,
            proRatedPaid: false,
            actualBillableDays: actualBillableDays,
            manualBillStart: true,
            isAfterCutoff: isAfterCutoff,
            cutoffDayUsed: billingCutoffDay,
          },
        ],
        { session },
      );

      const totalAmount = monthlyRate + proRatedAmount;
      const dueDate = getDueDateForMonthly(billingStartDateForCycle, settings);

      createdBill = await Billing.create(
        [
          {
            userId,
            billingCycleId: billingCycle[0]._id,
            invoiceNumber: generateInvoiceNumber(),
            billingPeriod: {
              start: installationDate,
              end: billingEndDateForCycle,
            },
            dueDate: dueDate,
            items: [
              {
                description: `Pro-rated payment for ${formatDateForDisplay(installationDate)} to ${formatDateForDisplay(currentMonthEnd)} (${actualBillableDays} days) - Daily rate: ₱${dailyRate.toFixed(4)}`,
                quantity: actualBillableDays,
                rate: dailyRate,
                amount: proRatedAmount,
              },
              {
                description: `Monthly Subscription - ${formatDateForDisplay(billingStartDateForCycle)} to ${formatDateForDisplay(billingEndDateForCycle)}`,
                quantity: 1,
                rate: monthlyRate,
                amount: monthlyRate,
              },
            ],
            subtotal: totalAmount,
            tax: 0,
            discount: 0,
            total: totalAmount,
            status: "sent",
            isProRated: false,
            proRatedDays: actualBillableDays,
            notes:
              notes || `Combined bill due on ${formatDateForDisplay(dueDate)}`,
          },
        ],
        { session },
      );

      if (settings.sendInvoiceOnInstall) {
        try {
          await emailService.sendInvoice(user, createdBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      }

      await session.commitTransaction();

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            "billingInfo.currentBill": totalAmount,
            "billingInfo.nextBillingDate": nextBillingDate,
            "billingInfo.billingCycleId": billingCycle[0]._id,
            status: "pending_activation",
          },
        },
      );

      clearAllCache();

      res.status(200).json({
        success: true,
        message: `Installation on day ${installationDay} (after cutoff). Combined bill due on ${formatDateForDisplay(dueDate)}.`,
        data: {
          billingCycle: billingCycle[0],
          bill: createdBill ? createdBill[0] : null,
          proRatedAmount: proRatedAmount,
          dailyRate: dailyRate,
          monthlyRate: monthlyRate,
          annualRate: monthlyRate * 12,
          actualBillableDays: actualBillableDays,
          installationDay: installationDay,
          billingCutoffDay: billingCutoffDay,
          isAfterCutoff: isAfterCutoff,
          dueDate: dueDate,
          nextBillingDate: nextBillingDate,
          isCombinedBill: true,
        },
      });
    } else {
      // SCENARIO A: Installation Day 1-24 (on or before cutoff)
      proRatedAmount = Math.round(dailyRate * actualBillableDays * 100) / 100;
      if (customAmount) {
        proRatedAmount = customAmount;
      }

      const billingPeriodStart = installationDate;
      const billingPeriodEnd = currentMonthEnd; // This is May 31, 2026
      nextBillingDate = getStartOfNextMonth(installationDate); // This is June 1, 2026

      const billingCycle = await BillingCycle.create(
        [
          {
            userId,
            planId: plan._id,
            billingStartDate: billingPeriodStart,
            billingEndDate: billingPeriodEnd,
            nextBillingDate: nextBillingDate,
            status: billingStatus,
            monthlyRate: monthlyRate,
            currentProRatedAmount: proRatedAmount,
            proRatedPaid: false,
            actualBillableDays: actualBillableDays,
            manualBillStart: false,
            isAfterCutoff: isAfterCutoff,
            cutoffDayUsed: billingCutoffDay,
          },
        ],
        { session },
      );

      // Due date for pro-rated bill: 25th of CURRENT month (e.g., May 25, 2026)
      const dueDate = getDueDateForProRated(installationDate, settings);
      const annualRate = monthlyRate * 12;

      createdBill = await Billing.create(
        [
          {
            userId,
            billingCycleId: billingCycle[0]._id,
            invoiceNumber: generateInvoiceNumber(),
            billingPeriod: {
              start: billingPeriodStart,
              end: billingPeriodEnd,
            },
            dueDate: dueDate,
            items: [
              {
                description: `Pro-rated payment from ${formatDateForDisplay(installationDate)} to ${formatDateForDisplay(billingPeriodEnd)} (${actualBillableDays} days) - Daily rate: ₱${dailyRate.toFixed(4)}`,
                quantity: actualBillableDays,
                rate: dailyRate,
                amount: proRatedAmount,
              },
            ],
            subtotal: proRatedAmount,
            tax: 0,
            discount: 0,
            total: proRatedAmount,
            status: "sent",
            isProRated: true,
            proRatedDays: actualBillableDays,
            notes:
              notes ||
              `Pro-rated bill due on ${formatDateForDisplay(dueDate)}. Next billing starts ${formatDateForDisplay(nextBillingDate)}`,
          },
        ],
        { session },
      );

      if (settings.sendInvoiceOnInstall) {
        try {
          await emailService.sendInvoice(user, createdBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      }

      await session.commitTransaction();

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            "billingInfo.currentBill": proRatedAmount,
            "billingInfo.nextBillingDate": nextBillingDate,
            "billingInfo.billingCycleId": billingCycle[0]._id,
            status: "pending_activation",
          },
        },
      );

      clearAllCache();

      res.status(200).json({
        success: true,
        message: `Pro-rated amount of ₱${proRatedAmount.toFixed(2)} for ${actualBillableDays} days due on ${formatDateForDisplay(dueDate)}.`,
        data: {
          billingCycle: billingCycle[0],
          bill: createdBill ? createdBill[0] : null,
          proRatedAmount: proRatedAmount,
          dailyRate: dailyRate,
          monthlyRate: monthlyRate,
          annualRate: monthlyRate * 12,
          actualBillableDays: actualBillableDays,
          installationDay: installationDay,
          billingCutoffDay: billingCutoffDay,
          isAfterCutoff: isAfterCutoff,
          dueDate: dueDate,
          nextBillingDate: nextBillingDate,
          isCombinedBill: false,
        },
      });
    }
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== GET BILLING SETTINGS ====================
export const getBillingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();
    if (
      billingSettingsCache &&
      now - billingSettingsCacheTime < SETTINGS_CACHE_TTL
    ) {
      return res
        .status(200)
        .json({ success: true, data: billingSettingsCache });
    }

    let settings = await BillingSettings.findOne().lean();
    if (!settings) {
      settings = await BillingSettings.create({
        reminderDays: [7, 3, 1],
        dueDateDaysAfterPeriod: 5,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
        proRatedDueDay: 25,
        monthlyDueDay: 5,
        billingCutoffDay: 24,
        enableAutoBilling: true,
        sendInvoiceOnInstall: true,
        requireAdminActivation: false,
      });
    }

    billingSettingsCache = settings;
    billingSettingsCacheTime = now;

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ==================== UPDATE BILLING SETTINGS ====================
export const updateBillingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const settings = await BillingSettings.findOneAndUpdate({}, req.body, {
      new: true,
      upsert: true,
    }).lean();

    billingSettingsCache = null;
    clearAllCache();

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ==================== GET BILLING SETTINGS FOR ADMIN UI ====================
export const getBillingSettingsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    let settings = await BillingSettings.findOne().lean();
    if (!settings) {
      settings = await BillingSettings.create({
        reminderDays: [7, 3, 1],
        dueDateDaysAfterPeriod: 5,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
        proRatedDueDay: 25,
        monthlyDueDay: 5,
        billingCutoffDay: 24,
        enableAutoBilling: true,
        sendInvoiceOnInstall: true,
        requireAdminActivation: false,
      });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ==================== UPDATE BILLING SETTINGS ADMIN ====================
export const updateBillingSettingsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      reminderDays,
      dueDateDaysAfterPeriod,
      gracePeriodDays,
      autoGenerateBills,
      autoSendReminders,
      autoSuspendOnNonPayment,
      billingCycleDay,
      proRatedDueDay,
      monthlyDueDay,
      billingCutoffDay,
      enableAutoBilling,
      sendInvoiceOnInstall,
      requireAdminActivation,
    } = req.body;

    const settings = await BillingSettings.findOneAndUpdate(
      {},
      {
        reminderDays,
        dueDateDaysAfterPeriod,
        gracePeriodDays,
        autoGenerateBills,
        autoSendReminders,
        autoSuspendOnNonPayment,
        billingCycleDay,
        proRatedDueDay,
        monthlyDueDay,
        billingCutoffDay,
        enableAutoBilling,
        sendInvoiceOnInstall,
        requireAdminActivation,
      },
      { new: true, upsert: true },
    ).lean();

    billingSettingsCache = null;
    clearAllCache();

    res.status(200).json({
      success: true,
      message: "Billing settings updated successfully",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET BILLING SUMMARY ADMIN ====================
export const getBillingSummaryAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();
    if (summaryCache && now - summaryCache.timestamp < SUMMARY_CACHE_TTL) {
      return res.status(200).json({ success: true, data: summaryCache.data });
    }

    const [
      totalActiveCycles,
      totalPausedCycles,
      pendingProRated,
      pendingActivations,
      overdueBills,
      unpaidProRated,
      outstandingResult,
      monthlyRevenue,
    ] = await Promise.all([
      BillingCycle.countDocuments({ status: "active", proRatedPaid: true }),
      BillingCycle.countDocuments({ status: "paused" }),
      Billing.countDocuments({
        isProRated: true,
        status: "pending_confirmation",
      }),
      BillingCycle.countDocuments({
        status: "pending_activation",
        proRatedPaid: true,
        manualBillStart: false,
      }),
      Billing.countDocuments({ status: "overdue" }),
      Billing.countDocuments({ isProRated: true, status: "sent" }),
      Billing.aggregate([
        {
          $match: {
            status: { $in: ["sent", "overdue", "pending_confirmation"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            paidAt: {
              $gte: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1,
              ),
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const totalOutstanding = outstandingResult[0]?.total || 0;
    const data = {
      activeSubscriptions: totalActiveCycles,
      pausedSubscriptions: totalPausedCycles,
      pendingProRated: pendingProRated,
      pendingActivations: pendingActivations,
      overdueAccounts: overdueBills,
      totalOutstanding: totalOutstanding,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      unpaidProRated: unpaidProRated,
    };

    summaryCache = { data, timestamp: now };
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL BILLING CYCLES ====================
export const getAllBillingCycles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cacheKey = getCacheKey(req.query);
    const cached = billingCyclesCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) {
      return res.status(200).json({ success: true, data: cached.data });
    }

    const cycles = await BillingCycle.find()
      .populate("userId", "firstName lastName email username status")
      .populate("planId", "name price")
      .sort({ createdAt: -1 })
      .lean();

    billingCyclesCache.set(cacheKey, { data: cycles, timestamp: Date.now() });
    res.status(200).json({ success: true, data: cycles });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL BILLS ====================
export const getAllBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cacheKey = getCacheKey(req.query);
    const cached = billsCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) {
      return res.status(200).json({ success: true, data: cached.data });
    }

    const { status, type } = req.query;
    let query: any = {};

    if (status) query.status = status;
    if (type === "pro-rated") query.isProRated = true;
    if (type === "monthly") query.isProRated = false;

    const bills = await Billing.find(query)
      .populate("userId", "firstName lastName email username")
      .populate("billingCycleId")
      .sort({ dueDate: -1 })
      .lean();

    billsCache.set(cacheKey, { data: bills, timestamp: Date.now() });
    res.status(200).json({ success: true, data: bills });
  } catch (error) {
    next(error);
  }
};

// ==================== PAUSE BILLING ====================
export const pauseBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, reason, pauseUntilDate } = req.body;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    }).lean();
    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found to pause",
      });
    }

    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
    }).lean();

    if (unpaidBills) {
      return res.status(400).json({
        success: false,
        message: "User has unpaid bills. Please settle before pausing.",
      });
    }

    const pauseDate = new Date();
    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      {
        $set: {
          status: "paused",
          pausedAt: pauseDate,
          pauseReason: reason || "User requested pause",
          pauseUntil: pauseUntilDate ? new Date(pauseUntilDate) : undefined,
        },
      },
      { session },
    );

    await User.updateOne(
      { _id: userId },
      { $set: { status: "paused" } },
      { session },
    );

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error("Error disabling user in MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Your Service Has Been Paused - Mister Fyber",
      `<p>Dear ${user.firstName || user.username},</p><p>Your internet service has been paused.</p>`,
    );

    clearAllCache();
    res
      .status(200)
      .json({ success: true, message: `Service paused for ${user.firstName}` });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== RESUME BILLING ====================
export const resumeBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.body;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    const user = await User.findById(userId).populate("planId").lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "paused",
    }).lean();
    if (!billingCycle) {
      return res
        .status(404)
        .json({ success: false, message: "No paused billing cycle found" });
    }

    const resumeDate = new Date();
    const nextBillingDate = getStartOfNextMonth(resumeDate);

    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      {
        $set: {
          status: "active",
          resumedAt: resumeDate,
          nextBillingDate: nextBillingDate,
          pausedAt: undefined,
          pauseReason: undefined,
          pauseUntil: undefined,
        },
      },
      { session },
    );

    await User.updateOne(
      { _id: userId },
      { $set: { status: "active" } },
      { session },
    );

    if (user.mikrotik?.username && user.planId) {
      try {
        await mikrotikService.applyPlanToUser(user, user.planId);
      } catch (error) {
        console.error("Error enabling user in MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Your Service Has Been Resumed",
      `<p>Your service has been resumed.</p>`,
    );

    clearAllCache();
    res.status(200).json({
      success: true,
      message: `Service resumed for ${user.firstName}`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== MARK BILL AS PAID ====================
export const markBillAsPaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const { referenceNumber, notes } = req.body;
    const adminId = req.user?._id;

    const bill = await Billing.findById(billId).populate("userId").lean();
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }

    if (bill.status === "paid") {
      return res
        .status(400)
        .json({ success: false, message: "Bill is already paid" });
    }

    const user = bill.userId as any;

    const payment = await Payment.create(
      [
        {
          userId: user._id,
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "completed",
          referenceNumber: referenceNumber || `ADMIN-${Date.now()}`,
          billingId: bill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              confirmedBy: adminId,
              confirmedAt: new Date(),
              notes: notes || "Manually marked as paid",
            },
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    await Billing.updateOne(
      { _id: bill._id },
      { $set: { status: "paid", paymentId: payment[0]._id } },
      { session },
    );

    const billingCycle = await BillingCycle.findById(bill.billingCycleId);
    if (billingCycle) {
      billingCycle.paymentHistory = billingCycle.paymentHistory || [];
      billingCycle.paymentHistory.push({
        billingId: bill._id,
        amount: bill.total,
        paidAt: new Date(),
      });

      if (bill.isProRated && !billingCycle.proRatedPaid) {
        billingCycle.proRatedPaid = true;
        billingCycle.proRatedPaidAt = new Date();
        if (billingCycle.status === "pending_activation") {
          billingCycle.status = "active";
        }
      }
      await billingCycle.save({ session });
    }

    if (user.status === "pending_activation" || user.status === "suspended") {
      await User.updateOne(
        { _id: user._id },
        { $set: { status: "active" } },
        { session },
      );
    }

    await session.commitTransaction();
    await emailService.sendPaymentConfirmation(user, payment[0], bill);

    clearAllCache();
    res.status(200).json({
      success: true,
      message: `Bill ${bill.invoiceNumber} marked as paid`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== GET PENDING PRO-RATED BILLS ====================
export const getPendingProRatedBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pendingBills = await Billing.find({
      isProRated: true,
      status: "pending_confirmation",
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: pendingBills });
  } catch (error) {
    next(error);
  }
};

// ==================== GET PENDING ACTIVATIONS ====================
export const getPendingActivations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pendingCycles = await BillingCycle.find({
      status: "pending_activation",
      proRatedPaid: true,
      manualBillStart: false,
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .populate("planId", "name price")
      .sort({ proRatedPaidAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: pendingCycles });
  } catch (error) {
    next(error);
  }
};

// ==================== CONFIRM PRO-RATED PAYMENT ====================
export const confirmProRatedPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, paymentDetails } = req.body;

    const [user, billingCycle] = await Promise.all([
      User.findById(userId).populate("planId").lean(),
      BillingCycle.findOne({ userId, status: "pending_activation" })
        .populate("planId")
        .lean(),
    ]);

    if (!user || !billingCycle) {
      return res
        .status(404)
        .json({ success: false, message: "User or billing cycle not found" });
    }

    const proRatedBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: true,
      status: "pending_confirmation",
    }).lean();

    if (!proRatedBill) {
      return res
        .status(404)
        .json({ success: false, message: "Pro-rated bill not found" });
    }

    await Billing.updateOne(
      { _id: proRatedBill._id },
      { $set: { status: "paid" } },
      { session },
    );

    const payment = await Payment.create(
      [
        {
          userId,
          amount: proRatedBill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "completed",
          referenceNumber: `PRO-${Date.now()}`,
          billingId: proRatedBill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: paymentDetails,
            notes: "Pro-rated payment confirmed",
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    await Billing.updateOne(
      { _id: proRatedBill._id },
      { $set: { paymentId: payment[0]._id } },
      { session },
    );

    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      {
        $set: {
          proRatedPaid: true,
          proRatedPaidAt: new Date(),
          status: "active",
        },
      },
      { session },
    );

    await User.updateOne(
      { _id: userId },
      { $set: { status: "active" } },
      { session },
    );

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Pro-rated Payment Confirmed",
      `<p>Your payment of ₱${proRatedBill.total} has been confirmed.</p>`,
    );

    clearAllCache();
    res
      .status(200)
      .json({ success: true, message: "Pro-rated payment confirmed" });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== START MONTHLY BILLING ====================
export const startMonthlyBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.body;

    const [user, billingCycle] = await Promise.all([
      User.findById(userId).populate("planId").lean(),
      BillingCycle.findOne({
        userId,
        status: "pending_activation",
        proRatedPaid: true,
      })
        .populate("planId")
        .lean(),
    ]);

    if (!user || !billingCycle) {
      return res
        .status(404)
        .json({ success: false, message: "User or billing cycle not found" });
    }

    const settings = await getOrCreateSettings();
    const monthlyDueDay = settings.monthlyDueDay || 5;

    const today = new Date();
    let billingStart = new Date(today);
    billingStart.setDate(1);
    billingStart.setHours(0, 0, 0, 0);

    const billingEnd = getEndOfMonth(billingStart);

    const dueDate = new Date(billingStart);
    dueDate.setMonth(dueDate.getMonth() + 1);
    let targetDay = monthlyDueDay;
    const lastDayOfMonth = new Date(
      dueDate.getFullYear(),
      dueDate.getMonth() + 1,
      0,
    ).getDate();
    if (targetDay > lastDayOfMonth) targetDay = lastDayOfMonth;
    dueDate.setDate(targetDay);
    dueDate.setHours(23, 59, 59, 999);

    const plan = billingCycle.planId as any;
    const monthlyRate = plan.price;

    const firstMonthlyBill = await Billing.create(
      [
        {
          userId,
          billingCycleId: billingCycle._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: billingStart, end: billingEnd },
          dueDate,
          items: [
            {
              description: `Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}`,
              quantity: 1,
              rate: monthlyRate,
              amount: monthlyRate,
            },
          ],
          subtotal: monthlyRate,
          tax: 0,
          discount: 0,
          total: monthlyRate,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
          notes: "First monthly bill",
        },
      ],
      { session },
    );

    const nextDate = getStartOfNextMonth(billingStart);

    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      {
        $set: {
          status: "active",
          manualBillStart: true,
          manuallyStartedAt: new Date(),
          nextBillingDate: nextDate,
        },
      },
      { session },
    );

    await User.updateOne(
      { _id: userId },
      { $set: { status: "active" } },
      { session },
    );

    await session.commitTransaction();
    await emailService.sendInvoice(user, firstMonthlyBill[0]);

    clearAllCache();
    res.status(200).json({
      success: true,
      message: "Monthly billing started",
      data: { firstMonthlyBill: firstMonthlyBill[0] },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== STOP BILLING ====================
export const stopBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, reason } = req.body;

    const user = await User.findById(userId).lean();
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["active", "paused"] },
    }).lean();
    if (!billingCycle)
      return res
        .status(404)
        .json({ success: false, message: "No active billing cycle found" });

    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      { $set: { status: "cancelled", billingEndDate: new Date() } },
      { session },
    );

    await User.updateOne(
      { _id: userId },
      { $set: { status: "inactive" } },
      { session },
    );

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error(error);
      }
    }

    await session.commitTransaction();
    clearAllCache();
    res.status(200).json({
      success: true,
      message: `Billing stopped for ${user.firstName}`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== DISCONNECT CLIENT ====================
export const disconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, reason } = req.body;
    const user = await User.findById(userId).lean();
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    await User.updateOne(
      { _id: userId },
      { $set: { status: "suspended" } },
      { session },
    );

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error(error);
      }
    }

    await session.commitTransaction();
    clearAllCache();
    res.status(200).json({
      success: true,
      message: `Service disconnected for ${user.firstName}`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== RECONNECT CLIENT ====================
export const reconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.body;
    const user = await User.findById(userId).populate("planId").lean();
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    await User.updateOne(
      { _id: userId },
      { $set: { status: "active" } },
      { session },
    );

    if (user.mikrotik?.username && user.planId) {
      try {
        await mikrotikService.applyPlanToUser(user, user.planId);
      } catch (error) {
        console.error(error);
      }
    }

    await session.commitTransaction();
    clearAllCache();
    res.status(200).json({
      success: true,
      message: `Service reconnected for ${user.firstName}`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== AUTO-GENERATE MONTHLY BILLS ====================
export const autoGenerateMonthlyBills = async (
  req?: AuthRequest,
  res?: Response,
) => {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.autoGenerateBills) {
      if (res)
        return res
          .status(200)
          .json({ success: true, message: "Auto-generate bills is disabled" });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const billingCycles = await BillingCycle.find({
      status: "active",
      proRatedPaid: true,
      manualBillStart: true,
      nextBillingDate: { $lte: today },
    })
      .populate("userId planId")
      .lean();

    let generatedCount = 0;
    for (const cycle of billingCycles) {
      const user = cycle.userId as any;
      const plan = cycle.planId as any;
      if (!user || !plan) continue;

      const billingStart = new Date(cycle.nextBillingDate);
      billingStart.setHours(0, 0, 0, 0);
      const billingEnd = getEndOfMonth(billingStart);
      const dueDate = getDueDateForRegularMonthly(billingStart, settings);

      const existingBill = await Billing.findOne({
        userId: user._id,
        billingCycleId: cycle._id,
        isProRated: false,
        "billingPeriod.start": billingStart,
      }).lean();

      if (existingBill) continue;

      const bill = await Billing.create({
        userId: user._id,
        billingCycleId: cycle._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: billingStart, end: billingEnd },
        dueDate,
        items: [
          {
            description: `Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}`,
            quantity: 1,
            rate: plan.price,
            amount: plan.price,
          },
        ],
        subtotal: plan.price,
        total: plan.price,
        status: "sent",
        isProRated: false,
      });

      const nextDate = getStartOfNextMonth(billingStart);
      await BillingCycle.updateOne(
        { _id: cycle._id },
        { $set: { nextBillingDate: nextDate } },
      );

      try {
        await emailService.sendInvoice(user, bill);
      } catch (e) {
        console.error(e);
      }
      generatedCount++;
    }

    clearAllCache();
    if (res)
      res
        .status(200)
        .json({ success: true, message: `Generated ${generatedCount} bills` });
  } catch (error) {
    console.error("Auto-generate monthly bills error:", error);
    if (res)
      res
        .status(500)
        .json({ success: false, message: "Failed to generate bills" });
  }
};

// ==================== AUTO SEND REMINDERS ====================
export const autoSendReminders = async (req?: AuthRequest, res?: Response) => {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.autoSendReminders) {
      if (res)
        return res
          .status(200)
          .json({ success: true, message: "Auto-send reminders is disabled" });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reminderDays = settings.reminderDays || [7, 3, 1];
    let remindersSent = 0;

    for (const days of reminderDays) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      targetDate.setHours(23, 59, 59, 999);

      let reminderField: string;
      if (days === 7) reminderField = "reminder7DaySent";
      else if (days === 3) reminderField = "reminder3DaySent";
      else if (days === 1) reminderField = "reminder1DaySent";
      else continue;

      const bills = await Billing.find({
        status: "sent",
        dueDate: { $lte: targetDate },
        [reminderField]: { $ne: true },
      })
        .populate("userId")
        .lean();

      for (const bill of bills) {
        const user = bill.userId as any;
        if (user?.email) {
          await emailService.sendEmail(
            user.email,
            `Payment Reminder - Invoice ${bill.invoiceNumber}`,
            `<p>Dear ${user.firstName || user.username},</p>
             <p>Your bill of ₱${bill.total.toFixed(2)} is due on ${new Date(bill.dueDate).toLocaleDateString()}.</p>
             <p>Please pay before the due date to avoid service interruption.</p>`,
          );
          await Billing.updateOne(
            { _id: bill._id },
            { $set: { [reminderField]: true } },
          );
          remindersSent++;
        }
      }
    }

    if (res)
      res
        .status(200)
        .json({ success: true, message: `Sent ${remindersSent} reminders` });
  } catch (error) {
    console.error("Auto-send reminders error:", error);
    if (res)
      res
        .status(500)
        .json({ success: false, message: "Failed to send reminders" });
  }
};

// ==================== AUTO SUSPEND OVERDUE ====================
export const autoSuspendOverdue = async (req?: AuthRequest, res?: Response) => {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.autoSuspendOnNonPayment) {
      if (res)
        return res
          .status(200)
          .json({ success: true, message: "Auto-suspend is disabled" });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const gracePeriodDate = new Date(today);
    gracePeriodDate.setDate(
      gracePeriodDate.getDate() - settings.gracePeriodDays,
    );

    const overdueBills = await Billing.find({
      status: "overdue",
      dueDate: { $lt: gracePeriodDate },
      suspensionNotified: { $ne: true },
    })
      .populate("userId")
      .lean();

    let suspendedCount = 0;

    for (const bill of overdueBills) {
      const user = bill.userId as any;
      if (!user) continue;

      await Billing.updateOne(
        { _id: bill._id },
        { $set: { suspensionNotified: true } },
      );

      if (user.status === "active") {
        await User.updateOne(
          { _id: user._id },
          { $set: { status: "suspended" } },
        );
        if (user.mikrotik?.username) {
          try {
            await mikrotikService.disablePPPoEUser(user);
          } catch (error) {
            console.error(error);
          }
        }
        suspendedCount++;
      }
    }

    clearAllCache();
    if (res)
      res
        .status(200)
        .json({ success: true, message: `Suspended ${suspendedCount} users` });
  } catch (error) {
    console.error("Auto-suspend overdue error:", error);
    if (res)
      res
        .status(500)
        .json({ success: false, message: "Failed to suspend users" });
  }
};

// ==================== GET USER CURRENT BILLING ====================
export const getUserCurrentBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    const billingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["active", "pending_activation", "paused"] },
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      return res.status(200).json({ success: true, data: null });
    }

    const currentBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
    })
      .sort({ dueDate: 1 })
      .lean();

    const needsFirstPayment = billingCycle.proRatedPaid === false;

    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentBill,
        needsFirstPayment,
        isAfterCutoff: billingCycle.isAfterCutoff || false,
      },
    });
  } catch (error) {
    console.error("Error in getUserCurrentBilling:", error);
    next(error);
  }
};

// ==================== GET USER BILLING HISTORY ====================
export const getUserBillingHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    const { limit = 50, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [bills, total] = await Promise.all([
      Billing.find({ userId, status: "paid" })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("billingCycleId")
        .lean(),
      Billing.countDocuments({ userId, status: "paid" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        billingHistory: bills,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== SUBMIT PRO-RATED PAYMENT ====================
export const submitProRatedPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId, referenceNumber, notes } = req.body;
    const userId = req.user?._id;

    const bill = await Billing.findOne({ _id: billId, userId });
    if (!bill)
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    if (bill.status === "paid")
      return res
        .status(400)
        .json({ success: false, message: "Bill already paid" });
    if (bill.status === "pending_confirmation")
      return res
        .status(400)
        .json({ success: false, message: "Payment already pending" });

    await Billing.updateOne(
      { _id: bill._id },
      { $set: { status: "pending_confirmation" } },
      { session },
    );

    const payment = await Payment.create(
      [
        {
          userId,
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "pending",
          referenceNumber: referenceNumber || `PAY-${Date.now()}`,
          billingId: bill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              submittedBy: userId,
              submittedAt: new Date(),
              notes: notes || "Payment submitted",
            },
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    await Billing.updateOne(
      { _id: bill._id },
      { $set: { paymentId: payment[0]._id } },
      { session },
    );
    await session.commitTransaction();

    clearAllCache();
    res.status(200).json({
      success: true,
      message: "Payment submitted! Awaiting admin confirmation.",
      data: { status: "pending_confirmation" },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== SUBMIT MONTHLY PAYMENT ====================
export const submitMonthlyPayment = submitProRatedPayment;

// Export all functions
export default {
  startBilling,
  stopBilling,
  pauseBilling,
  resumeBilling,
  disconnectClient,
  reconnectClient,
  getBillingSettings,
  updateBillingSettings,
  getBillingSettingsAdmin,
  updateBillingSettingsAdmin,
  getBillingSummaryAdmin,
  getAllBillingCycles,
  getAllBills,
  markBillAsPaid,
  getPendingProRatedBills,
  getPendingActivations,
  confirmProRatedPayment,
  startMonthlyBilling,
  autoGenerateMonthlyBills,
  autoSendReminders,
  autoSuspendOverdue,
  getUserCurrentBilling,
  getUserBillingHistory,
  submitProRatedPayment,
  submitMonthlyPayment,
};
