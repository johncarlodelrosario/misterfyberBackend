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

function generateInstallationInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `INST-${year}${month}-${timestamp}${random}`;
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
      installationFee: 1500,
      installationFeeDueDays: 7,
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

function getDueDateForInstallationFee(
  installationDate: Date,
  settings: any,
): Date {
  const dueDays = settings.installationFeeDueDays || 7;
  const dueDate = new Date(installationDate);
  dueDate.setDate(dueDate.getDate() + dueDays);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate;
}

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

async function sendInvoiceToApplication(
  application: any,
  bill: any,
): Promise<void> {
  if (application && application.email) {
    const tempUser = {
      _id: application.applicationId || application._id,
      email: application.email,
      firstName: application.firstName || "",
      lastName: application.lastName || "",
      username: application.email,
      password: "",
      phoneNumber: application.phoneNumber || "",
      status: "active",
      role: "user",
      failedLoginAttempts: 0,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      billingInfo: {},
      isDeleted: false,
      comparePassword: async () => false,
      save: async () => tempUser,
    } as any;

    await emailService.sendInvoice(tempUser, bill);
  }
}

// ==================== CREATE SEPARATE INSTALLATION BILL ====================
async function createInstallationBill(
  application: any,
  billingCycleId: mongoose.Types.ObjectId,
  installationFee: number,
  settings: any,
  session: mongoose.ClientSession,
): Promise<any> {
  if (!installationFee || installationFee <= 0) {
    return null;
  }

  const dueDate = getDueDateForInstallationFee(new Date(), settings);

  const installationBillData = {
    billingCycleId: billingCycleId,
    invoiceNumber: generateInstallationInvoiceNumber(),
    billingPeriod: {
      start: new Date(),
      end: new Date(),
    },
    dueDate: dueDate,
    items: [
      {
        description: `Installation Fee (One-time) - Due within ${settings.installationFeeDueDays || 7} days`,
        quantity: 1,
        rate: installationFee,
        amount: installationFee,
      },
    ],
    subtotal: installationFee,
    tax: 0,
    discount: 0,
    total: installationFee,
    status: "sent",
    isProRated: false,
    proRatedDays: 0,
    isInstallationBill: true,
    installationFee: installationFee,
    installationFeePaid: false,
    notes: `Installation fee bill - Separate from monthly subscription. Due on ${formatDateForDisplay(dueDate)}`,
    applicationId: application.applicationId,
  };

  const installationBill = await Billing.create([installationBillData], {
    session,
  });

  // Update billing cycle with installation bill reference
  await BillingCycle.updateOne(
    { _id: billingCycleId },
    { $set: { installationFeeBillId: installationBill[0]._id } },
    { session },
  );

  // Send installation fee invoice email
  try {
    await sendInvoiceToApplication(application, installationBill[0]);
    console.log(`📧 Sent installation fee invoice to ${application.email}`);
  } catch (emailError) {
    console.error("Failed to send installation fee invoice email:", emailError);
  }

  return installationBill[0];
}

// ==================== CREATE MONTHLY BILL ====================
async function createMonthlyBill(
  application: any,
  billingCycleId: mongoose.Types.ObjectId,
  billingStart: Date,
  billingEnd: Date,
  monthlyRate: number,
  settings: any,
  isProRated: boolean = false,
  proRatedDays: number = 0,
  proRatedAmount: number = 0,
  session?: mongoose.ClientSession,
): Promise<any> {
  const dueDate = getDueDateForRegularMonthly(billingStart, settings);
  let amount = monthlyRate;
  let description = `Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}`;
  let items: any[] = [];

  if (isProRated && proRatedAmount > 0) {
    amount = proRatedAmount;
    description = `Pro-rated payment from ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)} (${proRatedDays} days)`;
    items.push({
      description: description,
      quantity: proRatedDays,
      rate: proRatedAmount / proRatedDays,
      amount: proRatedAmount,
    });
  } else {
    items.push({
      description: description,
      quantity: 1,
      rate: amount,
      amount: amount,
    });
  }

  const billData: any = {
    billingCycleId: billingCycleId,
    invoiceNumber: generateInvoiceNumber(),
    billingPeriod: { start: billingStart, end: billingEnd },
    dueDate: dueDate,
    items: items,
    subtotal: amount,
    tax: 0,
    discount: 0,
    total: amount,
    status: "sent",
    isProRated: isProRated,
    proRatedDays: proRatedDays,
    isInstallationBill: false,
    installationFee: 0,
    installationFeePaid: false,
    notes: isProRated
      ? "Pro-rated payment for partial month"
      : "Monthly subscription",
    applicationId: application.applicationId,
  };

  const bill = session
    ? await Billing.create([billData], { session })
    : await Billing.create([billData]);

  const createdBill = session ? bill[0] : bill;

  // Send email
  try {
    await sendInvoiceToApplication(application, createdBill);
  } catch (emailError) {
    console.error("Failed to send invoice email:", emailError);
  }

  return createdBill;
}

