// controllers/billingController.ts - COMPLETE WITH DUPLICATE PREVENTION
import { Request, Response, NextFunction } from "express";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import BillingSettings from "../models/BillingSettings";
import User from "../models/User";
import Plan from "../models/Plan";
import Payment from "../models/Payment";
import Application from "../models/Application";
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

function getEndOfMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
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

function getDueDateForProRated(installationDate: Date, settings: any): Date {
  const dueDay = settings.proRatedDueDay || 25;
  const year = installationDate.getFullYear();
  const month = installationDate.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  let targetDay = dueDay;
  if (targetDay > lastDayOfMonth) {
    targetDay = lastDayOfMonth;
  }
  const dueDate = new Date(year, month, targetDay, 23, 59, 59, 999);
  if (dueDate < installationDate) {
    return new Date(year, month, lastDayOfMonth, 23, 59, 59, 999);
  }
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

// ==================== CHECK ADMIN FUNCTION ====================
function checkAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user || !req.user.role) {
    res.status(401).json({
      success: false,
      message: "You must be logged in as admin to perform this action",
    });
    return false;
  }
  const role = req.user.role;
  if (role !== "super_admin" && role !== "admin" && role !== "staff") {
    res.status(403).json({
      success: false,
      message: "Admin access required for this action",
    });
    return false;
  }
  return true;
}

// ==================== START BILLING FOR USER/APPLICATION (WITH DUPLICATE CHECK) ====================
export const startBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId, startDate, customAmount, notes } = req.body;

    let user = null;
    let application = null;
    let plan = null;
    let customerId = null;
    let customerType = "";

    if (applicationId) {
      // Check if application exists
      application = await Application.findOne({ applicationId: applicationId })
        .populate("planId")
        .lean();
      if (!application) {
        return res.status(404).json({
          success: false,
          message: `Application not found with ID: ${applicationId}`,
        });
      }

      // CHECK IF BILLING ALREADY EXISTS FOR THIS APPLICATION - PREVENT DUPLICATE
      const existingBillingCycle = await BillingCycle.findOne({
        applicationId: application._id,
      }).lean();

      if (existingBillingCycle) {
        const statusMessages: Record<string, string> = {
          active: "active and running",
          paused: "paused",
          pending_activation: "pending payment confirmation",
          cancelled: "cancelled",
        };

        return res.status(400).json({
          success: false,
          message: `Billing has already been started for this application. Current status: ${statusMessages[existingBillingCycle.status] || existingBillingCycle.status}`,
          data: {
            billingCycle: existingBillingCycle,
            status: existingBillingCycle.status,
            startDate: existingBillingCycle.billingStartDate,
            nextBillingDate: existingBillingCycle.nextBillingDate,
          },
        });
      }

      // Check if there are any existing bills
      const existingBills = await Billing.findOne({
        applicationId: application._id,
      }).lean();
      if (existingBills) {
        return res.status(400).json({
          success: false,
          message:
            "This application already has billing records. Please check the billing history.",
          data: { hasBills: true },
        });
      }

      plan = application.planId as any;
      customerId = application._id;
      customerType = "application";
      console.log(
        `🚀 Starting billing for application: ${application.applicationId}`,
      );
    } else if (userId) {
      user = await User.findById(userId).populate("planId").lean();
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      // CHECK IF BILLING ALREADY EXISTS FOR THIS USER - PREVENT DUPLICATE
      const existingBillingCycle = await BillingCycle.findOne({
        userId,
      }).lean();
      if (existingBillingCycle) {
        const statusMessages: Record<string, string> = {
          active: "active and running",
          paused: "paused",
          pending_activation: "pending payment confirmation",
          cancelled: "cancelled",
        };

        return res.status(400).json({
          success: false,
          message: `Billing has already been started for this user. Current status: ${statusMessages[existingBillingCycle.status] || existingBillingCycle.status}`,
          data: {
            billingCycle: existingBillingCycle,
            status: existingBillingCycle.status,
            startDate: existingBillingCycle.billingStartDate,
            nextBillingDate: existingBillingCycle.nextBillingDate,
          },
        });
      }

      plan = user.planId as any;
      customerId = user._id;
      customerType = "user";
      console.log(`🚀 Starting billing for user: ${user.email}`);
    } else {
      return res.status(400).json({
        success: false,
        message: "Either userId or applicationId is required",
      });
    }

    if (!plan) {
      return res
        .status(400)
        .json({ success: false, message: "No plan assigned to this customer" });
    }

    const settings = await getOrCreateSettings();
    const billingCutoffDay = settings.billingCutoffDay || 24;
    const monthlyRate = plan.price;
    const dailyRate = (monthlyRate * 12) / 365;

    let installationDate = startDate ? new Date(startDate) : new Date();
    installationDate.setHours(0, 0, 0, 0);

    const installationDay = installationDate.getDate();
    const currentMonthEnd = getEndOfMonth(installationDate);
    const actualBillableDays = currentMonthEnd.getDate() - installationDay + 1;
    const isAfterCutoff = installationDay > billingCutoffDay;

    let proRatedAmount = 0;
    let billingStartDateForCycle: Date;
    let billingEndDateForCycle: Date;
    let nextBillingDate: Date;
    let createdBill: any = null;
    let billingStatus = "pending_activation";

    const cycleData: any = {
      planId: plan._id,
      monthlyRate: monthlyRate,
      currentProRatedAmount: 0,
      proRatedPaid: false,
      actualBillableDays: actualBillableDays,
      isAfterCutoff: isAfterCutoff,
      cutoffDayUsed: billingCutoffDay,
    };

    if (user) {
      cycleData.userId = user._id;
    } else if (application) {
      cycleData.applicationId = application._id;
    }

    if (isAfterCutoff) {
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
            ...cycleData,
            billingStartDate: billingStartDateForCycle,
            billingEndDate: billingEndDateForCycle,
            nextBillingDate: nextBillingDate,
            status: billingStatus,
            currentProRatedAmount: proRatedAmount,
            manualBillStart: true,
          },
        ],
        { session },
      );

      const totalAmount = monthlyRate + proRatedAmount;
      const dueDate = getDueDateForMonthly(billingStartDateForCycle, settings);

      const billData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: installationDate, end: billingEndDateForCycle },
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
        notes: notes || `Combined bill due on ${formatDateForDisplay(dueDate)}`,
      };

      if (user) billData.userId = user._id;
      if (application) billData.applicationId = application._id;

      createdBill = await Billing.create([billData], { session });

      if (settings.sendInvoiceOnInstall) {
        try {
          const customer = user || application;
          if (customer)
            await emailService.sendInvoice(customer, createdBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      }

      await session.commitTransaction();

      if (user) {
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
      } else if (application) {
        await Application.updateOne(
          { _id: application._id },
          {
            $set: {
              billingStarted: true,
              billingCycleId: billingCycle[0]._id,
            },
          },
        );
      }

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
          customerType: customerType,
          applicationId: application?.applicationId || null,
        },
      });
    } else {
      proRatedAmount = Math.round(dailyRate * actualBillableDays * 100) / 100;
      if (customAmount) {
        proRatedAmount = customAmount;
      }

      const billingPeriodStart = installationDate;
      const billingPeriodEnd = currentMonthEnd;
      nextBillingDate = getStartOfNextMonth(installationDate);

      const billingCycle = await BillingCycle.create(
        [
          {
            ...cycleData,
            billingStartDate: billingPeriodStart,
            billingEndDate: billingPeriodEnd,
            nextBillingDate: nextBillingDate,
            status: billingStatus,
            currentProRatedAmount: proRatedAmount,
            manualBillStart: false,
          },
        ],
        { session },
      );

      const dueDate = getDueDateForProRated(installationDate, settings);

      const billData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: billingPeriodStart, end: billingPeriodEnd },
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
      };

      if (user) billData.userId = user._id;
      if (application) billData.applicationId = application._id;

      createdBill = await Billing.create([billData], { session });

      if (settings.sendInvoiceOnInstall) {
        try {
          const customer = user || application;
          if (customer)
            await emailService.sendInvoice(customer, createdBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      }

      await session.commitTransaction();

      if (user) {
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
      } else if (application) {
        await Application.updateOne(
          { _id: application._id },
          {
            $set: {
              billingStarted: true,
              billingCycleId: billingCycle[0]._id,
            },
          },
        );
      }

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
          customerType: customerType,
          applicationId: application?.applicationId || null,
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
  if (!checkAdmin(req, res)) return;

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
  if (!checkAdmin(req, res)) return;

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
  if (!checkAdmin(req, res)) return;

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
  if (!checkAdmin(req, res)) return;

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
  if (!checkAdmin(req, res)) return;

  try {
    const cacheKey = getCacheKey(req.query);
    const cached = billingCyclesCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < LIST_CACHE_TTL) {
      return res.status(200).json({ success: true, data: cached.data });
    }

    const cycles = await BillingCycle.find()
      .populate("userId", "firstName lastName email username status")
      .populate("applicationId", "firstName lastName email applicationId")
      .populate("planId", "name price")
      .sort({ createdAt: -1 })
      .lean();

    const enrichedCycles = cycles.map((cycle) => {
      const c = { ...cycle };
      if (c.applicationId && (c.applicationId as any).applicationId) {
        (c as any).readableApplicationId = (
          c.applicationId as any
        ).applicationId;
      }
      return c;
    });

    billingCyclesCache.set(cacheKey, {
      data: enrichedCycles,
      timestamp: Date.now(),
    });
    res.status(200).json({ success: true, data: enrichedCycles });
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
  if (!checkAdmin(req, res)) return;

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
      .populate("applicationId", "firstName lastName email applicationId")
      .populate("billingCycleId")
      .sort({ dueDate: -1 })
      .lean();

    const enrichedBills = bills.map((bill) => {
      const b = { ...bill };
      if (b.applicationId && (b.applicationId as any).applicationId) {
        (b as any).readableApplicationId = (
          b.applicationId as any
        ).applicationId;
      }
      return b;
    });

    billsCache.set(cacheKey, { data: enrichedBills, timestamp: Date.now() });
    res.status(200).json({ success: true, data: enrichedBills });
  } catch (error) {
    next(error);
  }
};