// ==================== INITIALIZE BACKDATED BILLING FOR EXISTING CUSTOMER ====================
export const initializeBackdatedBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      applicationId,
      serviceStartDate,
      customPlanName,
      monthlyRate,
      skipFirstBill,
      notes,
      includeInstallationFee,
    } = req.body;

    if (!applicationId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    if (!serviceStartDate) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "serviceStartDate is required (when customer started using service)",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: `Application not found with ID: ${applicationId}`,
      });
    }

    const existingBillingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
    }).session(session);

    if (existingBillingCycle) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Billing already exists for this application. Status: ${existingBillingCycle.status}`,
      });
    }

    let plan: any = application.planId;

    if (!plan && customPlanName && monthlyRate) {
      const PlanModel = require("../models/Plan").default;
      plan = await PlanModel.create({
        name: customPlanName,
        price: monthlyRate,
        speed: { download: 0, upload: 0 },
        type: "custom",
        isActive: true,
      });
    } else if (plan) {
      plan = await require("../models/Plan").default.findById(plan);
    }

    if (!plan && !monthlyRate) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "Either a plan must be assigned or customPlanName + monthlyRate provided",
      });
    }

    const actualMonthlyRate = plan ? plan.price : monthlyRate;
    const settings = await getOrCreateSettings();
    const installationFee = includeInstallationFee
      ? settings.installationFee || 1500
      : 0;

    const startDate = new Date(serviceStartDate);
    startDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const billingStartDate = new Date(startDate);
    billingStartDate.setDate(1);
    billingStartDate.setHours(0, 0, 0, 0);

    const billingEndDate = getEndOfMonth(billingStartDate);
    let nextBillingDate = getStartOfNextMonth(billingStartDate);

    const billingCycle = await BillingCycle.create(
      [
        {
          applicationId: application.applicationId,
          planId: plan?._id || null,
          monthlyRate: actualMonthlyRate,
          billingStartDate: billingStartDate,
          billingEndDate: billingEndDate,
          nextBillingDate: nextBillingDate,
          status: "active",
          proRatedPaid: true,
          proRatedPaidAt: new Date(),
          currentProRatedAmount: 0,
          actualBillableDays: 0,
          manualBillStart: true,
          manuallyStartedAt: new Date(),
          installationFee: installationFee,
          installationFeePaid: installationFee === 0,
        },
      ],
      { session },
    );

    const generatedBills = [];
    const missingMonths = [];
    let currentBillDate = new Date(startDate);
    currentBillDate.setDate(1);
    currentBillDate.setHours(0, 0, 0, 0);
    let totalMonthlyAmount = 0;
    const unpaidMonths = [];
    let isFirstBill = true;

    while (currentBillDate <= today) {
      const billingStart = new Date(currentBillDate);
      const billingEnd = getEndOfMonth(billingStart);
      const dueDate = getDueDateForRegularMonthly(billingStart, settings);

      const existingBill = await Billing.findOne({
        applicationId: application.applicationId,
        billingCycleId: billingCycle[0]._id,
        "billingPeriod.start": billingStart,
        isInstallationBill: false,
      }).session(session);

      if (!existingBill) {
        let amount = actualMonthlyRate;
        let description = `Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}`;
        let isProRated = false;
        let proRatedDays = 0;
        let isMissingBill = false;
        let items: any[] = [];

        if (
          currentBillDate.getTime() ===
            new Date(
              startDate.getFullYear(),
              startDate.getMonth(),
              1,
            ).getTime() &&
          startDate.getDate() > 1
        ) {
          const daysInMonth = new Date(
            startDate.getFullYear(),
            startDate.getMonth() + 1,
            0,
          ).getDate();
          const daysUsed = daysInMonth - startDate.getDate() + 1;
          const dailyRate = (actualMonthlyRate * 12) / 365;
          amount = Math.round(dailyRate * daysUsed * 100) / 100;
          description = `Pro-rated payment from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(billingEnd)} (${daysUsed} days)`;
          isProRated = true;
          proRatedDays = daysUsed;
          items.push({
            description: description,
            quantity: daysUsed,
            rate: dailyRate,
            amount: amount,
          });
        } else if (currentBillDate < today) {
          isMissingBill = true;
          description = `[MISSING BILL - BACKDATED] Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}`;
          items.push({
            description: description,
            quantity: 1,
            rate: amount,
            amount: amount,
          });
        } else {
          items.push({
            description: description,
            quantity: 1,
            rate: amount,
            amount: amount,
          });
        }

        const billData: any = {
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: billingStart, end: billingEnd },
          dueDate: dueDate,
          items: items,
          subtotal: amount,
          total: amount,
          status: "sent",
          isProRated: isProRated,
          proRatedDays: proRatedDays,
          isInstallationBill: false,
          installationFee: 0,
          installationFeePaid: false,
          applicationId: application.applicationId,
          notes:
            notes ||
            (isMissingBill
              ? `MISSING BILL - Generated from backdated billing. Original period: ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}. Customer started service on ${formatDateForDisplay(startDate)}.`
              : `Generated from backdated billing starting ${formatDateForDisplay(startDate)}`),
        };

        const newBill = await Billing.create([billData], { session });
        generatedBills.push(newBill[0]);
        totalMonthlyAmount += amount;

        if (isMissingBill) {
          missingMonths.push({
            month: formatDateForDisplay(billingStart),
            amount: amount,
            billId: newBill[0]._id,
            invoiceNumber: newBill[0].invoiceNumber,
          });
        }

        try {
          await sendInvoiceToApplication(application, newBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      } else if (
        existingBill.status !== "paid" &&
        !existingBill.isInstallationBill
      ) {
        unpaidMonths.push({
          month: formatDateForDisplay(billingStart),
          amount: existingBill.total,
          billId: existingBill._id,
          invoiceNumber: existingBill.invoiceNumber,
          status: existingBill.status,
        });
      }

      currentBillDate.setMonth(currentBillDate.getMonth() + 1);
    }

    // Create SEPARATE installation bill if applicable
    let installationBill = null;
    if (installationFee > 0) {
      installationBill = await createInstallationBill(
        application,
        billingCycle[0]._id,
        installationFee,
        settings,
        session,
      );
    }

    const lastGeneratedMonth = new Date(currentBillDate);
    lastGeneratedMonth.setMonth(lastGeneratedMonth.getMonth() - 1);
    lastGeneratedMonth.setDate(1);

    const newNextBillingDate = new Date(lastGeneratedMonth);
    newNextBillingDate.setMonth(newNextBillingDate.getMonth() + 1);
    newNextBillingDate.setDate(1);

    await BillingCycle.updateOne(
      { _id: billingCycle[0]._id },
      { $set: { nextBillingDate: newNextBillingDate } },
      { session },
    );

    await Application.updateOne(
      { applicationId: application.applicationId },
      {
        $set: {
          billingStarted: true,
          billingCycleId: billingCycle[0]._id,
          serviceStatus: "active",
          lastBillingAudit: new Date(),
          installationFee: installationFee,
          installationFeePaid: installationFee === 0,
        },
      },
      { session },
    );

    await session.commitTransaction();
    clearAllCache();

    let message = `Backdated billing initialized for ${application.firstName} ${application.lastName}. Generated ${generatedBills.length} monthly bill(s) totaling ₱${totalMonthlyAmount.toFixed(2)}.`;

    if (installationBill) {
      message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately (Invoice: ${installationBill.invoiceNumber}, due on ${formatDateForDisplay(installationBill.dueDate)}).`;
    } else if (installationFee > 0) {
      message += ` Installation fee of ₱${installationFee.toFixed(2)} included.`;
    }

    if (missingMonths.length > 0) {
      message += ` Missing months found: ${missingMonths.map((m) => m.month).join(", ")}. Bills have been generated for these periods.`;
    }

    if (unpaidMonths.length > 0) {
      message += ` Warning: ${unpaidMonths.length} unpaid monthly bill(s) detected from previous periods.`;
    }

    res.status(200).json({
      success: true,
      message: message,
      data: {
        billingCycle: billingCycle[0],
        generatedMonthlyBills: generatedBills,
        installationBill: installationBill,
        totalMonthlyAmount: totalMonthlyAmount,
        totalInstallationFee: installationFee,
        billsCount: generatedBills.length,
        serviceStartDate: startDate,
        applicationId: application.applicationId,
        missingMonths: missingMonths,
        unpaidPreviousBills: unpaidMonths,
        currentDate: today,
        installationFee: installationFee,
        installationFeeSeparate: installationBill !== null,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== START BILLING FOR APPLICATION ====================
export const startBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      applicationId,
      startDate,
      customAmount,
      notes,
      includeInstallationFee,
    } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({
      applicationId: applicationId,
    })
      .populate("planId")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: `Application not found with ID: ${applicationId}`,
      });
    }

    const existingBillingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
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

    const plan = application.planId as any;
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "No plan assigned to this application",
      });
    }

    const settings = await getOrCreateSettings();
    const billingCutoffDay = settings.billingCutoffDay || 24;
    const monthlyRate = plan.price;
    const dailyRate = (monthlyRate * 12) / 365;
    const installationFee = includeInstallationFee
      ? settings.installationFee || 1500
      : 0;

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
    let createdMonthlyBill: any = null;
    let createdInstallationBill: any = null;
    let billingStatus = "pending_activation";

    const cycleData: any = {
      planId: plan._id,
      monthlyRate: monthlyRate,
      currentProRatedAmount: 0,
      proRatedPaid: false,
      actualBillableDays: actualBillableDays,
      isAfterCutoff: isAfterCutoff,
      cutoffDayUsed: billingCutoffDay,
      applicationId: application.applicationId,
      installationFee: installationFee,
      installationFeePaid: false,
    };

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

      // Create monthly bill (combined pro-rated + full month)
      const totalMonthlyAmount = monthlyRate + proRatedAmount;
      const dueDate = getDueDateForMonthly(billingStartDateForCycle, settings);

      const items: any[] = [
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
      ];

      const billData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: installationDate, end: billingEndDateForCycle },
        dueDate: dueDate,
        items: items,
        subtotal: totalMonthlyAmount,
        tax: 0,
        discount: 0,
        total: totalMonthlyAmount,
        status: "sent",
        isProRated: false,
        proRatedDays: actualBillableDays,
        isInstallationBill: false,
        installationFee: 0,
        installationFeePaid: false,
        notes: notes || `Combined bill due on ${formatDateForDisplay(dueDate)}`,
        applicationId: application.applicationId,
      };

      createdMonthlyBill = await Billing.create([billData], { session });

      // Create SEPARATE installation bill
      if (installationFee > 0) {
        createdInstallationBill = await createInstallationBill(
          application,
          billingCycle[0]._id,
          installationFee,
          settings,
          session,
        );
      }

      if (settings.sendInvoiceOnInstall && createdMonthlyBill) {
        try {
          await sendInvoiceToApplication(application, createdMonthlyBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      }

      await session.commitTransaction();

      await Application.updateOne(
        { applicationId: application.applicationId },
        {
          $set: {
            billingStarted: true,
            billingCycleId: billingCycle[0]._id,
            serviceStatus: "active",
            installationFee: installationFee,
            installationFeePaid: false,
          },
        },
      );

      clearAllCache();

      let message = `Installation on day ${installationDay} (after cutoff). Combined monthly bill due on ${formatDateForDisplay(dueDate)}.`;
      if (createdInstallationBill) {
        message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately (Invoice: ${createdInstallationBill.invoiceNumber}, due on ${formatDateForDisplay(createdInstallationBill.dueDate)}).`;
      }

      res.status(200).json({
        success: true,
        message: message,
        data: {
          billingCycle: billingCycle[0],
          monthlyBill: createdMonthlyBill ? createdMonthlyBill[0] : null,
          installationBill: createdInstallationBill,
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
          applicationId: application.applicationId,
          installationFee: installationFee,
          installationFeeSeparate: createdInstallationBill !== null,
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

      // Create pro-rated monthly bill
      const dueDate = getDueDateForProRated(installationDate, settings);

      const items: any[] = [
        {
          description: `Pro-rated payment from ${formatDateForDisplay(installationDate)} to ${formatDateForDisplay(billingPeriodEnd)} (${actualBillableDays} days) - Daily rate: ₱${dailyRate.toFixed(4)}`,
          quantity: actualBillableDays,
          rate: dailyRate,
          amount: proRatedAmount,
        },
      ];

      const billData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: billingPeriodStart, end: billingPeriodEnd },
        dueDate: dueDate,
        items: items,
        subtotal: proRatedAmount,
        tax: 0,
        discount: 0,
        total: proRatedAmount,
        status: "sent",
        isProRated: true,
        proRatedDays: actualBillableDays,
        isInstallationBill: false,
        installationFee: 0,
        installationFeePaid: false,
        notes:
          notes ||
          `Pro-rated bill due on ${formatDateForDisplay(dueDate)}. Next billing starts ${formatDateForDisplay(nextBillingDate)}`,
        applicationId: application.applicationId,
      };

      createdMonthlyBill = await Billing.create([billData], { session });

      // Create SEPARATE installation bill
      if (installationFee > 0) {
        createdInstallationBill = await createInstallationBill(
          application,
          billingCycle[0]._id,
          installationFee,
          settings,
          session,
        );
      }

      if (settings.sendInvoiceOnInstall && createdMonthlyBill) {
        try {
          await sendInvoiceToApplication(application, createdMonthlyBill[0]);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }
      }

      await session.commitTransaction();

      await Application.updateOne(
        { applicationId: application.applicationId },
        {
          $set: {
            billingStarted: true,
            billingCycleId: billingCycle[0]._id,
            serviceStatus: "active",
            installationFee: installationFee,
            installationFeePaid: false,
          },
        },
      );

      clearAllCache();

      let message = `Pro-rated amount of ₱${proRatedAmount.toFixed(2)} for ${actualBillableDays} days due on ${formatDateForDisplay(dueDate)}.`;
      if (createdInstallationBill) {
        message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately (Invoice: ${createdInstallationBill.invoiceNumber}, due on ${formatDateForDisplay(createdInstallationBill.dueDate)}).`;
      }

      res.status(200).json({
        success: true,
        message: message,
        data: {
          billingCycle: billingCycle[0],
          monthlyBill: createdMonthlyBill ? createdMonthlyBill[0] : null,
          installationBill: createdInstallationBill,
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
          applicationId: application.applicationId,
          installationFee: installationFee,
          installationFeeSeparate: createdInstallationBill !== null,
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
        installationFee: 1500,
        installationFeeDueDays: 7,
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
        installationFee: 1500,
        installationFeeDueDays: 7,
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
      installationFee,
      installationFeeDueDays,
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
        installationFee,
        installationFeeDueDays,
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
      unpaidInstallationFees,
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
      Billing.countDocuments({ status: "overdue", isInstallationBill: false }),
      Billing.countDocuments({ isProRated: true, status: "sent" }),
      Billing.aggregate([
        {
          $match: {
            status: { $in: ["sent", "overdue", "pending_confirmation"] },
            isInstallationBill: false,
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
      Billing.aggregate([
        {
          $match: {
            isInstallationBill: true,
            installationFeePaid: false,
            status: { $in: ["sent", "overdue"] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$installationFee" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const totalOutstanding = outstandingResult[0]?.total || 0;
    const unpaidInstallationTotal = unpaidInstallationFees[0]?.total || 0;
    const unpaidInstallationCount = unpaidInstallationFees[0]?.count || 0;

    const data = {
      activeSubscriptions: totalActiveCycles,
      pausedSubscriptions: totalPausedCycles,
      pendingProRated: pendingProRated,
      pendingActivations: pendingActivations,
      overdueAccounts: overdueBills,
      totalOutstanding: totalOutstanding,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      unpaidProRated: unpaidProRated,
      unpaidInstallationFees: {
        total: unpaidInstallationTotal,
        count: unpaidInstallationCount,
      },
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
      .populate("planId", "name price")
      .sort({ createdAt: -1 })
      .lean();

    const enrichedCycles = await Promise.all(
      cycles.map(async (cycle) => {
        const c = { ...cycle };
        if (c.applicationId) {
          const application = await Application.findOne({
            applicationId: c.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            (c as any).applicationData = application;
          }
        }
        return c;
      }),
    );

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
    if (type === "installation") query.isInstallationBill = true;

    const bills = await Billing.find(query)
      .populate("billingCycleId")
      .sort({ dueDate: -1 })
      .lean();

    const enrichedBills = await Promise.all(
      bills.map(async (bill) => {
        const b = { ...bill };
        if (b.applicationId) {
          const application = await Application.findOne({
            applicationId: b.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            (b as any).applicationData = application;
          }
        }
        return b;
      }),
    );

    billsCache.set(cacheKey, { data: enrichedBills, timestamp: Date.now() });
    res.status(200).json({ success: true, data: enrichedBills });
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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { applicationId, reason, pauseUntilDate } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: { $in: ["active", "pending_activation"] },
    }).lean();

    if (!billingCycle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found to pause.",
      });
    }

    const unpaidMonthlyBills = await Billing.find({
      applicationId: application.applicationId,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
      isInstallationBill: false,
    }).lean();

    if (unpaidMonthlyBills.length > 0) {
      await session.abortTransaction();
      const totalAmount = unpaidMonthlyBills.reduce(
        (sum, b) => sum + (b.total || 0),
        0,
      );
      return res.status(400).json({
        success: false,
        message: `Cannot pause service. Customer has ${unpaidMonthlyBills.length} unpaid monthly bill(s) totaling ₱${totalAmount.toFixed(2)}.`,
        data: { unpaidMonthlyBills, totalAmount },
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

    await Application.updateOne(
      { applicationId: application.applicationId },
      { $set: { status: "pending" } },
      { session },
    );

    await session.commitTransaction();

    try {
      await emailService.sendEmail(
        application.email,
        "Your Service Has Been Paused - Mister Fyber",
        `<div><h2>Service Paused</h2><p>Dear ${application.firstName} ${application.lastName},</p><p>Your internet service has been paused.</p></div>`,
      );
    } catch (emailError) {
      console.error("Failed to send pause notification email:", emailError);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Service paused for ${application.firstName} ${application.lastName}`,
      data: {
        customerName: `${application.firstName} ${application.lastName}`,
        customerEmail: application.email,
        pausedAt: pauseDate,
      },
    });
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
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();

    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "paused",
    }).lean();

    if (!billingCycle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "No paused billing cycle found for this customer.",
      });
    }

    const pendingMonthlyBills = await Billing.find({
      applicationId: application.applicationId,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
      isInstallationBill: false,
    }).lean();

    if (pendingMonthlyBills.length > 0) {
      await session.abortTransaction();
      const totalAmount = pendingMonthlyBills.reduce(
        (sum, b) => sum + (b.total || 0),
        0,
      );
      return res.status(400).json({
        success: false,
        message: `Cannot resume service. Customer has ${pendingMonthlyBills.length} unpaid monthly bill(s) totaling ₱${totalAmount.toFixed(2)}.`,
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

    await Application.updateOne(
      { applicationId: application.applicationId },
      { $set: { status: "approved" } },
      { session },
    );

    await session.commitTransaction();

    try {
      await emailService.sendEmail(
        application.email,
        "Your Service Has Been Resumed - Mister Fyber",
        `<div><h2>Service Resumed</h2><p>Dear ${application.firstName} ${application.lastName},</p><p>Your internet service has been resumed.</p></div>`,
      );
    } catch (emailError) {
      console.error("Failed to send resume notification email:", emailError);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Service resumed for ${application.firstName} ${application.lastName}`,
      data: {
        customerName: `${application.firstName} ${application.lastName}`,
        customerEmail: application.email,
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

// ==================== MARK INSTALLATION BILL AS PAID ====================
export const markInstallationBillAsPaid = async (
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

    const installationBill = await Billing.findById(billId).session(session);
    if (!installationBill) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }

    if (!installationBill.isInstallationBill) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "This is not an installation fee bill",
      });
    }

    if (installationBill.status === "paid") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Installation bill ${installationBill.invoiceNumber} is already paid`,
      });
    }

    let application = null;
    if (installationBill.applicationId) {
      application = await Application.findOne({
        applicationId: installationBill.applicationId,
      }).lean();
    }

    const paymentData: any = {
      amount: installationBill.total,
      paymentMethod: "manual",
      paymentType: "installation",
      status: "completed",
      referenceNumber: referenceNumber || `INST-ADMIN-${Date.now()}`,
      billingId: installationBill._id,
      paymentDetails: {
        gateway: "manual",
        gatewayResponse: {
          confirmedBy: adminId,
          confirmedAt: new Date(),
          notes: notes || "Installation fee marked as paid by admin",
          applicationId: installationBill.applicationId,
        },
      },
      paidAt: new Date(),
    };

    if (application) {
      paymentData.applicationId = application.applicationId;
    }

    const payment = await Payment.create([paymentData], { session });

    await Billing.updateOne(
      { _id: installationBill._id },
      {
        $set: {
          status: "paid",
          paymentId: payment[0]._id,
          paidAt: new Date(),
          installationFeePaid: true,
        },
      },
      { session },
    );

    const billingCycle = await BillingCycle.findById(
      installationBill.billingCycleId,
    ).session(session);
    if (billingCycle) {
      billingCycle.installationFeePaid = true;
      billingCycle.paymentHistory = billingCycle.paymentHistory || [];
      billingCycle.paymentHistory.push({
        billingId: installationBill._id,
        amount: installationBill.total,
        paidAt: new Date(),
      });
      await billingCycle.save({ session });
    }

    if (application) {
      await Application.updateOne(
        { applicationId: application.applicationId },
        { $set: { installationFeePaid: true } },
        { session },
      );
    }

    await session.commitTransaction();

    try {
      if (application && application.email) {
        await emailService.sendEmail(
          application.email,
          `Installation Fee Payment Confirmation - ${installationBill.invoiceNumber}`,
          `<div><h2>Installation Fee Payment Confirmed!</h2><p>Dear ${application.firstName},</p><p>Your installation fee payment of ₱${installationBill.total.toLocaleString()} has been confirmed.</p></div>`,
        );
      }
    } catch (emailError) {
      console.error(
        "Failed to send installation fee payment confirmation email:",
        emailError,
      );
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Installation bill ${installationBill.invoiceNumber} marked as paid`,
      data: {
        billId: installationBill._id,
        invoiceNumber: installationBill.invoiceNumber,
        paymentId: payment[0]._id,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== MARK MONTHLY BILL AS PAID ====================
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

    const existingBill = await Billing.findById(billId).session(session);
    if (!existingBill) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }

    if (existingBill.isInstallationBill) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "Please use the installation bill payment endpoint for installation fees",
      });
    }

    if (existingBill.status === "paid") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Bill ${existingBill.invoiceNumber} is already paid`,
      });
    }

    let application = null;
    let customerEmail = "";
    let customerName = "";

    if (existingBill.applicationId) {
      application = await Application.findOne({
        applicationId: existingBill.applicationId,
      }).lean();
      if (application) {
        customerEmail = application.email;
        customerName = `${application.firstName} ${application.lastName}`;
      }
    }

    const paymentData: any = {
      amount: existingBill.total,
      paymentMethod: "manual",
      paymentType: "subscription",
      status: "completed",
      referenceNumber: referenceNumber || `ADMIN-${Date.now()}`,
      billingId: existingBill._id,
      paymentDetails: {
        gateway: "manual",
        gatewayResponse: {
          confirmedBy: adminId,
          confirmedAt: new Date(),
          notes: notes || "Manually marked as paid",
          applicationId: existingBill.applicationId,
        },
      },
      paidAt: new Date(),
    };

    if (application) {
      paymentData.applicationId = application.applicationId;
    }

    const payment = await Payment.create([paymentData], { session });

    await Billing.updateOne(
      { _id: existingBill._id },
      {
        $set: {
          status: "paid",
          paymentId: payment[0]._id,
          paidAt: new Date(),
        },
      },
      { session },
    );

    const billingCycle = await BillingCycle.findById(
      existingBill.billingCycleId,
    ).session(session);
    if (billingCycle) {
      billingCycle.paymentHistory = billingCycle.paymentHistory || [];
      billingCycle.paymentHistory.push({
        billingId: existingBill._id,
        amount: existingBill.total,
        paidAt: new Date(),
      });

      if (existingBill.isProRated && !billingCycle.proRatedPaid) {
        billingCycle.proRatedPaid = true;
        billingCycle.proRatedPaidAt = new Date();
        if (billingCycle.status === "pending_activation") {
          billingCycle.status = "active";
        }
      }

      await billingCycle.save({ session });
    }

    await session.commitTransaction();

    try {
      if (application && application.email) {
        let emailBody = `<div><h2>Payment Confirmed!</h2><p>Dear ${application.firstName},</p><p>Your payment of ₱${existingBill.total.toLocaleString()} has been confirmed.</p></div>`;
        await emailService.sendEmail(
          application.email,
          `Payment Confirmation - ${existingBill.invoiceNumber}`,
          emailBody,
        );
      }
    } catch (emailError) {
      console.error("Failed to send payment confirmation email:", emailError);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Bill ${existingBill.invoiceNumber} marked as paid`,
      data: {
        billId: existingBill._id,
        invoiceNumber: existingBill.invoiceNumber,
        paymentId: payment[0]._id,
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
      isInstallationBill: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    const enrichedBills = await Promise.all(
      pendingBills.map(async (bill) => {
        const b = { ...bill };
        if (b.applicationId) {
          const application = await Application.findOne({
            applicationId: b.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            (b as any).applicationData = application;
          }
        }
        return b;
      }),
    );

    res.status(200).json({ success: true, data: enrichedBills });
  } catch (error) {
    next(error);
  }
};

// ==================== GET PENDING INSTALLATION BILLS ====================
export const getPendingInstallationBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const pendingInstallationBills = await Billing.find({
      isInstallationBill: true,
      installationFeePaid: false,
      status: { $in: ["sent", "overdue"] },
    })
      .sort({ dueDate: 1 })
      .lean();

    const enrichedBills = await Promise.all(
      pendingInstallationBills.map(async (bill) => {
        const b = { ...bill };
        if (b.applicationId) {
          const application = await Application.findOne({
            applicationId: b.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            (b as any).applicationData = application;
          }
        }
        return b;
      }),
    );

    res.status(200).json({ success: true, data: enrichedBills });
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
      .populate("planId", "name price")
      .sort({ proRatedPaidAt: -1 })
      .lean();

    const enrichedCycles = await Promise.all(
      pendingCycles.map(async (cycle) => {
        const c = { ...cycle };
        if (c.applicationId) {
          const application = await Application.findOne({
            applicationId: c.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            (c as any).applicationData = application;
          }
        }
        return c;
      }),
    );

    res.status(200).json({ success: true, data: enrichedCycles });
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
    const { applicationId, paymentDetails } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "pending_activation",
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Billing cycle not found",
      });
    }

    const proRatedBill = await Billing.findOne({
      applicationId: application.applicationId,
      billingCycleId: billingCycle._id,
      isProRated: true,
      status: "pending_confirmation",
      isInstallationBill: false,
    }).lean();

    if (!proRatedBill) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Pro-rated bill not found" });
    }

    await Billing.updateOne(
      { _id: proRatedBill._id },
      { $set: { status: "paid", paidAt: new Date() } },
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
      applicationId: application.applicationId,
    };

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

    await session.commitTransaction();

    if (application.email) {
      await emailService.sendEmail(
        application.email,
        "Pro-rated Payment Confirmed",
        `<div><h2>Pro-rated Payment Confirmed!</h2><p>Dear ${application.firstName},</p><p>Your payment has been confirmed.</p></div>`,
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
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();

    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "pending_activation",
      proRatedPaid: true,
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Billing cycle not found",
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

    const monthlyBill = await createMonthlyBill(
      application,
      billingCycle._id,
      billingStart,
      billingEnd,
      monthlyRate,
      settings,
      false,
      0,
      0,
      session,
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

    await session.commitTransaction();

    clearAllCache();
    res.status(200).json({
      success: true,
      message: "Monthly billing started",
      data: { firstMonthlyBill: monthlyBill },
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
    const { applicationId, reason } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: { $in: ["active", "paused"] },
    }).lean();

    if (!billingCycle) {
      await session.abortTransaction();
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

    await Application.updateOne(
      { applicationId: application.applicationId },
      { $set: { status: "rejected" } },
      { session },
    );

    await session.commitTransaction();
    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Billing stopped for ${application.firstName} ${application.lastName}`,
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
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    await Application.updateOne(
      { applicationId: application.applicationId },
      { $set: { status: "rejected" } },
      { session },
    );

    await session.commitTransaction();
    clearAllCache();

    res.status(200).json({ success: true, message: "Service disconnected" });
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
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    await Application.updateOne(
      { applicationId: application.applicationId },
      { $set: { status: "approved" } },
      { session },
    );

    await session.commitTransaction();
    clearAllCache();

    res.status(200).json({ success: true, message: "Service reconnected" });
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
    const { billingCycleId, applicationId } = req.body;

    if (!billingCycleId) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "Billing cycle ID is required" });
    }

    const billingCycle =
      await BillingCycle.findById(billingCycleId).session(session);
    if (!billingCycle) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Billing cycle not found" });
    }

    await Billing.deleteMany({ billingCycleId: billingCycle._id }, { session });
    await BillingCycle.deleteOne({ _id: billingCycle._id }, { session });

    if (applicationId) {
      await Application.updateOne(
        { applicationId: applicationId },
        { $set: { billingStarted: false }, $unset: { billingCycleId: "" } },
        { session },
      );
    }

    await session.commitTransaction();
    clearAllCache();

    res
      .status(200)
      .json({ success: true, message: "Billing cycle deleted successfully" });
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
      applicationId: { $exists: true, $ne: null },
    })
      .populate("planId")
      .lean();

    console.log(
      `🔄 Checking ${billingCycles.length} active billing cycles for missing bills`,
    );

    let generatedCount = 0;
    let skippedCount = 0;

    for (const cycle of billingCycles) {
      if (!cycle.applicationId) {
        console.log(`⚠️ Skipping cycle ${cycle._id}: No applicationId`);
        skippedCount++;
        continue;
      }

      const application = await Application.findOne({
        applicationId: cycle.applicationId,
      }).lean();

      if (!application) {
        console.log(
          `⚠️ Skipping cycle ${cycle._id}: Application not found for ID ${cycle.applicationId}`,
        );
        skippedCount++;
        continue;
      }

      const plan = cycle.planId as any;
      if (!plan) {
        console.log(`⚠️ Skipping cycle ${cycle._id}: No plan found`);
        skippedCount++;
        continue;
      }

      const lastBill = await Billing.findOne({
        applicationId: cycle.applicationId,
        billingCycleId: cycle._id,
        isProRated: false,
        isInstallationBill: false,
      })
        .sort({ "billingPeriod.end": -1 })
        .lean();

      let startFromDate: Date;

      if (lastBill) {
        startFromDate = new Date(lastBill.billingPeriod.end);
        startFromDate.setDate(1);
        startFromDate.setMonth(startFromDate.getMonth() + 1);
      } else {
        startFromDate = new Date(cycle.nextBillingDate);
        startFromDate.setDate(1);
      }

      let currentDate = new Date(startFromDate);
      let billsGeneratedForThisCycle = 0;

      while (currentDate <= today) {
        currentDate.setDate(1);
        currentDate.setHours(0, 0, 0, 0);

        const billingStart = new Date(currentDate);
        const billingEnd = getEndOfMonth(billingStart);

        const existingBill = await Billing.findOne({
          applicationId: cycle.applicationId,
          billingCycleId: cycle._id,
          isProRated: false,
          isInstallationBill: false,
          "billingPeriod.start": billingStart,
        }).lean();

        if (!existingBill) {
          const monthlyBill = await createMonthlyBill(
            application,
            cycle._id,
            billingStart,
            billingEnd,
            plan.price,
            settings,
            false,
            0,
            0,
          );
          billsGeneratedForThisCycle++;
          console.log(
            `✅ Generated missing monthly bill for ${application.firstName} ${application.lastName} - Period: ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)} - Amount: ₱${plan.price}`,
          );
        }

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      if (billsGeneratedForThisCycle > 0) {
        const lastGeneratedMonth = new Date(currentDate);
        lastGeneratedMonth.setMonth(lastGeneratedMonth.getMonth() - 1);
        lastGeneratedMonth.setDate(1);

        const newNextBillingDate = new Date(lastGeneratedMonth);
        newNextBillingDate.setMonth(newNextBillingDate.getMonth() + 1);
        newNextBillingDate.setDate(1);

        await BillingCycle.updateOne(
          { _id: cycle._id },
          { $set: { nextBillingDate: newNextBillingDate } },
        );

        console.log(
          `📅 Updated nextBillingDate for ${application.firstName} ${application.lastName} to ${newNextBillingDate.toISOString().split("T")[0]}`,
        );
      }

      generatedCount += billsGeneratedForThisCycle;
    }

    clearAllCache();
    console.log(
      `🎉 Auto-generate complete: ${generatedCount} new monthly bills generated, ${skippedCount} cycles skipped`,
    );

    if (res) {
      res.status(200).json({
        success: true,
        message: `Generated ${generatedCount} monthly bills for applications`,
        data: { generated: generatedCount, skipped: skippedCount },
      });
    }
  } catch (error) {
    console.error("Auto-generate monthly bills error:", error);
    if (res) {
      res.status(500).json({
        success: false,
        message: "Failed to generate bills",
        error: String(error),
      });
    }
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
    let dueDateRemindersSent = 0;

    // Reminders for monthly bills (7, 3, 1 days before due date)
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
        applicationId: { $exists: true, $ne: null },
        isInstallationBill: false,
      }).lean();

      for (const bill of bills) {
        if (!bill.applicationId) continue;

        const application = await Application.findOne({
          applicationId: bill.applicationId,
        }).lean();

        if (application && application.email) {
          // Create a temporary user object for email service
          const tempUser = {
            _id: application.applicationId,
            email: application.email,
            firstName: application.firstName || "",
            lastName: application.lastName || "",
            username: application.email,
            phoneNumber: application.phoneNumber || "",
            status: "active",
            role: "user",
          } as any;

          await emailService.sendPaymentReminder(tempUser, bill);
          await Billing.updateOne(
            { _id: bill._id },
            { $set: { [reminderField]: true } },
          );
          remindersSent++;
          console.log(`📧 Sent ${days}-day reminder to ${application.email}`);
        }
      }
    }

    // ==================== DUE DATE REMINDERS (SENT ON ACTUAL DUE DATE) ====================
    const dueDateBills = await Billing.find({
      status: "sent",
      dueDate: {
        $gte: new Date(today.setHours(0, 0, 0, 0)),
        $lte: new Date(today.setHours(23, 59, 59, 999)),
      },
      reminderDueDateSent: { $ne: true },
      applicationId: { $exists: true, $ne: null },
    }).lean();

    for (const bill of dueDateBills) {
      if (!bill.applicationId) continue;

      const application = await Application.findOne({
        applicationId: bill.applicationId,
      }).lean();

      if (application && application.email) {
        const tempUser = {
          _id: application.applicationId,
          email: application.email,
          firstName: application.firstName || "",
          lastName: application.lastName || "",
          username: application.email,
          phoneNumber: application.phoneNumber || "",
          status: "active",
          role: "user",
        } as any;

        await emailService.sendDueDateReminder(tempUser, bill);
        await Billing.updateOne(
          { _id: bill._id },
          { $set: { reminderDueDateSent: true } },
        );
        dueDateRemindersSent++;
        console.log(
          `📧 Sent DUE DATE reminder to ${application.email} for invoice ${bill.invoiceNumber}`,
        );
      }
    }

    // Reminders for installation bills
    const installationBills = await Billing.find({
      isInstallationBill: true,
      installationFeePaid: false,
      status: "sent",
      dueDate: { $lte: today },
      reminder1DaySent: { $ne: true },
      applicationId: { $exists: true, $ne: null },
    }).lean();

    for (const bill of installationBills) {
      if (!bill.applicationId) continue;

      const application = await Application.findOne({
        applicationId: bill.applicationId,
      }).lean();

      if (application && application.email) {
        const tempUser = {
          _id: application.applicationId,
          email: application.email,
          firstName: application.firstName || "",
          lastName: application.lastName || "",
          username: application.email,
          phoneNumber: application.phoneNumber || "",
          status: "active",
          role: "user",
        } as any;

        // Check if it's exactly the due date for installation bill
        const dueDate = new Date(bill.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        const isDueDate = dueDate.getTime() === today.getTime();

        if (isDueDate && !bill.reminderDueDateSent) {
          await emailService.sendDueDateReminder(tempUser, bill);
          await Billing.updateOne(
            { _id: bill._id },
            { $set: { reminderDueDateSent: true } },
          );
          dueDateRemindersSent++;
          console.log(
            `📧 Sent DUE DATE reminder for installation fee to ${application.email}`,
          );
        } else if (!bill.reminder1DaySent) {
          await emailService.sendPaymentReminder(tempUser, bill);
          await Billing.updateOne(
            { _id: bill._id },
            { $set: { reminder1DaySent: true } },
          );
          remindersSent++;
          console.log(
            `📧 Sent installation fee reminder to ${application.email}`,
          );
        }
      }
    }

    if (res) {
      res.status(200).json({
        success: true,
        message: `Sent ${remindersSent} advance reminders and ${dueDateRemindersSent} due date reminders`,
        data: {
          advanceReminders: remindersSent,
          dueDateReminders: dueDateRemindersSent,
        },
      });
    }
  } catch (error) {
    console.error("Auto-send reminders error:", error);
    if (res) {
      res
        .status(500)
        .json({ success: false, message: "Failed to send reminders" });
    }
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

    const overdueMonthlyBills = await Billing.find({
      status: "overdue",
      dueDate: { $lt: gracePeriodDate },
      suspensionNotified: { $ne: true },
      applicationId: { $exists: true, $ne: null },
      isInstallationBill: false,
    }).lean();

    let suspendedCount = 0;

    for (const bill of overdueMonthlyBills) {
      if (!bill.applicationId) continue;

      await Billing.updateOne(
        { _id: bill._id },
        { $set: { suspensionNotified: true } },
      );

      await Application.updateOne(
        { applicationId: bill.applicationId },
        { $set: { status: "suspended" } },
      );

      suspendedCount++;
      console.log(
        `🚫 Suspended application ${bill.applicationId} for non-payment of monthly bill`,
      );
    }

    clearAllCache();
    if (res) {
      res.status(200).json({
        success: true,
        message: `Suspended ${suspendedCount} customers`,
      });
    }
  } catch (error) {
    console.error("Auto-suspend overdue error:", error);
    if (res) {
      res
        .status(500)
        .json({ success: false, message: "Failed to suspend customers" });
    }
  }
};

// ==================== GET APPLICATION CURRENT BILLING ====================
export const getApplicationCurrentBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;

    if (!applicationId) {
      return res
        .status(400)
        .json({ success: false, message: "applicationId is required" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: applicationId,
      status: { $in: ["active", "pending_activation", "paused"] },
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      return res.status(200).json({ success: true, data: null });
    }

    const currentMonthlyBill = await Billing.findOne({
      applicationId: applicationId,
      billingCycleId: billingCycle._id,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
      isInstallationBill: false,
    })
      .sort({ dueDate: 1 })
      .lean();

    const pendingInstallationBill = await Billing.findOne({
      applicationId: applicationId,
      billingCycleId: billingCycle._id,
      isInstallationBill: true,
      installationFeePaid: false,
      status: { $in: ["sent", "overdue"] },
    }).lean();

    const needsFirstPayment = billingCycle.proRatedPaid === false;

    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentMonthlyBill,
        pendingInstallationBill,
        needsFirstPayment,
        isAfterCutoff: billingCycle.isAfterCutoff || false,
        hasUnpaidInstallation: pendingInstallationBill !== null,
      },
    });
  } catch (error) {
    console.error("Error in getApplicationCurrentBilling:", error);
    next(error);
  }
};

// ==================== GET APPLICATION BILLING HISTORY ====================
export const getApplicationBillingHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;
    const { limit = 50, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [bills, total] = await Promise.all([
      Billing.find({ applicationId, status: "paid", isInstallationBill: false })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("billingCycleId")
        .lean(),
      Billing.countDocuments({
        applicationId,
        status: "paid",
        isInstallationBill: false,
      }),
    ]);

    const installationBills = await Billing.find({
      applicationId,
      isInstallationBill: true,
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        billingHistory: bills,
        installationBills: installationBills,
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

    const bill = await Billing.findOne({
      _id: billId,
      isInstallationBill: false,
    });
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
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "pending",
          referenceNumber: referenceNumber || `PAY-${Date.now()}`,
          billingId: bill._id,
          applicationId: bill.applicationId,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
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

// ==================== SUBMIT INSTALLATION PAYMENT ====================
export const submitInstallationPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId, referenceNumber, notes } = req.body;

    const bill = await Billing.findOne({
      _id: billId,
      isInstallationBill: true,
    });
    if (!bill)
      return res
        .status(404)
        .json({ success: false, message: "Installation bill not found" });
    if (bill.installationFeePaid)
      return res
        .status(400)
        .json({ success: false, message: "Installation fee already paid" });

    await Billing.updateOne(
      { _id: bill._id },
      { $set: { status: "pending_confirmation" } },
      { session },
    );

    const payment = await Payment.create(
      [
        {
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "installation",
          status: "pending",
          referenceNumber: referenceNumber || `INST-PAY-${Date.now()}`,
          billingId: bill._id,
          applicationId: bill.applicationId,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              submittedAt: new Date(),
              notes: notes || "Installation fee payment submitted",
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
      message:
        "Installation fee payment submitted! Awaiting admin confirmation.",
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
      applicationId: application.applicationId,
    })
      .populate("planId")
      .lean();

    const monthlyBills = await Billing.find({
      applicationId: application.applicationId,
      isInstallationBill: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    const installationBills = await Billing.find({
      applicationId: application.applicationId,
      isInstallationBill: true,
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        application,
        billingCycle,
        monthlyBills,
        installationBills,
        hasBillingStarted: !!billingCycle,
        hasUnpaidInstallation: installationBills.some(
          (b) => !b.installationFeePaid,
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== RECOVER MISSING BILLS ====================
export const recoverMissingBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { applicationId, startFromDate } = req.body;

    if (!applicationId) {
      return res
        .status(400)
        .json({ success: false, message: "applicationId is required" });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: applicationId,
      status: "active",
    }).populate("planId");

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found for this application",
      });
    }

    const application = await Application.findOne({ applicationId }).lean();
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const plan = billingCycle.planId as any;
    const monthlyRate = plan.price;

    let startDate: Date;
    if (startFromDate) {
      startDate = new Date(startFromDate);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
    } else {
      const lastPaidBill = await Billing.findOne({
        applicationId: applicationId,
        status: "paid",
        isProRated: false,
        isInstallationBill: false,
      }).sort({ "billingPeriod.end": -1 });

      if (lastPaidBill) {
        startDate = new Date(lastPaidBill.billingPeriod.end);
        startDate.setDate(1);
        startDate.setMonth(startDate.getMonth() + 1);
      } else {
        startDate = new Date(billingCycle.billingStartDate);
        startDate.setDate(1);
      }
    }

    const currentDate = new Date();
    const settings = await getOrCreateSettings();
    const missingBills = [];
    let currentBillDate = new Date(startDate);

    while (currentBillDate < currentDate) {
      const billingStart = new Date(currentBillDate);
      billingStart.setDate(1);
      billingStart.setHours(0, 0, 0, 0);

      const billingEnd = getEndOfMonth(billingStart);

      const existingBill = await Billing.findOne({
        applicationId: applicationId,
        billingCycleId: billingCycle._id,
        "billingPeriod.start": billingStart,
        isInstallationBill: false,
      });

      if (!existingBill) {
        const monthlyBill = await createMonthlyBill(
          application,
          billingCycle._id,
          billingStart,
          billingEnd,
          monthlyRate,
          settings,
          false,
          0,
          0,
        );
        missingBills.push(monthlyBill);
        console.log(
          `📧 Sent invoice for ${billingStart.toLocaleDateString()} to ${application.email}`,
        );
      }

      currentBillDate.setMonth(currentBillDate.getMonth() + 1);
    }

    const nextBilling = new Date(currentDate);
    nextBilling.setDate(1);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      { $set: { nextBillingDate: nextBilling } },
    );

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Recovered ${missingBills.length} missing monthly bill(s) for ${application.firstName} ${application.lastName}`,
      data: {
        recoveredBills: missingBills,
        applicationName: `${application.firstName} ${application.lastName}`,
        applicationId: applicationId,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET UNPAID BILLS REPORT ====================
export const getUnpaidBillsReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { applicationId, includePaid } = req.query;
    let query: any = {};

    if (applicationId) {
      query.applicationId = applicationId;
    }

    if (includePaid !== "true") {
      query.status = { $in: ["sent", "overdue", "pending_confirmation"] };
    }

    const unpaidMonthlyBills = await Billing.find({
      ...query,
      isInstallationBill: false,
    })
      .sort({ dueDate: 1 })
      .lean();
    const unpaidInstallationBills = await Billing.find({
      ...query,
      isInstallationBill: true,
      installationFeePaid: false,
    })
      .sort({ dueDate: 1 })
      .lean();

    const allUnpaidBills = [...unpaidMonthlyBills, ...unpaidInstallationBills];

    const enrichedBills = await Promise.all(
      allUnpaidBills.map(async (bill) => {
        const b = { ...bill };
        if (b.applicationId) {
          const application = await Application.findOne({
            applicationId: b.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            (b as any).applicationData = application;
          }
        }
        return b;
      }),
    );

    const summary = {
      totalUnpaidBills: enrichedBills.length,
      totalAmountDue: enrichedBills.reduce((sum, bill) => sum + bill.total, 0),
      totalInstallationFeesDue: enrichedBills
        .filter((bill) => bill.isInstallationBill && !bill.installationFeePaid)
        .reduce((sum, bill) => sum + (bill.installationFee || 0), 0),
      totalMonthlyBillsDue: enrichedBills
        .filter((bill) => !bill.isInstallationBill)
        .reduce((sum, bill) => sum + bill.total, 0),
      byStatus: {
        sent: enrichedBills.filter((b) => b.status === "sent").length,
        overdue: enrichedBills.filter((b) => b.status === "overdue").length,
        pending_confirmation: enrichedBills.filter(
          (b) => b.status === "pending_confirmation",
        ).length,
      },
      byType: {
        monthly: unpaidMonthlyBills.length,
        installation: unpaidInstallationBills.length,
      },
      byMonth: {} as any,
    };

    enrichedBills.forEach((bill) => {
      const monthKey = formatDateForDisplay(new Date(bill.billingPeriod.start));
      if (!summary.byMonth[monthKey]) {
        summary.byMonth[monthKey] = {
          count: 0,
          amount: 0,
          installationFees: 0,
          monthlyBills: 0,
          bills: [],
        };
      }
      summary.byMonth[monthKey].count++;
      summary.byMonth[monthKey].amount += bill.total;
      if (bill.isInstallationBill && !bill.installationFeePaid) {
        summary.byMonth[monthKey].installationFees += bill.installationFee;
      } else if (!bill.isInstallationBill) {
        summary.byMonth[monthKey].monthlyBills += bill.total;
      }
      summary.byMonth[monthKey].bills.push({
        invoiceNumber: bill.invoiceNumber,
        amount: bill.total,
        status: bill.status,
        dueDate: bill.dueDate,
        isInstallationBill: bill.isInstallationBill,
      });
    });

    res.status(200).json({
      success: true,
      data: {
        bills: enrichedBills,
        summary,
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
  markInstallationBillAsPaid,
  getPendingProRatedBills,
  getPendingInstallationBills,
  getPendingActivations,
  confirmProRatedPayment,
  startMonthlyBilling,
  autoGenerateMonthlyBills,
  autoSendReminders,
  autoSuspendOverdue,
  getApplicationCurrentBilling,
  getApplicationBillingHistory,
  submitProRatedPayment,
  submitInstallationPayment,
  submitMonthlyPayment,
  getApplicationBillingStatus,
  recoverMissingBills,
  initializeBackdatedBilling,
  getUnpaidBillsReport,
};