// ==================== PAUSE BILLING (WITH UNPAID BILLS CHECK) ====================
export const pauseBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId, reason, pauseUntilDate } = req.body;

    let user = null;
    let application = null;
    let billingCycle = null;
    let customerEmail = "";
    let customerName = "";

    console.log(
      `📋 Pause billing request: userId=${userId}, applicationId=${applicationId}`,
    );

    if (applicationId) {
      application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      billingCycle = await BillingCycle.findOne({
        applicationId: application._id,
        status: { $in: ["active", "pending_activation"] },
      }).lean();
      customerEmail = application.email;
      customerName = `${application.firstName} ${application.lastName}`;
      console.log(
        `🔍 Found application: ${customerName}, Billing cycle: ${billingCycle?._id || "none"}`,
      );
    } else if (userId) {
      user = await User.findById(userId).lean();
      if (!user) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      billingCycle = await BillingCycle.findOne({
        userId,
        status: { $in: ["active", "pending_activation"] },
      }).lean();
      customerEmail = user.email;
      customerName = `${user.firstName} ${user.lastName}`;
      console.log(
        `🔍 Found user: ${customerName}, Billing cycle: ${billingCycle?._id || "none"}`,
      );
    } else {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "userId or applicationId is required",
      });
    }

    if (!billingCycle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message:
          "No active billing cycle found to pause. Customer may not have started billing yet.",
      });
    }

    // Check for unpaid bills
    const unpaidBills = await Billing.find({
      ...(user ? { userId } : { applicationId: application?._id }),
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
    }).lean();

    console.log(`💰 Unpaid bills found: ${unpaidBills.length}`);

    if (unpaidBills.length > 0) {
      await session.abortTransaction();
      const totalAmount = unpaidBills.reduce(
        (sum, b) => sum + (b.total || 0),
        0,
      );
      return res.status(400).json({
        success: false,
        message: `Cannot pause service. Customer has ${unpaidBills.length} unpaid bill(s) totaling ₱${totalAmount.toFixed(2)}. Please settle outstanding balance first.`,
        data: {
          unpaidBills: unpaidBills.map((b) => ({
            invoiceNumber: b.invoiceNumber,
            amount: b.total,
            dueDate: b.dueDate,
            status: b.status,
          })),
          totalAmount,
        },
      });
    }

    const pauseDate = new Date();
    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      {
        $set: {
          status: "paused",
          pausedAt: pauseDate,
          pauseReason: reason || "Customer requested pause",
          pauseUntil: pauseUntilDate ? new Date(pauseUntilDate) : undefined,
        },
      },
      { session },
    );

    if (user) {
      await User.updateOne(
        { _id: userId },
        { $set: { status: "paused" } },
        { session },
      );
      if (user.mikrotik?.username) {
        try {
          await mikrotikService.disablePPPoEUser(user);
          console.log(`🔌 Disabled MikroTik user: ${user.mikrotik.username}`);
        } catch (error) {
          console.error("Error disabling user in MikroTik:", error);
        }
      }
    } else if (application) {
      await Application.updateOne(
        { _id: application._id },
        { $set: { status: "pending" } },
        { session },
      );
    }

    await session.commitTransaction();

    // Send email notification
    try {
      await emailService.sendEmail(
        customerEmail,
        "Your Service Has Been Paused - Mister Fyber",
        `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e67e22;">⏸️ Service Paused</h2>
          <p>Dear ${customerName},</p>
          <p>Your internet service has been paused as requested.</p>
          <p><strong>Reason:</strong> ${reason || "Customer requested pause"}</p>
          ${pauseUntilDate ? `<p><strong>Auto-resume Date:</strong> ${new Date(pauseUntilDate).toLocaleDateString()}</p>` : ""}
          <p>To resume your service, please contact our support team.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>`,
      );
      console.log(`📧 Pause notification email sent to: ${customerEmail}`);
    } catch (emailError) {
      console.error("Failed to send pause notification email:", emailError);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Service paused for ${customerName}`,
      data: {
        customerName,
        customerEmail,
        pausedAt: pauseDate,
        pauseUntil: pauseUntilDate || null,
        reason: reason || "Customer requested pause",
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== RESUME BILLING (WITH UNPAID BILLS CHECK) ====================
export const resumeBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId } = req.body;

    let user = null;
    let application = null;
    let billingCycle = null;
    let customerEmail = "";
    let customerName = "";

    if (applicationId) {
      application = await Application.findOne({ applicationId })
        .populate("planId")
        .lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      billingCycle = await BillingCycle.findOne({
        applicationId: application._id,
        status: "paused",
      }).lean();
      customerEmail = application.email;
      customerName = `${application.firstName} ${application.lastName}`;
    } else if (userId) {
      user = await User.findById(userId).populate("planId").lean();
      if (!user) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      billingCycle = await BillingCycle.findOne({
        userId,
        status: "paused",
      }).lean();
      customerEmail = user.email;
      customerName = `${user.firstName} ${user.lastName}`;
    } else {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "userId or applicationId is required",
      });
    }

    if (!billingCycle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "No paused billing cycle found for this customer.",
      });
    }

    // Check for any pending bills before resuming
    const pendingBills = await Billing.find({
      ...(user ? { userId } : { applicationId: application?._id }),
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
    }).lean();

    if (pendingBills.length > 0) {
      await session.abortTransaction();
      const totalAmount = pendingBills.reduce(
        (sum, b) => sum + (b.total || 0),
        0,
      );
      return res.status(400).json({
        success: false,
        message: `Cannot resume service. Customer has ${pendingBills.length} unpaid bill(s) totaling ₱${totalAmount.toFixed(2)}. Please settle outstanding balance first.`,
        data: { pendingBills, totalAmount },
      });
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

    if (user) {
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
    } else if (application) {
      await Application.updateOne(
        { _id: application._id },
        { $set: { status: "approved" } },
        { session },
      );
    }

    await session.commitTransaction();

    // Send email notification
    try {
      await emailService.sendEmail(
        customerEmail,
        "Your Service Has Been Resumed - Mister Fyber",
        `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #27ae60;">✅ Service Resumed</h2>
          <p>Dear ${customerName},</p>
          <p>Your internet service has been resumed.</p>
          <p><strong>Next Billing Date:</strong> ${nextBillingDate.toLocaleDateString()}</p>
          <p>Thank you for being a valued customer!</p>
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>`,
      );
    } catch (emailError) {
      console.error("Failed to send resume notification email:", emailError);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Service resumed for ${customerName}`,
      data: {
        customerName,
        customerEmail,
        resumedAt: resumeDate,
        nextBillingDate,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== MARK BILL AS PAID (WITH DUPLICATE CHECK) ====================
export const markBillAsPaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const { referenceNumber, notes } = req.body;
    const adminId = req.user?._id;

    // CHECK IF BILL IS ALREADY PAID
    const existingBill = await Billing.findById(billId).session(session);

    if (!existingBill) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }

    if (existingBill.status === "paid") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Bill ${existingBill.invoiceNumber} is already paid`,
        data: {
          invoiceNumber: existingBill.invoiceNumber,
          paidAt: existingBill.updatedAt,
        },
      });
    }

    // CHECK FOR EXISTING PAYMENT FOR THIS BILL
    const existingPayment = await Payment.findOne({
      billingId: billId,
    }).session(session);
    if (existingPayment && existingPayment.status === "completed") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "A payment has already been recorded for this bill",
        data: {
          paymentId: existingPayment._id,
          status: existingPayment.status,
        },
      });
    }

    const bill = await Billing.findById(billId)
      .populate("userId")
      .populate("applicationId")
      .session(session);

    let user = null;
    let application = null;
    let customerId = null;
    let customerEmail = "";
    let customerName = "";
    let readableApplicationId = "";

    if (bill.applicationId) {
      application = bill.applicationId as any;
      if (
        application &&
        typeof application === "object" &&
        application.applicationId
      ) {
        readableApplicationId = application.applicationId;
        customerId = application._id;
        customerEmail = application.email;
        customerName = `${application.firstName} ${application.lastName}`;
      } else if (bill.applicationId) {
        application = await Application.findById(bill.applicationId).session(
          session,
        );
        if (application) {
          readableApplicationId = application.applicationId;
          customerId = application._id;
          customerEmail = application.email;
          customerName = `${application.firstName} ${application.lastName}`;
        }
      }
    } else if (bill.userId) {
      user = bill.userId as any;
      if (user && typeof user === "object" && user._id) {
        customerId = user._id;
        customerEmail = user.email;
        customerName = `${user.firstName} ${user.lastName}`;
      } else if (bill.userId) {
        user = await User.findById(bill.userId).session(session);
        if (user) {
          customerId = user._id;
          customerEmail = user.email;
          customerName = `${user.firstName} ${user.lastName}`;
        }
      }
    }

    if (!customerId) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Cannot find customer for this bill",
      });
    }

    const paymentData: any = {
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
          applicationId: readableApplicationId,
        },
      },
      paidAt: new Date(),
    };

    if (user && user._id) {
      paymentData.userId = user._id;
    } else if (application && application._id) {
      paymentData.applicationId = application._id;
    }

    const payment = await Payment.create([paymentData], { session });

    await Billing.updateOne(
      { _id: bill._id },
      { $set: { status: "paid", paymentId: payment[0]._id } },
      { session },
    );

    const billingCycle = await BillingCycle.findById(
      bill.billingCycleId,
    ).session(session);
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

    if (
      user &&
      user._id &&
      (user.status === "pending_activation" || user.status === "suspended")
    ) {
      await User.updateOne(
        { _id: user._id },
        { $set: { status: "active" } },
        { session },
      );
    }

    if (application && application._id) {
      await Application.updateOne(
        { _id: application._id },
        { $set: { billingStarted: true } },
        { session },
      );
    }

    await session.commitTransaction();

    try {
      if (application && application.email) {
        await emailService.sendEmail(
          application.email,
          `Payment Confirmation - ${bill.invoiceNumber}`,
          `<p>Your payment of ₱${bill.total.toLocaleString()} has been confirmed.</p>`,
        );
      } else if (user && user.email) {
        await emailService.sendPaymentConfirmation(user, payment[0], bill);
      }
    } catch (emailError) {
      console.error("Failed to send payment confirmation email:", emailError);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Bill ${bill.invoiceNumber} marked as paid`,
      data: {
        billId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        paymentId: payment[0]._id,
        customerType: application ? "application" : "user",
      },
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
  if (!checkAdmin(req, res)) return;

  try {
    const pendingBills = await Billing.find({
      isProRated: true,
      status: "pending_confirmation",
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .populate(
        "applicationId",
        "firstName lastName email applicationId phoneNumber",
      )
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
  if (!checkAdmin(req, res)) return;

  try {
    const pendingCycles = await BillingCycle.find({
      status: "pending_activation",
      proRatedPaid: true,
      manualBillStart: false,
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .populate(
        "applicationId",
        "firstName lastName email applicationId phoneNumber",
      )
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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId, paymentDetails } = req.body;

    let user = null;
    let application = null;
    let billingCycle = null;

    if (applicationId) {
      application = await Application.findById(applicationId).lean();
      billingCycle = await BillingCycle.findOne({
        applicationId,
        status: "pending_activation",
      })
        .populate("planId")
        .lean();
    } else if (userId) {
      user = await User.findById(userId).populate("planId").lean();
      billingCycle = await BillingCycle.findOne({
        userId,
        status: "pending_activation",
      })
        .populate("planId")
        .lean();
    }

    if ((!user && !application) || !billingCycle) {
      return res.status(404).json({
        success: false,
        message: "User/Application or billing cycle not found",
      });
    }

    const proRatedBill = await Billing.findOne({
      ...(applicationId ? { applicationId } : { userId }),
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

    const paymentData: any = {
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
    };

    if (user && user._id) {
      paymentData.userId = user._id;
    } else if (application && application._id) {
      paymentData.applicationId = application._id;
    }

    const payment = await Payment.create([paymentData], { session });

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

    if (user) {
      await User.updateOne(
        { _id: userId },
        { $set: { status: "active" } },
        { session },
      );
    } else if (application) {
      await Application.updateOne(
        { _id: applicationId },
        { $set: { billingStarted: true } },
        { session },
      );
    }

    await session.commitTransaction();

    const email = user?.email || application?.email;
    if (email) {
      await emailService.sendEmail(
        email,
        "Pro-rated Payment Confirmed",
        `<p>Your payment of ₱${proRatedBill.total} has been confirmed.</p>`,
      );
    }

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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId } = req.body;

    let user = null;
    let application = null;
    let billingCycle = null;

    if (applicationId) {
      application = await Application.findById(applicationId)
        .populate("planId")
        .lean();
      billingCycle = await BillingCycle.findOne({
        applicationId,
        status: "pending_activation",
        proRatedPaid: true,
      })
        .populate("planId")
        .lean();
    } else if (userId) {
      user = await User.findById(userId).populate("planId").lean();
      billingCycle = await BillingCycle.findOne({
        userId,
        status: "pending_activation",
        proRatedPaid: true,
      })
        .populate("planId")
        .lean();
    }

    if ((!user && !application) || !billingCycle) {
      return res.status(404).json({
        success: false,
        message: "User/Application or billing cycle not found",
      });
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

    const billData: any = {
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
    };

    if (userId) {
      billData.userId = userId;
    } else if (applicationId) {
      billData.applicationId = applicationId;
    }

    const firstMonthlyBill = await Billing.create([billData], { session });

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

    if (user) {
      await User.updateOne(
        { _id: userId },
        { $set: { status: "active" } },
        { session },
      );
    }

    await session.commitTransaction();

    const customer = user || application;
    if (customer) {
      await emailService.sendInvoice(customer, firstMonthlyBill[0]);
    }

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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId, reason } = req.body;

    let user = null;
    let application = null;
    let billingCycle = null;

    if (applicationId) {
      application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      billingCycle = await BillingCycle.findOne({
        applicationId: application._id,
        status: { $in: ["active", "paused"] },
      }).lean();
    } else if (userId) {
      user = await User.findById(userId).lean();
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      billingCycle = await BillingCycle.findOne({
        userId,
        status: { $in: ["active", "paused"] },
      }).lean();
    } else {
      return res.status(400).json({
        success: false,
        message: "userId or applicationId is required",
      });
    }

    if (!billingCycle) {
      return res
        .status(404)
        .json({ success: false, message: "No active billing cycle found" });
    }

    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      {
        $set: {
          status: "cancelled",
          billingEndDate: new Date(),
          disconnectReason: reason,
        },
      },
      { session },
    );

    if (user) {
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
    } else if (application) {
      await Application.updateOne(
        { _id: application._id },
        { $set: { status: "rejected" } },
        { session },
      );
    }

    await session.commitTransaction();
    clearAllCache();

    const name = user?.firstName || application?.firstName;
    res.status(200).json({
      success: true,
      message: `Billing stopped for ${name}`,
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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId, reason } = req.body;

    let user = null;
    let application = null;

    if (applicationId) {
      application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      await Application.updateOne(
        { _id: application._id },
        { $set: { status: "rejected" } },
        { session },
      );
    } else if (userId) {
      user = await User.findById(userId).lean();
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
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
    } else {
      return res.status(400).json({
        success: false,
        message: "userId or applicationId is required",
      });
    }

    await session.commitTransaction();
    clearAllCache();

    const name = user?.firstName || application?.firstName;
    res.status(200).json({
      success: true,
      message: `Service disconnected for ${name}`,
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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, applicationId } = req.body;

    let user = null;
    let application = null;

    if (applicationId) {
      application = await Application.findOne({ applicationId })
        .populate("planId")
        .lean();
      if (!application) {
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      await Application.updateOne(
        { _id: application._id },
        { $set: { status: "approved" } },
        { session },
      );
    } else if (userId) {
      user = await User.findById(userId).populate("planId").lean();
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
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
    } else {
      return res.status(400).json({
        success: false,
        message: "userId or applicationId is required",
      });
    }

    await session.commitTransaction();
    clearAllCache();

    const name = user?.firstName || application?.firstName;
    res.status(200).json({
      success: true,
      message: `Service reconnected for ${name}`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== DELETE BILLING CYCLE ====================
export const deleteBillingCycle = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billingCycleId, customerId, customerType } = req.body;

    if (!billingCycleId) {
      return res.status(400).json({
        success: false,
        message: "Billing cycle ID is required",
      });
    }

    // Find the billing cycle
    const billingCycle =
      await BillingCycle.findById(billingCycleId).session(session);

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "Billing cycle not found",
      });
    }

    // Delete all associated bills
    await Billing.deleteMany({ billingCycleId: billingCycle._id }, { session });

    // Delete the billing cycle
    await BillingCycle.deleteOne({ _id: billingCycle._id }, { session });

    // Clear billing info from user or application
    if (customerType === "user" && customerId) {
      await User.updateOne(
        { _id: customerId },
        {
          $unset: {
            "billingInfo.currentBill": "",
            "billingInfo.nextBillingDate": "",
            "billingInfo.billingCycleId": "",
          },
        },
        { session },
      );
    } else if (customerType === "application" && customerId) {
      await Application.updateOne(
        { _id: customerId },
        {
          $set: { billingStarted: false },
          $unset: { billingCycleId: "" },
        },
        { session },
      );
    }

    await session.commitTransaction();
    clearAllCache();

    res.status(200).json({
      success: true,
      message: "Billing cycle and associated records deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Delete billing cycle error:", error);
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
      .populate("applicationId planId")
      .lean();

    let generatedCount = 0;
    for (const cycle of billingCycles) {
      const user = cycle.userId as any;
      const application = cycle.applicationId as any;
      const plan = cycle.planId as any;
      if ((!user && !application) || !plan) continue;

      const billingStart = new Date(cycle.nextBillingDate);
      billingStart.setHours(0, 0, 0, 0);
      const billingEnd = getEndOfMonth(billingStart);
      const dueDate = getDueDateForRegularMonthly(billingStart, settings);

      const existingBill = await Billing.findOne({
        ...(user ? { userId: user._id } : { applicationId: application._id }),
        billingCycleId: cycle._id,
        isProRated: false,
        "billingPeriod.start": billingStart,
      }).lean();

      if (existingBill) continue;

      const billData: any = {
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
      };

      if (user) {
        billData.userId = user._id;
      } else if (application) {
        billData.applicationId = application._id;
      }

      const bill = await Billing.create(billData);

      const nextDate = getStartOfNextMonth(billingStart);
      await BillingCycle.updateOne(
        { _id: cycle._id },
        { $set: { nextBillingDate: nextDate } },
      );

      try {
        const customer = user || application;
        if (customer) {
          await emailService.sendInvoice(customer, bill);
        }
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
        .populate("applicationId")
        .lean();

      for (const bill of bills) {
        const customer = (bill.userId as any) || (bill.applicationId as any);
        if (customer?.email) {
          await emailService.sendEmail(
            customer.email,
            `Payment Reminder - Invoice ${bill.invoiceNumber}`,
            `<p>Dear ${customer.firstName || customer.username},</p>
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

    if (!userId) {
      return res.status(200).json({ success: true, data: null });
    }

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

    if (!userId) {
      return res.status(200).json({
        success: true,
        data: { billingHistory: [], total: 0, page: 1, pages: 0 },
      });
    }

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

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Please login to submit payment" });
    }

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

// ==================== GET BILLING STATUS FOR APPLICATION ====================
export const getApplicationBillingStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application._id,
    })
      .populate("planId")
      .lean();

    const bills = await Billing.find({ applicationId: application._id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        application,
        billingCycle,
        bills,
        hasBillingStarted: !!billingCycle,
      },
    });
  } catch (error) {
    next(error);
  }
};

export default {
  startBilling,
  stopBilling,
  pauseBilling,
  resumeBilling,
  disconnectClient,
  reconnectClient,
  deleteBillingCycle,
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
  getApplicationBillingStatus,
};
