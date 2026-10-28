// backend/src/controllers/billingController.ts - COMPLETE FIXED VERSION
// ✅ FIX: All billing dates stored as UTC midnight so frontend displays the EXACT day
// ✅ FIX: Backdated bills start on the EXACT day chosen (e.g. 27)
// ✅ FIX: Monthly bills always show first-of-month → last-of-month (e.g. 11/1 - 11/30)
// ✅ FIX: Pro-rated day count uses date-only arithmetic (no off-by-one)
// ✅ FIX: Added getUserCurrentBilling and getUserBillingHistory for user dashboard
import { Request, Response, NextFunction } from "express";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import BillingSettings from "../models/BillingSettings";
import User from "../models/User";
import Plan from "../models/Plan";
import Payment from "../models/Payment";
import Application from "../models/Application";
import Invoice from "../models/Invoice";
import Building from "../models/Building";
import Admin from "../models/Admin";
import emailService, {
  getCollectionEmailByLocation,
  getLocationFromEntity,
} from "../services/emailService";
import mongoose from "mongoose";
import { generateInvoicePDF } from "../services/pdfService";
import fs from "fs";
import path from "path";
import eventService from "../services/eventService";

type AuthRequest = Request & { user?: any };

// ==================== HELPER: Get requesting admin's ID ====================
function getRequestingAdminId(req?: AuthRequest): string | undefined {
  if (!req || !req.user) return undefined;
  const id = req.user._id || req.user.id;
  return id ? String(id) : undefined;
}

// ==================== RETRY HELPER ====================
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 100,
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (
        error.code === 112 ||
        error.codeName === "WriteConflict" ||
        (error.message && error.message.includes("Write conflict")) ||
        (error.message && error.message.includes("yielding is disabled"))
      ) {
        if (attempt < maxRetries) {
          console.log(
            `⚠️ Write conflict detected, retrying... (${attempt}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
          continue;
        }
      }
      throw error;
    }
  }
  throw lastError;
}

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
      earlyBillGenerationDays: 15,
    };
    settings = await BillingSettings.create(defaultSettings);
    console.log("✅ Default billing settings created");
  }
  return settings;
}

async function getBuildingForApplication(application: any): Promise<any> {
  try {
    if (!application) return null;
    if (application.buildingId) {
      return await Building.findById(application.buildingId).lean();
    }
    return null;
  } catch (error) {
    console.error("Error getting building for application:", error);
    return null;
  }
}

// ==================== TIMEZONE-SAFE DATE HELPERS ====================
// STRATEGY: All internal Date objects represent a "calendar date" using
// LOCAL Y/M/D but we STORE them in MongoDB as UTC midnight of that same
// calendar date. This ensures:
//   - mongo stores "2026-11-01T00:00:00.000Z" for Nov 1
//   - frontend splitting on "T" yields "2026-11-01"
//   - display shows 11/1/2026 (correct!)
//   - no midnight-shift bug in any timezone

// Parse any input (Date or string) → returns {y, m, d} LOCAL calendar numbers.
function extractYMD(input: Date | string): { y: number; m: number; d: number } {
  if (input instanceof Date) {
    return {
      y: input.getFullYear(),
      m: input.getMonth(),
      d: input.getDate(),
    };
  }
  const str = String(input).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      y: parseInt(match[1], 10),
      m: parseInt(match[2], 10) - 1,
      d: parseInt(match[3], 10),
    };
  }
  const dt = new Date(str);
  if (isNaN(dt.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }
  return {
    y: dt.getFullYear(),
    m: dt.getMonth(),
    d: dt.getDate(),
  };
}

// Internal "calendar Date" — represents a calendar day using LOCAL midnight.
// Only used for arithmetic; NEVER stored directly.
function parseDateToLocalMidnight(input: Date | string): Date {
  const { y, m, d } = extractYMD(input);
  return new Date(y, m, d, 0, 0, 0, 0);
}

// ✅ FIX: Convert a LOCAL midnight Date → UTC midnight Date of the same
// calendar day. This is the value we STORE in MongoDB.
function toStorageDate(localDate: Date): Date {
  const y = localDate.getFullYear();
  const m = localDate.getMonth();
  const d = localDate.getDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

// ✅ FIX: Convert a STORED UTC midnight Date → LOCAL midnight Date of the
// same calendar day. This is what we use for internal math.
function fromStorageDate(storedDate: Date): Date {
  const y = storedDate.getUTCFullYear();
  const m = storedDate.getUTCMonth();
  const d = storedDate.getUTCDate();
  return new Date(y, m, d, 0, 0, 0, 0);
}

// Combine: LOCAL calendar date → store-ready UTC midnight.
function storeLocalMidnight(localDate: Date): Date {
  return toStorageDate(localDate);
}

function getEndOfMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

// LOCAL start of next month as an internal calendar date (LOCAL midnight).
function getStartOfNextMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month + 1, 1, 0, 0, 0, 0);
}

// LOCAL first day of month as internal calendar date.
function getFirstDayOfMonth(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  return new Date(year, month, 1, 0, 0, 0, 0);
}

function formatDateForDisplay(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Normalize an internal calendar date → LOCAL midnight of 1st of same month.
function normalizeToMonthStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

// ✅ FIX: Inclusive day count using LOCAL calendar Y/M/D only.
function daysInclusiveLocal(start: Date, end: Date): number {
  const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

// ✅ FIX: Use a range on the stored UTC-midnight dates for monthly lookup.
async function monthlyBillExistsForMonth(
  billingCycleId: mongoose.Types.ObjectId,
  monthStartLocal: Date,
  session?: mongoose.ClientSession,
): Promise<boolean> {
  // The "month" we're checking against, in UTC-midnight storage space.
  const { y, m } = extractYMD(monthStartLocal);
  const monthStartStorage = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const monthEndStorage = new Date(Date.UTC(y, m + 1, 0, 0, 0, 0, 0));

  const query = Billing.findOne({
    billingCycleId: billingCycleId,
    isProRated: false,
    isInstallationBill: false,
    "billingPeriod.start": {
      $gte: monthStartStorage,
      $lte: monthEndStorage,
    },
  });

  if (session) {
    query.session(session);
  }

  const existing = await query.lean();
  return !!existing;
}

// Due date computed on LOCAL calendar, returned as UTC-midnight storage date.
function getDueDateForMonthly(billingPeriodStart: Date, settings: any): Date {
  const dueDay = settings.monthlyDueDay || 5;
  const year = billingPeriodStart.getFullYear();
  const month = billingPeriodStart.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const targetDay = Math.min(dueDay, lastDayOfMonth);
  // Return STORAGE date (UTC midnight of that calendar day)
  return new Date(Date.UTC(year, month, targetDay, 0, 0, 0, 0));
}

function getDueDateForProRatedBeforeCutoff(
  installationDate: Date,
  settings: any,
): Date {
  const dueDay = settings.proRatedDueDay || 25;
  const year = installationDate.getFullYear();
  const month = installationDate.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const targetDay = Math.min(dueDay, lastDayOfMonth);
  return new Date(Date.UTC(year, month, targetDay, 0, 0, 0, 0));
}

function getDueDateForInstallationFee(
  installationDate: Date,
  settings: any,
): Date {
  const dueDays = settings.installationFeeDueDays || 7;
  const dueLocal = new Date(installationDate);
  dueLocal.setDate(dueLocal.getDate() + dueDays);
  return toStorageDate(dueLocal);
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

// ==================== PER-ADMIN EMAIL ALERTS CHECK ====================
async function areCustomerEmailAlertsEnabled(
  adminId?: string,
): Promise<boolean> {
  if (!adminId) {
    console.log(
      `📧 [billing] No adminId provided for customer email check → BLOCKING`,
    );
    return false;
  }
  try {
    const admin = await Admin.findById(adminId)
      .select("email customerEmailAlertsEnabled")
      .lean();
    if (!admin) return false;
    return admin.customerEmailAlertsEnabled === true;
  } catch (error) {
    console.error("📧 [billing] Error checking email alerts:", error);
    return false;
  }
}

// ==================== SEND INVOICE ====================
async function sendInvoiceToApplication(
  application: any,
  bill: any,
  req?: AuthRequest,
): Promise<void> {
  if (!application || !application.email) return;

  const adminId = getRequestingAdminId(req);
  const emailAlertsEnabled = await areCustomerEmailAlertsEnabled(adminId);
  if (!emailAlertsEnabled) {
    console.log(
      `📧 Email alerts disabled. Skipping invoice email to ${application.email}`,
    );
    return;
  }

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

  const location = await getLocationFromEntity(application);
  await emailService.sendInvoice(
    tempUser,
    bill,
    location,
    false,
    undefined,
    adminId,
  );
}

// ==================== SEND PAID/FREE INVOICE EMAIL ====================
async function sendPaidOrFreeInvoiceEmail(
  bill: any,
  application: any,
  payment: any,
  options?: { isFree?: boolean; adminId?: string },
): Promise<boolean> {
  try {
    if (!application || !application.email) return false;

    const location = await getLocationFromEntity(application);
    const free = options?.isFree === true;
    const adminId = options?.adminId;
    const label = free ? "FREE receipt" : "paid receipt";

    const emailAlertsEnabled = await areCustomerEmailAlertsEnabled(adminId);
    if (!emailAlertsEnabled) {
      console.log(
        `⏭️ [billing] ${label} email SKIPPED for ${application.email} — toggle OFF`,
      );
      return true;
    }

    let invoiceDoc: any = null;
    try {
      invoiceDoc = await Invoice.findOne({ billingId: bill._id }).lean();
    } catch (err) {
      console.error("Error finding invoice for paid/free email:", err);
    }

    const invoiceData: any = invoiceDoc
      ? {
          ...invoiceDoc,
          buildingName: application.buildingName || "",
          isFree: free,
          status: free ? "free" : invoiceDoc.status,
          paymentMethod: free ? "free" : invoiceDoc.paymentMethod,
        }
      : {
          _id: bill._id,
          invoiceNumber: bill.invoiceNumber,
          customerName:
            `${application.firstName || ""} ${application.lastName || ""}`.trim() ||
            application.email,
          customerEmail: application.email,
          customerAddress: application.buildingName || "N/A",
          total: bill.total,
          subtotal: bill.subtotal,
          discountAmount: bill.discount || 0,
          taxAmount: bill.tax || 0,
          taxRate: 0,
          items: bill.items || [],
          invoiceType: bill.isInstallationBill
            ? "installation"
            : bill.isProRated
              ? "pro-rated"
              : "monthly",
          isInstallationFee: !!bill.isInstallationBill,
          isProRated: !!bill.isProRated,
          dueDate: bill.dueDate,
          paidAt: bill.paidAt || new Date(),
          referenceNumber: payment?.referenceNumber,
          location,
          notes: bill.notes,
          billingPeriod: bill.billingPeriod,
          issuedDate: bill.createdAt || new Date(),
          proRatedDays: bill.proRatedDays || 0,
          planName: "",
          buildingName: application.buildingName || "",
          applicationId: bill.applicationId,
          isFree: free,
          status: free ? "free" : "paid",
          paymentMethod: free ? "free" : "manual",
        };

    if (free) {
      invoiceData.total = 0;
      invoiceData.subtotal = 0;
      invoiceData.discountAmount = 0;
      invoiceData.taxAmount = 0;
      if (Array.isArray(invoiceData.items)) {
        invoiceData.items = invoiceData.items.map((item: any) => ({
          ...item,
          rate: 0,
          amount: 0,
        }));
      }
    }

    const pdfFileName = `${invoiceData.invoiceNumber}.pdf`;
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateInvoicePDF(invoiceData);
    } catch (pdfError) {
      console.error(
        `❌ Could not generate PDF for ${invoiceData.invoiceNumber}:`,
        pdfError,
      );
      pdfBuffer = Buffer.alloc(0);
    }

    if (pdfBuffer && pdfBuffer.length > 0) {
      try {
        const pdfDir = path.join(__dirname, "../../uploads/invoices");
        if (!fs.existsSync(pdfDir)) {
          fs.mkdirSync(pdfDir, { recursive: true });
        }
        fs.writeFileSync(path.join(pdfDir, pdfFileName), pdfBuffer);
        if (invoiceDoc?._id) {
          await Invoice.findByIdAndUpdate(invoiceDoc._id, {
            pdfUrl: `/uploads/invoices/${pdfFileName}`,
            pdfGeneratedAt: new Date(),
            status: "paid",
            paidAt: invoiceData.paidAt,
          });
        }
      } catch (saveError) {
        console.error("Failed to save paid PDF:", saveError);
      }
    }

    const emailSent = await emailService.sendPaidInvoiceEmail(
      invoiceData,
      pdfBuffer,
      pdfFileName,
      payment,
      location,
      false,
      undefined,
      false,
      free,
      adminId,
    );

    if (emailSent) {
      console.log(
        `✅ ${label} email sent to ${application.email} (${invoiceData.invoiceNumber})`,
      );
    }
    return emailSent;
  } catch (error) {
    console.error("❌ Error sending paid/free invoice email:", error);
    return false;
  }
}

async function createInvoiceFromBilling(
  billing: any,
  application: any,
  settings: any,
): Promise<any> {
  try {
    const existingInvoice = await Invoice.findOne({
      billingId: billing._id,
    }).lean();
    if (existingInvoice) return existingInvoice;

    const plan = await Plan.findById(application.planId).lean();

    const items = [];
    let subtotal = 0;
    let isInstallationFee = false;
    let isProRated = false;
    let proRatedDays = 0;

    if (billing.items && billing.items.length > 0) {
      for (const item of billing.items) {
        items.push({
          description: item.description,
          quantity: item.quantity || 1,
          rate: item.rate,
          amount: item.amount,
          type: item.type || "subscription",
        });
        subtotal += item.amount;
      }
    }

    isInstallationFee = billing.isInstallationBill || false;
    isProRated = billing.isProRated || false;
    proRatedDays = billing.proRatedDays || 0;

    if (items.length === 0) {
      if (billing.isProRated && billing.proRatedDays) {
        const dailyRate = ((plan?.price || 0) * 12) / 365;
        const proRatedAmount =
          Math.round(dailyRate * billing.proRatedDays * 100) / 100;
        items.push({
          description: `Pro-rated (${formatDateForDisplay(fromStorageDate(billing.billingPeriod.start))} - ${formatDateForDisplay(fromStorageDate(billing.billingPeriod.end))})`,
          quantity: billing.proRatedDays,
          rate: dailyRate,
          amount: proRatedAmount,
          type: "pro-rated",
        });
        subtotal += proRatedAmount;
        isProRated = true;
        proRatedDays = billing.proRatedDays;
      }

      if (billing.installationFee && billing.installationFee > 0) {
        items.push({
          description: `Installation Fee (One-time) - Building: ${application.buildingName || "N/A"}`,
          quantity: 1,
          rate: billing.installationFee,
          amount: billing.installationFee,
          type: "installation",
        });
        subtotal += billing.installationFee;
        isInstallationFee = true;
      }

      if (!billing.isProRated || billing.isProRated === false) {
        const monthlyRate = plan?.price || 0;
        if (monthlyRate > 0) {
          items.push({
            description: `Monthly Subscription - ${formatDateForDisplay(fromStorageDate(billing.billingPeriod.start))} to ${formatDateForDisplay(fromStorageDate(billing.billingPeriod.end))}`,
            quantity: 1,
            rate: monthlyRate,
            amount: monthlyRate,
            type: "subscription",
          });
          subtotal += monthlyRate;
        }
      }
    }

    let invoiceType = "monthly";
    if (isInstallationFee && isProRated) invoiceType = "combined";
    else if (isInstallationFee) invoiceType = "installation";
    else if (isProRated) invoiceType = "pro-rated";

    const customerAddress = application.buildingName
      ? `${application.buildingName}, ${application.buildingId?.streetAddress || ""}`
      : application.address || "N/A";

    const location = await getLocationFromEntity(application);
    const collectionEmail = getCollectionEmailByLocation(location);

    const invoiceData = {
      invoiceNumber: generateInvoiceNumber(),
      invoiceType,
      applicationId: application.applicationId,

      customerName:
        `${application.firstName || ""} ${application.lastName || ""}`.trim() ||
        application.email,
      customerAddress,
      customerEmail: application.email,
      customerPhone: application.phoneNumber || "",

      companyName: "Fyberblizz Network Corporation",
      companyAddress:
        "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
      companyVat: "697-461-165-00000",
      companyContact: "0969-341-4876",
      companyEmail: collectionEmail,

      billingPeriod: {
        start: billing.billingPeriod?.start || new Date(),
        end: billing.billingPeriod?.end || new Date(),
      },
      dueDate: billing.dueDate || new Date(),
      issuedDate: new Date(),

      items,
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: subtotal,

      bankName: "BDO",
      accountName: "FYBERBLIZZ NETWORK CORPORATION",
      accountNumber: "013448002421",

      status: "draft",

      billingId: billing._id,
      billingCycleId: billing.billingCycleId,

      isInstallationFee,
      isProRated,
      proRatedDays,
      planName: plan?.name || "N/A",

      notes: billing.notes || "",
      termsAndConditions:
        "Please be advised that failure to settle your account on or before the due date may result in temporary service interruption.",
      location,
      collectionEmail,
    };

    const invoice = await Invoice.create(invoiceData);
    console.log(`✅ Invoice created: ${invoice.invoiceNumber}`);
    return invoice;
  } catch (error) {
    console.error("Error creating invoice from billing:", error);
    return null;
  }
}

async function sendInvoiceWithPDFAttachment(
  invoice: any,
  application: any,
  req?: AuthRequest,
): Promise<boolean> {
  try {
    const adminId = getRequestingAdminId(req);
    const emailAlertsEnabled = await areCustomerEmailAlertsEnabled(adminId);
    if (!emailAlertsEnabled) {
      console.log(
        `📧 Email alerts disabled. Skipping PDF invoice email to ${application.email}`,
      );
      return false;
    }

    const location = await getLocationFromEntity(application);
    const pdfBuffer = await generateInvoicePDF(invoice);

    const pdfDir = path.join(__dirname, "../../uploads/invoices");
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const pdfFileName = `${invoice.invoiceNumber}.pdf`;
    fs.writeFileSync(path.join(pdfDir, pdfFileName), pdfBuffer);

    const pdfUrl = `/uploads/invoices/${pdfFileName}`;
    await Invoice.findByIdAndUpdate(invoice._id, {
      pdfUrl,
      pdfGeneratedAt: new Date(),
      status: "sent",
    });

    invoice.location = location;
    invoice.collectionEmail = getCollectionEmailByLocation(location);

    return await emailService.sendInvoiceWithPDF(
      invoice,
      pdfBuffer,
      pdfFileName,
      location,
      false,
      undefined,
      adminId,
    );
  } catch (error) {
    console.error("Error sending invoice with PDF:", error);
    return false;
  }
}

async function createInstallationBill(
  application: any,
  billingCycleId: mongoose.Types.ObjectId,
  installationFee: number,
  settings: any,
  session: mongoose.ClientSession,
  req?: AuthRequest,
): Promise<any> {
  if (!installationFee || installationFee <= 0) return null;

  const todayLocal = new Date();
  todayLocal.setHours(0, 0, 0, 0);
  const todayStorage = toStorageDate(todayLocal);
  const dueDateStorage = getDueDateForInstallationFee(todayLocal, settings);

  const building = await getBuildingForApplication(application);
  const buildingName = building
    ? building.buildingName
    : application.buildingName || "N/A";

  const installationBillData = {
    billingCycleId,
    invoiceNumber: generateInstallationInvoiceNumber(),
    billingPeriod: { start: todayStorage, end: todayStorage },
    dueDate: dueDateStorage,
    items: [
      {
        description: `Installation Fee (One-time) - Building: ${buildingName} - Due within ${settings.installationFeeDueDays || 7} days`,
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
    installationFee,
    installationFeePaid: false,
    notes: `Installation fee bill - Building: ${buildingName} - Separate from monthly subscription. Due on ${formatDateForDisplay(fromStorageDate(dueDateStorage))}`,
    applicationId: application.applicationId,
  };

  const installationBill = await Billing.create([installationBillData], {
    session,
  });

  await BillingCycle.updateOne(
    { _id: billingCycleId },
    { $set: { installationFeeBillId: installationBill[0]._id } },
    { session },
  );

  const invoice = await createInvoiceFromBilling(
    installationBill[0],
    application,
    settings,
  );

  if (invoice) {
    await sendInvoiceWithPDFAttachment(invoice, application, req);
  } else {
    try {
      await sendInvoiceToApplication(application, installationBill[0], req);
    } catch (emailError) {
      console.error("Failed to send installation invoice email:", emailError);
    }
  }

  return installationBill[0];
}

async function createMonthlyBill(
  application: any,
  billingCycleId: mongoose.Types.ObjectId,
  billingStartLocal: Date,
  billingEndLocal: Date,
  monthlyRate: number,
  settings: any,
  session?: mongoose.ClientSession,
  req?: AuthRequest,
): Promise<any> {
  // ✅ FIX: Always normalize to the FIRST day of the month, both start and end.
  // This guarantees the bill shows "11/1 - 11/30" never "10/31 - 11/30".
  const monthStartLocal = normalizeToMonthStart(billingStartLocal);
  const monthEndLocal = getEndOfMonth(monthStartLocal);

  const alreadyExists = await monthlyBillExistsForMonth(
    billingCycleId,
    monthStartLocal,
    session,
  );

  if (alreadyExists) {
    console.log(
      `⏭️ [createMonthlyBill] Skipping duplicate for ${getMonthKey(monthStartLocal)}`,
    );
    const { y, m } = extractYMD(monthStartLocal);
    const existingQuery = Billing.findOne({
      billingCycleId,
      isProRated: false,
      isInstallationBill: false,
      "billingPeriod.start": {
        $gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        $lte: new Date(Date.UTC(y, m + 1, 0, 0, 0, 0, 0)),
      },
    });
    if (session) existingQuery.session(session);
    return await existingQuery.lean();
  }

  // ✅ FIX: Convert LOCAL month boundaries → UTC-midnight STORAGE dates.
  const startStorage = storeLocalMidnight(monthStartLocal);
  const endStorage = storeLocalMidnight(monthEndLocal);
  const dueDateStorage = getDueDateForMonthly(monthStartLocal, settings);

  const billData: any = {
    billingCycleId,
    invoiceNumber: generateInvoiceNumber(),
    billingPeriod: { start: startStorage, end: endStorage },
    dueDate: dueDateStorage,
    items: [
      {
        description: `Monthly Subscription - ${formatDateForDisplay(monthStartLocal)} to ${formatDateForDisplay(monthEndLocal)} (PREPAID) - Generated on ${formatDateForDisplay(new Date())}`,
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
    isInstallationBill: false,
    installationFee: 0,
    installationFeePaid: false,
    notes: `Monthly subscription - PREPAID: Generated on 1st of month, Due on 5th of ${formatDateForDisplay(monthStartLocal)}`,
    applicationId: application.applicationId,
  };

  let createdBill: any;
  if (session) {
    const bill = await Billing.create([billData], { session });
    createdBill = bill[0];
  } else {
    createdBill = await Billing.create([billData]);
  }

  const invoice = await createInvoiceFromBilling(
    createdBill,
    application,
    settings,
  );

  if (invoice) {
    await sendInvoiceWithPDFAttachment(invoice, application, req);
  } else {
    try {
      await sendInvoiceToApplication(application, createdBill, req);
    } catch (emailError) {
      console.error("Failed to send invoice email:", emailError);
    }
  }

  return createdBill;
}

async function createProRatedBill(
  application: any,
  billingCycleId: mongoose.Types.ObjectId,
  installationDateLocal: Date,
  billingEndLocal: Date,
  proRatedAmount: number,
  proRatedDays: number,
  dailyRate: number,
  settings: any,
  isAfterCutoff: boolean,
  session?: mongoose.ClientSession,
  req?: AuthRequest,
): Promise<any> {
  // ✅ FIX: Normalize local calendar dates.
  const startLocal = parseDateToLocalMidnight(installationDateLocal);
  const endLocal = parseDateToLocalMidnight(billingEndLocal);

  // ✅ FIX: Store as UTC midnight so frontend displays the EXACT calendar day.
  const startStorage = storeLocalMidnight(startLocal);
  const endStorage = storeLocalMidnight(endLocal);

  let dueDateStorage: Date;
  let description: string;

  if (isAfterCutoff) {
    const nextMonthStart = getStartOfNextMonth(startLocal);
    dueDateStorage = getDueDateForMonthly(nextMonthStart, settings);
    description = `Pro-rated payment from ${formatDateForDisplay(startLocal)} to ${formatDateForDisplay(endLocal)} (${proRatedDays} days) - Due on 5th of next month`;
  } else {
    dueDateStorage = getDueDateForProRatedBeforeCutoff(startLocal, settings);
    description = `Pro-rated payment from ${formatDateForDisplay(startLocal)} to ${formatDateForDisplay(endLocal)} (${proRatedDays} days) - Due on 25th of current month`;
  }

  const items: any[] = [
    {
      description,
      quantity: proRatedDays,
      rate: dailyRate,
      amount: proRatedAmount,
    },
  ];

  const billData: any = {
    billingCycleId,
    invoiceNumber: generateInvoiceNumber(),
    billingPeriod: { start: startStorage, end: endStorage },
    dueDate: dueDateStorage,
    items,
    subtotal: proRatedAmount,
    tax: 0,
    discount: 0,
    total: proRatedAmount,
    status: "sent",
    isProRated: true,
    proRatedDays,
    isInstallationBill: false,
    installationFee: 0,
    installationFeePaid: false,
    notes: isAfterCutoff
      ? `Pro-rated bill for installation on ${formatDateForDisplay(startLocal)} - Due on 5th of next month`
      : `Pro-rated bill - Due on 25th of current month. Next billing starts on 1st of next month.`,
    applicationId: application.applicationId,
  };

  let createdBill: any;
  if (session) {
    const bill = await Billing.create([billData], { session });
    createdBill = bill[0];
  } else {
    createdBill = await Billing.create([billData]);
  }

  const invoice = await createInvoiceFromBilling(
    createdBill,
    application,
    settings,
  );

  if (invoice) {
    await sendInvoiceWithPDFAttachment(invoice, application, req);
  } else {
    try {
      await sendInvoiceToApplication(application, createdBill, req);
    } catch (emailError) {
      console.error("Failed to send invoice email:", emailError);
    }
  }

  return createdBill;
}

// ============================================================
// EXPORTED FUNCTIONS
// ============================================================

export const getBillingSettings = async (
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
        installationFee: 1500,
        installationFeeDueDays: 7,
        earlyBillGenerationDays: 15,
      });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

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
    eventService.emitSettingsUpdated({
      settings,
      updatedBy: req.user?._id,
    });
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

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
        earlyBillGenerationDays: 15,
      });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

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
      earlyBillGenerationDays,
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
        earlyBillGenerationDays: earlyBillGenerationDays || 15,
      },
      { new: true, upsert: true },
    ).lean();

    eventService.emitSettingsUpdated({
      settings,
      updatedBy: req.user?._id,
    });

    res.status(200).json({
      success: true,
      message: "Billing settings updated successfully",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

export const getBillingSummaryAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
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

    const data = {
      activeSubscriptions: totalActiveCycles,
      pausedSubscriptions: totalPausedCycles,
      pendingProRated,
      pendingActivations,
      overdueAccounts: overdueBills,
      totalOutstanding: outstandingResult[0]?.total || 0,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      unpaidProRated,
      unpaidInstallationFees: {
        total: unpaidInstallationFees[0]?.total || 0,
        count: unpaidInstallationFees[0]?.count || 0,
      },
    };
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getAllBillingCycles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const cycles = await BillingCycle.find()
      .populate("planId", "name price")
      .sort({ createdAt: -1 })
      .lean();

    const applicationIds = cycles
      .map((c) => c.applicationId)
      .filter((id) => id);

    const applications =
      applicationIds.length > 0
        ? await Application.find({
            applicationId: { $in: applicationIds },
          })
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean()
        : [];

    const applicationMap = new Map(
      applications.map((a) => [a.applicationId, a]),
    );
    const enriched = cycles.map((c) => ({
      ...c,
      applicationData: applicationMap.get(c.applicationId) || null,
    }));
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

export const getAllBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
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

    const applicationIds = bills.map((b) => b.applicationId).filter((id) => id);
    const applications =
      applicationIds.length > 0
        ? await Application.find({
            applicationId: { $in: applicationIds },
          })
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean()
        : [];
    const map = new Map(applications.map((a) => [a.applicationId, a]));
    const enriched = bills.map((b) => ({
      ...b,
      applicationData: map.get(b.applicationId) || null,
    }));
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

export const getPendingProRatedBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const pending = await Billing.find({
      isProRated: true,
      status: "pending_confirmation",
      isInstallationBill: false,
    })
      .sort({ createdAt: -1 })
      .lean();
    const ids = pending.map((b) => b.applicationId).filter((id) => id);
    const apps =
      ids.length > 0
        ? await Application.find({ applicationId: { $in: ids } })
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean()
        : [];
    const map = new Map(apps.map((a) => [a.applicationId, a]));
    res.status(200).json({
      success: true,
      data: pending.map((b) => ({
        ...b,
        applicationData: map.get(b.applicationId) || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getPendingInstallationBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const pending = await Billing.find({
      isInstallationBill: true,
      installationFeePaid: false,
      status: { $in: ["sent", "overdue"] },
    })
      .sort({ dueDate: 1 })
      .lean();
    const ids = pending.map((b) => b.applicationId).filter((id) => id);
    const apps =
      ids.length > 0
        ? await Application.find({ applicationId: { $in: ids } })
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean()
        : [];
    const map = new Map(apps.map((a) => [a.applicationId, a]));
    res.status(200).json({
      success: true,
      data: pending.map((b) => ({
        ...b,
        applicationData: map.get(b.applicationId) || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getPendingActivations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const pending = await BillingCycle.find({
      status: "pending_activation",
      proRatedPaid: true,
      manualBillStart: false,
    })
      .populate("planId", "name price")
      .sort({ proRatedPaidAt: -1 })
      .lean();
    const ids = pending.map((c) => c.applicationId).filter((id) => id);
    const apps =
      ids.length > 0
        ? await Application.find({ applicationId: { $in: ids } })
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean()
        : [];
    const map = new Map(apps.map((a) => [a.applicationId, a]));
    res.status(200).json({
      success: true,
      data: pending.map((c) => ({
        ...c,
        applicationData: map.get(c.applicationId) || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

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
      applicationId,
      status: { $in: ["active", "pending_activation", "paused"] },
    })
      .populate("planId")
      .lean();
    if (!billingCycle) {
      return res.status(200).json({ success: true, data: null });
    }
    const [currentMonthlyBill, pendingInstallationBill] = await Promise.all([
      Billing.findOne({
        applicationId,
        billingCycleId: billingCycle._id,
        status: { $in: ["sent", "overdue", "pending_confirmation"] },
        isInstallationBill: false,
      })
        .sort({ dueDate: 1 })
        .lean(),
      Billing.findOne({
        applicationId,
        billingCycleId: billingCycle._id,
        isInstallationBill: true,
        installationFeePaid: false,
        status: { $in: ["sent", "overdue"] },
      }).lean(),
    ]);
    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentMonthlyBill,
        pendingInstallationBill,
        needsFirstPayment: billingCycle.proRatedPaid === false,
        isAfterCutoff: billingCycle.isAfterCutoff || false,
        hasUnpaidInstallation: pendingInstallationBill !== null,
        buildingInstallationFee: billingCycle.installationFee || 0,
      },
    });
  } catch (error) {
    console.error("Error in getApplicationCurrentBilling:", error);
    next(error);
  }
};

export const getApplicationBillingHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;
    const { limit = 50, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [bills, total, installationBills] = await Promise.all([
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
      Billing.find({ applicationId, isInstallationBill: true }).lean(),
    ]);
    res.status(200).json({
      success: true,
      data: {
        billingHistory: bills,
        installationBills,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getApplicationBillingStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;
    const application = await Application.findOne({ applicationId })
      .select(
        "firstName lastName email applicationId phoneNumber location buildingName",
      )
      .lean();
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    const [billingCycle, monthlyBills, installationBills] = await Promise.all([
      BillingCycle.findOne({ applicationId: application.applicationId })
        .populate("planId")
        .lean(),
      Billing.find({
        applicationId: application.applicationId,
        isInstallationBill: false,
      })
        .sort({ createdAt: -1 })
        .lean(),
      Billing.find({
        applicationId: application.applicationId,
        isInstallationBill: true,
      }).lean(),
    ]);
    const location = await getLocationFromEntity(application);
    const collectionEmail = getCollectionEmailByLocation(location);
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
        location,
        collectionEmail,
        buildingInstallationFee: billingCycle?.installationFee || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

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
      applicationId,
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
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    const plan = billingCycle.planId as any;
    const monthlyRate = plan.price;

    let startLocal: Date;
    if (startFromDate) {
      startLocal = parseDateToLocalMidnight(startFromDate);
      startLocal = getFirstDayOfMonth(startLocal);
    } else {
      const lastPaid = await Billing.findOne({
        applicationId,
        status: "paid",
        isProRated: false,
        isInstallationBill: false,
      })
        .sort({ "billingPeriod.end": -1 })
        .lean();
      if (lastPaid) {
        startLocal = getFirstDayOfMonth(
          getStartOfNextMonth(fromStorageDate(lastPaid.billingPeriod.end)),
        );
      } else {
        startLocal = getFirstDayOfMonth(
          fromStorageDate(billingCycle.billingStartDate),
        );
      }
    }

    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);
    const settings = await getOrCreateSettings();
    const missingBills = [];
    let currentBillDate = new Date(startLocal);

    while (currentBillDate <= todayLocal) {
      const billingStart = normalizeToMonthStart(currentBillDate);
      const exists = await monthlyBillExistsForMonth(
        billingCycle._id,
        billingStart,
      );
      if (!exists) {
        const monthlyBill = await createMonthlyBill(
          application,
          billingCycle._id,
          billingStart,
          getEndOfMonth(billingStart),
          monthlyRate,
          settings,
          undefined,
          req,
        );
        missingBills.push(monthlyBill);
      }
      currentBillDate.setMonth(currentBillDate.getMonth() + 1);
    }

    const nextBillingLocal = getFirstDayOfMonth(
      getStartOfNextMonth(todayLocal),
    );
    await BillingCycle.updateOne(
      { _id: billingCycle._id },
      { $set: { nextBillingDate: toStorageDate(nextBillingLocal) } },
    );

    if (missingBills.length > 0) {
      for (const bill of missingBills) {
        eventService.emitBillingCreated({
          billing: bill,
          applicationId,
          type: "monthly",
          customerName: `${application.firstName} ${application.lastName}`,
          recovered: true,
        });
      }
      eventService.emitDashboardUpdate({
        reason: "Recovered missing bills - FORCE REFRESH",
        applicationId,
        count: missingBills.length,
        customerName: `${application.firstName} ${application.lastName}`,
        forceRefresh: true,
        timestamp: Date.now(),
      });
    }

    res.status(200).json({
      success: true,
      message: `Recovered ${missingBills.length} missing monthly bill(s)`,
      data: {
        recoveredBills: missingBills,
        applicationName: `${application.firstName} ${application.lastName}`,
        applicationId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const initializeBackdatedBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        applicationId,
        serviceStartDate,
        customPlanName,
        monthlyRate,
        notes,
        includeInstallationFee,
      } = req.body;

      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }
      if (!serviceStartDate) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "serviceStartDate is required" });
      }

      const application = await Application.findOne({ applicationId })
        .populate("planId")
        .lean();
      if (!application) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: `Application not found: ${applicationId}`,
        });
      }

      const existing = await BillingCycle.findOne({
        applicationId: application.applicationId,
      }).session(session);
      if (existing) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Billing already exists. Status: ${existing.status}`,
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
        plan = await require("../models/Plan").default.findById(plan._id);
      }
      if (!plan && !monthlyRate) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Either plan or customPlanName + monthlyRate required",
        });
      }

      const actualMonthlyRate = plan ? plan.price : monthlyRate;
      const settings = await getOrCreateSettings();

      let installationFee = 0;
      if (includeInstallationFee !== false) {
        const building = await getBuildingForApplication(application);
        if (building && building.installationFee > 0) {
          installationFee = building.installationFee;
        } else {
          installationFee = settings.installationFee || 1500;
        }
      }

      // ✅ FIX: Parse the chosen day as LOCAL calendar date, then STORE as UTC midnight.
      const startLocal = parseDateToLocalMidnight(serviceStartDate);
      const startMonthEndLocal = getEndOfMonth(startLocal);
      console.log(
        `📅 Backdated start: ${formatDateForDisplay(startLocal)} → ` +
          `pro-rated ends: ${formatDateForDisplay(startMonthEndLocal)}`,
      );

      const todayLocal = new Date();
      todayLocal.setHours(0, 0, 0, 0);

      const installationDay = startLocal.getDate();
      const billingCutoffDay = settings.billingCutoffDay || 24;
      const isAfterCutoff = installationDay > billingCutoffDay;

      // ✅ FIX: Next full month boundaries as LOCAL calendar dates.
      const nextFullMonthStartLocal = getStartOfNextMonth(startLocal);
      const nextFullMonthEndLocal = getEndOfMonth(nextFullMonthStartLocal);
      const nextBillingDateLocal = getFirstDayOfMonth(nextFullMonthStartLocal);

      const billingCycle = await BillingCycle.create(
        [
          {
            applicationId: application.applicationId,
            planId: plan?._id || null,
            monthlyRate: actualMonthlyRate,
            billingStartDate: toStorageDate(nextFullMonthStartLocal),
            billingEndDate: toStorageDate(nextFullMonthEndLocal),
            nextBillingDate: toStorageDate(nextBillingDateLocal),
            status: "active",
            proRatedPaid: true,
            proRatedPaidAt: new Date(),
            currentProRatedAmount: 0,
            actualBillableDays: 0,
            manualBillStart: true,
            manuallyStartedAt: new Date(),
            installationFee,
            installationFeePaid: installationFee === 0,
          },
        ],
        { session },
      );

      const generatedBills = [];
      const missingMonths = [];
      let totalMonthlyAmount = 0;
      const unpaidMonths = [];

      // ===== FIRST PARTIAL MONTH (PRO-RATED) =====
      let startMonthProRatedDays = 0;
      {
        // ✅ FIX: Inclusive day count using LOCAL Y/M/D (Oct 27 → Oct 31 = 5 days).
        const daysUsed = daysInclusiveLocal(startLocal, startMonthEndLocal);
        startMonthProRatedDays = daysUsed;
        const dailyRate = (actualMonthlyRate * 12) / 365;

        let proRatedAmount: number;
        if (installationDay === 1) {
          proRatedAmount = actualMonthlyRate;
        } else {
          proRatedAmount = Math.round(dailyRate * daysUsed * 100) / 100;
        }

        const dueDateStorage = isAfterCutoff
          ? getDueDateForMonthly(getStartOfNextMonth(startLocal), settings)
          : getDueDateForProRatedBeforeCutoff(startLocal, settings);

        // ✅ FIX: Store billingPeriod as UTC midnight of chosen day.
        const proRatedBillData: any = {
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: {
            start: toStorageDate(startLocal),
            end: toStorageDate(startMonthEndLocal),
          },
          dueDate: dueDateStorage,
          items: [
            {
              description: isAfterCutoff
                ? `Pro-rated payment from ${formatDateForDisplay(startLocal)} to ${formatDateForDisplay(startMonthEndLocal)} (${daysUsed} days) - Due on 5th of next month`
                : `Pro-rated payment from ${formatDateForDisplay(startLocal)} to ${formatDateForDisplay(startMonthEndLocal)} (${daysUsed} days) - Due on 25th of current month`,
              quantity: daysUsed,
              rate: dailyRate,
              amount: proRatedAmount,
            },
          ],
          subtotal: proRatedAmount,
          total: proRatedAmount,
          status: "sent",
          isProRated: true,
          proRatedDays: daysUsed,
          isInstallationBill: false,
          installationFee: 0,
          installationFeePaid: false,
          applicationId: application.applicationId,
          notes:
            notes ||
            `Generated from backdated billing starting ${formatDateForDisplay(startLocal)}.`,
        };

        const newBill = await Billing.create([proRatedBillData], { session });
        generatedBills.push(newBill[0]);
        totalMonthlyAmount += proRatedAmount;

        const invoice = await createInvoiceFromBilling(
          newBill[0],
          application,
          settings,
        );
        if (invoice) {
          await sendInvoiceWithPDFAttachment(invoice, application, req);
        }
      }

      // ===== FULL MONTHS FROM NEXT MONTH =====
      let currentBillLocal = getStartOfNextMonth(startLocal);
      while (currentBillLocal <= todayLocal) {
        const billingStartLocal = normalizeToMonthStart(currentBillLocal);
        const billingEndLocal = getEndOfMonth(billingStartLocal);
        const dueDateStorage = getDueDateForMonthly(
          billingStartLocal,
          settings,
        );

        const exists = await monthlyBillExistsForMonth(
          billingCycle[0]._id,
          billingStartLocal,
          session,
        );

        if (!exists) {
          const isMissingBill = billingEndLocal < todayLocal;

          const billData: any = {
            billingCycleId: billingCycle[0]._id,
            invoiceNumber: generateInvoiceNumber(),
            // ✅ FIX: Store as UTC midnight of 1st and last day of the month.
            billingPeriod: {
              start: toStorageDate(billingStartLocal),
              end: toStorageDate(billingEndLocal),
            },
            dueDate: dueDateStorage,
            items: [
              {
                description: isMissingBill
                  ? `[MISSING BILL - BACKDATED] Monthly Subscription - ${formatDateForDisplay(billingStartLocal)} to ${formatDateForDisplay(billingEndLocal)} (PREPAID)`
                  : `Monthly Subscription - ${formatDateForDisplay(billingStartLocal)} to ${formatDateForDisplay(billingEndLocal)} (PREPAID)`,
                quantity: 1,
                rate: actualMonthlyRate,
                amount: actualMonthlyRate,
              },
            ],
            subtotal: actualMonthlyRate,
            total: actualMonthlyRate,
            status: "sent",
            isProRated: false,
            proRatedDays: 0,
            isInstallationBill: false,
            installationFee: 0,
            installationFeePaid: false,
            applicationId: application.applicationId,
            notes: notes || `Generated from backdated billing.`,
          };

          const newBill = await Billing.create([billData], { session });
          generatedBills.push(newBill[0]);
          totalMonthlyAmount += actualMonthlyRate;

          if (isMissingBill) {
            missingMonths.push({
              month: formatDateForDisplay(billingStartLocal),
              amount: actualMonthlyRate,
              billId: newBill[0]._id,
              invoiceNumber: newBill[0].invoiceNumber,
            });
          }

          const invoice = await createInvoiceFromBilling(
            newBill[0],
            application,
            settings,
          );
          if (invoice) {
            await sendInvoiceWithPDFAttachment(invoice, application, req);
          }
        } else {
          const { y, m } = extractYMD(billingStartLocal);
          const existingUnpaid = await Billing.findOne({
            billingCycleId: billingCycle[0]._id,
            isProRated: false,
            isInstallationBill: false,
            "billingPeriod.start": {
              $gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
              $lte: new Date(Date.UTC(y, m + 1, 0, 0, 0, 0, 0)),
            },
          })
            .session(session)
            .lean();

          if (
            existingUnpaid &&
            existingUnpaid.status !== "paid" &&
            !existingUnpaid.isInstallationBill
          ) {
            unpaidMonths.push({
              month: formatDateForDisplay(billingStartLocal),
              amount: existingUnpaid.total,
              billId: existingUnpaid._id,
              invoiceNumber: existingUnpaid.invoiceNumber,
              status: existingUnpaid.status,
            });
          }
        }
        currentBillLocal.setMonth(currentBillLocal.getMonth() + 1);
      }

      // ===== NEXT MONTH (FUTURE BILL) =====
      const nextMonthLocal = getStartOfNextMonth(todayLocal);
      const nextMonthEndLocal = getEndOfMonth(nextMonthLocal);
      const nextMonthDueStorage = getDueDateForMonthly(
        nextMonthLocal,
        settings,
      );

      const existsNext = await monthlyBillExistsForMonth(
        billingCycle[0]._id,
        nextMonthLocal,
        session,
      );

      if (!existsNext) {
        // ✅ FIX: start = 1st of month, end = last day of month (UTC midnight storage).
        const nextMonthBillData: any = {
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: {
            start: toStorageDate(nextMonthLocal),
            end: toStorageDate(nextMonthEndLocal),
          },
          dueDate: nextMonthDueStorage,
          items: [
            {
              description: `Monthly Subscription - ${formatDateForDisplay(nextMonthLocal)} to ${formatDateForDisplay(nextMonthEndLocal)} (PREPAID)`,
              quantity: 1,
              rate: actualMonthlyRate,
              amount: actualMonthlyRate,
            },
          ],
          subtotal: actualMonthlyRate,
          total: actualMonthlyRate,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
          isInstallationBill: false,
          installationFee: 0,
          installationFeePaid: false,
          applicationId: application.applicationId,
          notes: `Next month's bill. Period: ${formatDateForDisplay(nextMonthLocal)} to ${formatDateForDisplay(nextMonthEndLocal)}.`,
        };

        const nextBill = await Billing.create([nextMonthBillData], {
          session,
        });
        generatedBills.push(nextBill[0]);
        totalMonthlyAmount += actualMonthlyRate;

        const nextMonthInvoice = await createInvoiceFromBilling(
          nextBill[0],
          application,
          settings,
        );
        if (nextMonthInvoice) {
          await sendInvoiceWithPDFAttachment(
            nextMonthInvoice,
            application,
            req,
          );
        }
      }

      const lastGeneratedLocal = new Date(currentBillLocal);
      lastGeneratedLocal.setMonth(lastGeneratedLocal.getMonth() - 1);
      lastGeneratedLocal.setDate(1);
      const newNextBillingLocal = getFirstDayOfMonth(
        getStartOfNextMonth(lastGeneratedLocal),
      );

      await BillingCycle.updateOne(
        { _id: billingCycle[0]._id },
        { $set: { nextBillingDate: toStorageDate(newNextBillingLocal) } },
        { session },
      );

      let installationBill = null;
      if (installationFee > 0) {
        installationBill = await createInstallationBill(
          application,
          billingCycle[0]._id,
          installationFee,
          settings,
          session,
          req,
        );
      }

      await Application.updateOne(
        { applicationId: application.applicationId },
        {
          $set: {
            billingStarted: true,
            billingCycleId: billingCycle[0]._id,
            serviceStatus: "active",
            lastBillingAudit: new Date(),
            installationFee,
            installationFeePaid: installationFee === 0,
          },
        },
        { session },
      );

      await session.commitTransaction();

      eventService.emitBillingCycleCreated({
        billingCycle: billingCycle[0],
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        isBackdated: true,
      });

      for (const bill of generatedBills) {
        eventService.emitBillingCreated({
          billing: bill,
          applicationId: application.applicationId,
          type: bill.isProRated ? "pro-rated" : "monthly",
          customerName: `${application.firstName} ${application.lastName}`,
          isBackdated: true,
        });
      }

      if (installationBill) {
        eventService.emitBillingCreated({
          billing: installationBill,
          applicationId: application.applicationId,
          type: "installation",
          customerName: `${application.firstName} ${application.lastName}`,
          isBackdated: true,
        });
      }

      eventService.emitDashboardUpdate({
        reason: "Backdated billing initialized - FORCE REFRESH",
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        billsCount: generatedBills.length,
        forceRefresh: true,
        timestamp: Date.now(),
      });

      let message = `Backdated billing initialized for ${application.firstName} ${application.lastName}. Generated ${generatedBills.length} bill(s) totaling ₱${totalMonthlyAmount.toFixed(2)}.`;
      if (installationBill) {
        message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately.`;
      }

      return res.status(200).json({
        success: true,
        message,
        data: {
          billingCycle: billingCycle[0],
          generatedMonthlyBills: generatedBills,
          installationBill,
          totalMonthlyAmount,
          totalInstallationFee: installationFee,
          billsCount: generatedBills.length,
          serviceStartDate: startLocal,
          serviceStartMonthEnd: startMonthEndLocal,
          applicationId: application.applicationId,
          missingMonths,
          unpaidPreviousBills: unpaidMonths,
          currentDate: todayLocal,
          installationFee,
          installationFeeSeparate: installationBill !== null,
          buildingInstallationFee: installationFee,
          nextMonthBillGenerated: true,
          nextMonthPeriod: {
            start: nextMonthLocal,
            end: nextMonthEndLocal,
            dueDate: nextMonthDueStorage,
          },
          startMonthIsProRated: true,
          startMonthProRatedDays: startMonthProRatedDays,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("Error in initializeBackdatedBilling:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in initializeBackdatedBilling with retry:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message:
          "Failed to initialize backdated billing due to database conflict",
        error: error.message,
      });
    }
  });
};

export const getUnpaidBillsReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { applicationId, includePaid } = req.query;
    let query: any = {};
    if (applicationId) query.applicationId = applicationId;
    if (includePaid !== "true") {
      query.status = { $in: ["sent", "overdue", "pending_confirmation"] };
    }
    const [monthly, install] = await Promise.all([
      Billing.find({ ...query, isInstallationBill: false })
        .sort({ dueDate: 1 })
        .lean(),
      Billing.find({
        ...query,
        isInstallationBill: true,
        installationFeePaid: false,
      })
        .sort({ dueDate: 1 })
        .lean(),
    ]);
    const all = [...monthly, ...install];
    const ids = all.map((b) => b.applicationId).filter((id) => id);
    const apps =
      ids.length > 0
        ? await Application.find({ applicationId: { $in: ids } })
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean()
        : [];
    const map = new Map(apps.map((a) => [a.applicationId, a]));
    const enriched = all.map((b) => ({
      ...b,
      applicationData: map.get(b.applicationId) || null,
    }));
    const summary: any = {
      totalUnpaidBills: enriched.length,
      totalAmountDue: enriched.reduce((s, b) => s + b.total, 0),
      totalInstallationFeesDue: enriched
        .filter((b) => b.isInstallationBill && !b.installationFeePaid)
        .reduce((s, b) => s + (b.installationFee || 0), 0),
      totalMonthlyBillsDue: enriched
        .filter((b) => !b.isInstallationBill)
        .reduce((s, b) => s + b.total, 0),
      byStatus: {
        sent: enriched.filter((b) => b.status === "sent").length,
        overdue: enriched.filter((b) => b.status === "overdue").length,
        pending_confirmation: enriched.filter(
          (b) => b.status === "pending_confirmation",
        ).length,
      },
      byType: {
        monthly: monthly.length,
        installation: install.length,
      },
      byMonth: {},
    };
    enriched.forEach((b) => {
      const monthKey = formatDateForDisplay(
        fromStorageDate(b.billingPeriod.start),
      );
      if (!summary.byMonth[monthKey]) {
        summary.byMonth[monthKey] = {
          count: 0,
          amount: 0,
          installationFees: 0,
          monthlyBills: 0,
          bills: [],
          location: "",
        };
      }
      summary.byMonth[monthKey].count++;
      summary.byMonth[monthKey].amount += b.total;
      if (b.isInstallationBill && !b.installationFeePaid) {
        summary.byMonth[monthKey].installationFees += b.installationFee;
      } else if (!b.isInstallationBill) {
        summary.byMonth[monthKey].monthlyBills += b.total;
      }
      summary.byMonth[monthKey].bills.push({
        invoiceNumber: b.invoiceNumber,
        amount: b.total,
        status: b.status,
        dueDate: b.dueDate,
        isInstallationBill: b.isInstallationBill,
      });
    });
    res.status(200).json({ success: true, data: { bills: enriched, summary } });
  } catch (error) {
    next(error);
  }
};

export const manuallyGenerateBillsForMonth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { year, month, applicationId } = req.body;
    const targetLocal = new Date();
    if (year && month) {
      targetLocal.setFullYear(year);
      targetLocal.setMonth(month - 1);
      targetLocal.setDate(1);
    } else {
      targetLocal.setDate(1);
    }
    targetLocal.setHours(0, 0, 0, 0);

    const settings = await getOrCreateSettings();
    const targetMonthStartLocal = getFirstDayOfMonth(targetLocal);
    const targetMonthEndLocal = getEndOfMonth(targetMonthStartLocal);
    const dueDateStorage = getDueDateForMonthly(
      targetMonthStartLocal,
      settings,
    );

    let query: any = {
      status: "active",
      proRatedPaid: true,
      applicationId: { $exists: true, $ne: null },
    };
    if (applicationId) query.applicationId = applicationId;

    const cycles = await BillingCycle.find(query).populate("planId").lean();
    let generated = 0;
    let skipped = 0;
    const bills = [];

    for (const c of cycles) {
      if (!c.applicationId) {
        skipped++;
        continue;
      }
      const app = await Application.findOne({
        applicationId: c.applicationId,
      }).lean();
      if (!app) {
        skipped++;
        continue;
      }
      const plan = c.planId as any;
      if (!plan) {
        skipped++;
        continue;
      }
      const exists = await monthlyBillExistsForMonth(
        c._id,
        targetMonthStartLocal,
      );
      if (!exists) {
        const newBill = await createMonthlyBill(
          app,
          c._id,
          targetMonthStartLocal,
          targetMonthEndLocal,
          plan.price,
          settings,
          undefined,
          req,
        );
        generated++;
        bills.push(newBill);
      } else {
        skipped++;
      }
    }

    if (generated > 0) {
      for (const b of bills) {
        eventService.emitBillingCreated({
          billing: b,
          applicationId: b.applicationId,
          type: "monthly",
          manuallyGenerated: true,
        });
      }
      eventService.emitDashboardUpdate({
        reason: "Manually generated bills for month - FORCE REFRESH",
        count: generated,
        month: formatDateForDisplay(targetMonthStartLocal),
        forceRefresh: true,
        timestamp: Date.now(),
      });
    }

    res.status(200).json({
      success: true,
      message: `Generated ${generated} bills for ${formatDateForDisplay(targetMonthStartLocal)}`,
      data: {
        generated,
        skipped,
        billingMonth: formatDateForDisplay(targetMonthStartLocal),
        dueDate: formatDateForDisplay(fromStorageDate(dueDateStorage)),
        generatedBills: bills,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getLocationEmails = async (req: AuthRequest, res: Response) => {
  try {
    const emails = {
      breeze:
        process.env.COLLECTION_EMAIL_BREEZE ||
        "collection.breeze@misterfyber.com",
      sil: process.env.COLLECTION_EMAIL_SIL || "collection.sil@misterfyber.com",
      default:
        process.env.COLLECTION_EMAIL_DEFAULT || "collection@misterfyber.com",
    };
    res.status(200).json({ success: true, data: emails });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Error getting location emails",
    });
  }
};

export const testLocationEmail = async (req: AuthRequest, res: Response) => {
  try {
    const { location, email } = req.body;
    if (!location) {
      return res
        .status(400)
        .json({ success: false, message: "Location is required" });
    }
    const collectionEmail = getCollectionEmailByLocation(location);
    const adminId = getRequestingAdminId(req);
    const result = await emailService.sendEmail(
      email || collectionEmail,
      `🧪 Test Email - Location: ${location}`,
      emailService.generateTestLocationEmailHTML(location, collectionEmail),
      false,
      location,
      {
        replyTo: process.env.SUPPORT_EMAIL || "admin@misterfyber.com",
        adminId,
      },
    );
    res.status(200).json({
      success: true,
      message: "Test email sent successfully",
      data: { location, collectionEmail, result },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Error sending test email",
    });
  }
};

export const getBuildingInstallationFee = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { buildingId } = req.params;
    if (!buildingId) {
      return res
        .status(400)
        .json({ success: false, message: "Building ID is required" });
    }
    const building = await Building.findById(buildingId).lean();
    if (!building) {
      return res
        .status(404)
        .json({ success: false, message: "Building not found" });
    }
    res.status(200).json({
      success: true,
      data: {
        buildingId: building._id,
        buildingName: building.buildingName,
        installationFee: building.installationFee || 0,
        location: building.location || "",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// USER DASHBOARD
// ============================================================
export const getUserCurrentBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }
    const userDoc = await User.findById(userId)
      .select("applicationId email")
      .lean();
    const applicationId = userDoc?.applicationId;
    const query: any = {
      status: {
        $in: ["active", "pending_activation", "paused", "disconnected"],
      },
    };
    if (applicationId) {
      query.$or = [{ userId }, { applicationId }];
    } else {
      query.userId = userId;
    }
    const billingCycle = await BillingCycle.findOne(query)
      .populate("planId", "name price speed description features")
      .lean();
    if (!billingCycle) {
      return res.status(200).json({
        success: true,
        data: {
          billingCycle: null,
          currentBill: null,
          needsFirstPayment: false,
          isAfterCutoff: false,
        },
      });
    }
    const billQuery: any = {
      billingCycleId: billingCycle._id,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
    };
    if (billingCycle.userId) billQuery.userId = billingCycle.userId;
    else if (billingCycle.applicationId)
      billQuery.applicationId = billingCycle.applicationId;
    const currentBill = await Billing.findOne(billQuery)
      .sort({ dueDate: 1 })
      .lean();
    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentBill,
        needsFirstPayment: billingCycle.proRatedPaid === false,
        isAfterCutoff: billingCycle.isAfterCutoff || false,
      },
    });
  } catch (error) {
    console.error("Error in getUserCurrentBilling:", error);
    next(error);
  }
};

export const getUserBillingHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }
    const userDoc = await User.findById(userId).select("applicationId").lean();
    const applicationId = userDoc?.applicationId;
    const query: any = {};
    if (applicationId) query.$or = [{ userId }, { applicationId }];
    else query.userId = userId;
    const [bills, total] = await Promise.all([
      Billing.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Billing.countDocuments(query),
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
    console.error("Error in getUserBillingHistory:", error);
    next(error);
  }
};

// ============================================================
// GET DASHBOARD DATA - OPTIMIZED NO N+1
// ============================================================
export const getDashboardData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("🔄 Fetching dashboard data...");
    const startTime = Date.now();

    const [
      buildings,
      billingCycles,
      bills,
      users,
      applications,
      pendingPayments,
      customersWithoutAccounts,
      pendingInstallationBills,
      pendingProRated,
      pendingActivations,
    ] = await Promise.all([
      Building.find({}).lean(),
      BillingCycle.find({})
        .populate("planId", "name price")
        .sort({ createdAt: -1 })
        .lean(),
      Billing.find({
        status: { $in: ["sent", "overdue", "pending_confirmation"] },
      })
        .sort({ dueDate: 1 })
        .lean(),
      User.find({})
        .select(
          "firstName lastName email username phoneNumber status planId building unitNumber floor",
        )
        .populate("planId", "name price")
        .lean(),
      Application.find({
        status: { $in: ["approved", "pending", "suspended", "disconnected"] },
      })
        .select(
          "firstName lastName email phoneNumber status applicationId planId buildingId buildingName tower floor unitNumber installationFee installationFeePaid billingStarted serviceStatus disconnectedAt disconnectReason",
        )
        .populate("planId", "name price")
        .populate("buildingId", "buildingName streetAddress city")
        .lean(),
      Payment.find({ status: "pending" }).sort({ createdAt: -1 }).lean(),
      Application.find({
        status: "approved",
        $or: [
          { registeredUserId: { $exists: false } },
          { registeredUserId: null },
        ],
        billingStarted: { $ne: true },
      })
        .select(
          "firstName lastName email applicationId planId buildingId buildingName",
        )
        .populate("planId", "name price")
        .populate("buildingId", "buildingName streetAddress city")
        .lean(),
      Billing.find({
        isInstallationBill: true,
        installationFeePaid: false,
        status: { $in: ["sent", "overdue"] },
      })
        .sort({ dueDate: 1 })
        .lean(),
      Billing.find({
        isProRated: true,
        status: "pending_confirmation",
        isInstallationBill: false,
      })
        .sort({ createdAt: -1 })
        .lean(),
      BillingCycle.find({
        status: "pending_activation",
        proRatedPaid: true,
        manualBillStart: false,
      })
        .populate("planId", "name price")
        .sort({ proRatedPaidAt: -1 })
        .lean(),
    ]);

    const allAppIds = new Set<string>();
    billingCycles.forEach(
      (c) => c.applicationId && allAppIds.add(c.applicationId),
    );
    bills.forEach((b) => b.applicationId && allAppIds.add(b.applicationId));
    pendingInstallationBills.forEach(
      (b) => b.applicationId && allAppIds.add(b.applicationId),
    );
    pendingProRated.forEach(
      (b) => b.applicationId && allAppIds.add(b.applicationId),
    );
    pendingActivations.forEach(
      (c) => c.applicationId && allAppIds.add(c.applicationId),
    );

    const referencedApplications =
      allAppIds.size > 0
        ? await Application.find({
            applicationId: { $in: Array.from(allAppIds) },
          })
            .select(
              "firstName lastName email applicationId phoneNumber buildingName location serviceStatus buildingId",
            )
            .populate("buildingId", "buildingName streetAddress city")
            .lean()
        : [];

    const applicationMap = new Map<string, any>();
    [...referencedApplications, ...applications].forEach((a: any) => {
      if (a.applicationId) applicationMap.set(a.applicationId, a);
      if (a._id) applicationMap.set(String(a._id), a);
    });

    const enrich = (x: any) => {
      const appData =
        applicationMap.get(x.applicationId) ||
        applicationMap.get(String(x.applicationId)) ||
        null;
      return { ...x, applicationData: appData };
    };

    const enrichedCycles = billingCycles.map(enrich);
    const enrichedBills = bills.map(enrich);
    const enrichedPendingInstallation = pendingInstallationBills.map(enrich);
    const enrichedPendingProRated = pendingProRated.map(enrich);
    const enrichedPendingActivations = pendingActivations.map(enrich);

    const userCustomers = users.map((user: any) => {
      const userBills = enrichedBills.filter(
        (bill) => bill.userId?._id === user._id || bill.userId === user._id,
      );
      const totalBalance = userBills.reduce(
        (sum, bill) => sum + (bill.total || 0),
        0,
      );
      const overdueBills = userBills.filter(
        (bill) =>
          bill.status === "overdue" || new Date(bill.dueDate) < new Date(),
      );
      const userCycle = enrichedCycles.find(
        (cycle) => cycle.userId?._id === user._id || cycle.userId === user._id,
      );
      let buildingObj = user.building || null;
      if (buildingObj && typeof buildingObj === "object" && !buildingObj._id) {
        const found = buildings.find(
          (b) => b.buildingName === buildingObj.buildingName,
        );
        if (found) buildingObj = found;
      }
      const isDisconnected = user.status === "disconnected";
      return {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        phoneNumber: user.phoneNumber,
        status: user.status,
        type: "user" as const,
        planName: user.planId?.name || "No Plan",
        planPrice: user.planId?.price || 0,
        currentBalance: totalBalance,
        unpaidBills: userBills,
        overdueBills,
        billingCycle: userCycle || null,
        installationFee: 0,
        installationFeePaid: true,
        building: buildingObj,
        unitNumber: user.unitNumber,
        floor: user.floor,
        isDisconnected,
        hiddenBills: [],
        visibleUnpaidBills: userBills,
      };
    });

    const applicationCustomers = applications
      .filter((app: any) => {
        if (app.status === "approved") return true;
        if (app.status === "suspended") return true;
        if (app.status === "disconnected") return true;
        if (app.billingStarted === true) return true;
        if (app.status === "pending" && app.billingStarted === true)
          return true;
        return false;
      })
      .map((app: any) => {
        const appBills = enrichedBills.filter(
          (bill) =>
            bill.applicationId === app.applicationId ||
            String(bill.applicationId) === String(app._id),
        );
        const totalBalance = appBills.reduce(
          (sum, bill) => sum + (bill.total || 0),
          0,
        );
        const overdueBills = appBills.filter(
          (bill) =>
            bill.status === "overdue" || new Date(bill.dueDate) < new Date(),
        );
        const appCycle = enrichedCycles.find(
          (cycle) =>
            cycle.applicationId === app.applicationId ||
            String(cycle.applicationId) === String(app._id),
        );
        let buildingObj: any = null;
        if (app.buildingId) {
          if (typeof app.buildingId === "object" && app.buildingId._id) {
            buildingObj = app.buildingId;
          } else if (typeof app.buildingId === "string") {
            const found = buildings.find(
              (b) =>
                String(b._id) === String(app.buildingId) ||
                b.buildingName === app.buildingId,
            );
            if (found) buildingObj = found;
          }
        }
        if (!buildingObj && app.buildingName) {
          const found = buildings.find(
            (b) => b.buildingName === app.buildingName,
          );
          buildingObj = found || { buildingName: app.buildingName };
        }
        const isDisconnected =
          app.status === "disconnected" || app.serviceStatus === "disconnected";
        let displayStatus: string;
        if (isDisconnected) displayStatus = "disconnected";
        else if (app.status === "suspended") displayStatus = "suspended";
        else if (app.billingStarted) displayStatus = "billing_started";
        else displayStatus = "approved";

        return {
          _id: app._id,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: displayStatus,
          type: "application" as const,
          planName: app.planId?.name || "No Plan",
          planPrice: app.planId?.price || 0,
          currentBalance: totalBalance,
          unpaidBills: appBills,
          overdueBills,
          billingCycle: appCycle || null,
          applicationId: app.applicationId,
          installationFee: app.installationFee || 0,
          installationFeePaid: app.installationFeePaid || false,
          building: buildingObj,
          unitNumber: app.unitNumber,
          floor: app.floor,
          tower: app.tower,
          isDisconnected,
          serviceStatus: app.serviceStatus || "active",
          disconnectedAt: app.disconnectedAt,
          disconnectReason: app.disconnectReason,
          hiddenBills: [],
          visibleUnpaidBills: appBills,
        };
      });

    const seenAppIds = new Set<string>();
    const dedupedApp = applicationCustomers.filter((c) => {
      const key = c.applicationId || String(c._id);
      if (seenAppIds.has(key)) return false;
      seenAppIds.add(key);
      return true;
    });

    const seenUserKeys = new Set<string>();
    const dedupedUser = userCustomers.filter((c) => {
      const key = c.email || String(c._id);
      const match = dedupedApp.find(
        (a) => a.email?.toLowerCase() === c.email?.toLowerCase(),
      );
      if (match) return false;
      if (seenUserKeys.has(key)) return false;
      seenUserKeys.add(key);
      return true;
    });

    const allCustomers = [...dedupedUser, ...dedupedApp];
    allCustomers.sort((a, b) => b.currentBalance - a.currentBalance);

    const activeCustomers = allCustomers.filter(
      (c) => !c.isDisconnected && c.status !== "disconnected",
    );
    const disconnectedCustomers = allCustomers.filter(
      (c) => c.isDisconnected || c.status === "disconnected",
    );

    const totalBalance = activeCustomers.reduce(
      (s, c) => s + c.currentBalance,
      0,
    );
    const customersWithBalance = activeCustomers.filter(
      (c) => c.currentBalance > 0,
    ).length;
    const overdueCustomers = activeCustomers.filter(
      (c) => c.overdueBills.length > 0,
    ).length;
    const activeCycles = enrichedCycles.filter(
      (c) => c.status === "active",
    ).length;
    const pausedCycles = enrichedCycles.filter(
      (c) => c.status === "paused",
    ).length;
    const applicationsWithoutBilling = applications.filter(
      (a: any) => a.status === "approved" && !a.billingStarted,
    ).length;
    const totalInstallationFeesDue = activeCustomers
      .filter(
        (c) =>
          c.type === "application" &&
          !c.installationFeePaid &&
          (c.installationFee || 0) > 0,
      )
      .reduce((s, c) => s + (c.installationFee || 0), 0);
    const installationFeesPaidCount = allCustomers.filter(
      (c) => c.type === "application" && c.installationFeePaid,
    ).length;

    const stats = {
      totalCustomers: allCustomers.length,
      totalBalance,
      customersWithBalanceCount: customersWithBalance,
      overdueCustomersCount: overdueCustomers,
      activeCyclesCount: activeCycles,
      pausedCyclesCount: pausedCycles,
      pendingProRatedCount: pendingProRated.length,
      pendingActivationsCount: pendingActivations.length,
      pendingPaymentsCount: pendingPayments.length,
      pendingInstallationBillsCount: pendingInstallationBills.length,
      applicationsWithoutBilling,
      totalInstallationFeesDue,
      installationFeesPaidCount,
      disconnectedCustomersCount: disconnectedCustomers.length,
      activeCustomersCount: activeCustomers.length,
    };

    const dashboardData = {
      customers: allCustomers,
      activeCustomers,
      disconnectedCustomers,
      allCustomers,
      billingCycles: enrichedCycles,
      bills: enrichedBills,
      pendingPayments,
      customersWithoutAccounts,
      pendingInstallationBills: enrichedPendingInstallation,
      pendingProRated: enrichedPendingProRated,
      pendingActivations: enrichedPendingActivations,
      stats,
    };

    console.log(
      `✅ Dashboard data fetched in ${Date.now() - startTime}ms: ${allCustomers.length} total`,
    );

    res.status(200).json({
      success: true,
      data: dashboardData,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    });
  } catch (error) {
    console.error("Error in getDashboardData:", error);
    next(error);
  }
};

export const checkForUpdates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { lastUpdated } = req.query;
    if (!lastUpdated) {
      return res.status(200).json({ success: true, hasUpdates: true });
    }
    const lastCheck = new Date(lastUpdated as string);
    const [recentBill, recentCycle, recentPayment, recentApplication] =
      await Promise.all([
        Billing.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean(),
        BillingCycle.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean(),
        Payment.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean(),
        Application.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean(),
      ]);
    const hasUpdates = !!(
      recentBill ||
      recentCycle ||
      recentPayment ||
      recentApplication
    );
    res.status(200).json({
      success: true,
      hasUpdates,
      lastChecked: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

export const manuallyGenerateEarlyBill = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { applicationId, monthOffset } = req.body;
    if (!applicationId) {
      return res
        .status(400)
        .json({ success: false, message: "applicationId is required" });
    }
    const settings = await getOrCreateSettings();
    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);
    const offset = monthOffset || 1;
    const currentMonthStartLocal = getFirstDayOfMonth(todayLocal);
    const targetLocal = new Date(currentMonthStartLocal);
    targetLocal.setMonth(currentMonthStartLocal.getMonth() + offset);
    targetLocal.setDate(1);
    targetLocal.setHours(0, 0, 0, 0);

    const targetMonthStartLocal = getFirstDayOfMonth(targetLocal);
    const targetMonthEndLocal = getEndOfMonth(targetMonthStartLocal);
    const dueDateStorage = getDueDateForMonthly(
      targetMonthStartLocal,
      settings,
    );

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    const cycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "active",
      proRatedPaid: true,
    })
      .populate("planId")
      .lean();
    if (!cycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found",
      });
    }
    const plan = cycle.planId as any;
    if (!plan) {
      return res.status(400).json({ success: false, message: "No plan found" });
    }
    const exists = await monthlyBillExistsForMonth(
      cycle._id,
      targetMonthStartLocal,
    );
    if (exists) {
      const { y, m } = extractYMD(targetMonthStartLocal);
      const existingBill = await Billing.findOne({
        billingCycleId: cycle._id,
        isProRated: false,
        isInstallationBill: false,
        "billingPeriod.start": {
          $gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
          $lte: new Date(Date.UTC(y, m + 1, 0, 0, 0, 0, 0)),
        },
      }).lean();
      return res.status(400).json({
        success: false,
        message: `Bill already exists for ${formatDateForDisplay(targetMonthStartLocal)}`,
        data: { existingBill, invoiceNumber: existingBill?.invoiceNumber },
      });
    }
    const newBill = await createMonthlyBill(
      application,
      cycle._id,
      targetMonthStartLocal,
      targetMonthEndLocal,
      plan.price,
      settings,
      undefined,
      req,
    );

    if (offset > 1) {
      const nextLocal = getFirstDayOfMonth(
        new Date(
          targetMonthStartLocal.getFullYear(),
          targetMonthStartLocal.getMonth() + 1,
          1,
        ),
      );
      await BillingCycle.updateOne(
        { _id: cycle._id },
        { $set: { nextBillingDate: toStorageDate(nextLocal) } },
      );
    }

    if (newBill) {
      eventService.emitBillingCreated({
        billing: newBill,
        applicationId: application.applicationId,
        type: "monthly",
        customerName: `${application.firstName} ${application.lastName}`,
        manuallyGenerated: true,
        monthOffset: offset,
      });
    }
    eventService.emitDashboardUpdate({
      reason: "Manually generated early bill - FORCE REFRESH",
      applicationId: application.applicationId,
      customerName: `${application.firstName} ${application.lastName}`,
      forceRefresh: true,
      timestamp: Date.now(),
    });

    res.status(200).json({
      success: true,
      message: `✅ Early bill generated for ${application.firstName} ${application.lastName} for ${formatDateForDisplay(targetMonthStartLocal)}`,
      data: {
        bill: newBill,
        billingMonth: formatDateForDisplay(targetMonthStartLocal),
        dueDate: formatDateForDisplay(fromStorageDate(dueDateStorage)),
        applicationName: `${application.firstName} ${application.lastName}`,
        applicationId: application.applicationId,
        invoiceNumber: newBill.invoiceNumber,
        amount: plan.price,
        monthOffset: offset,
      },
    });
  } catch (error) {
    console.error("Error manually generating early bill:", error);
    next(error);
  }
};

export const checkForNewCustomers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const newCustomers = await Application.find({
      status: "approved",
      billingStarted: { $ne: true },
    })
      .select(
        "firstName lastName email applicationId planId buildingName phoneNumber",
      )
      .populate("planId", "name price")
      .lean();
    if (newCustomers.length > 0) {
      eventService.emitCustomerCreated({
        customers: newCustomers,
        count: newCustomers.length,
        type: "new_customers_detected",
      });
      eventService.emitDashboardUpdate({
        reason: "New customers detected - FORCE REFRESH",
        count: newCustomers.length,
        forceRefresh: true,
        timestamp: Date.now(),
      });
    }
    res.status(200).json({
      success: true,
      data: newCustomers,
      total: newCustomers.length,
    });
  } catch (error) {
    console.error("Error checking for new customers:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to check for new customers" });
  }
};

// ==================== START BILLING ====================
export const startBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  await withRetry(async () => {
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
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }

      const application = await Application.findOne({ applicationId })
        .populate("planId")
        .lean();
      if (!application) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: `Application not found: ${applicationId}`,
        });
      }

      const existingCycle = await BillingCycle.findOne({
        applicationId: application.applicationId,
      }).lean();
      if (existingCycle) {
        await session.abortTransaction();
        const statusMessages: Record<string, string> = {
          active: "active and running",
          paused: "paused",
          pending_activation: "pending payment confirmation",
          cancelled: "cancelled",
          disconnected: "disconnected",
        };
        return res.status(400).json({
          success: false,
          message: `Billing already started. Status: ${statusMessages[existingCycle.status] || existingCycle.status}`,
          data: {
            billingCycle: existingCycle,
            status: existingCycle.status,
            startDate: existingCycle.billingStartDate,
            nextBillingDate: existingCycle.nextBillingDate,
          },
        });
      }

      const plan = application.planId as any;
      if (!plan) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "No plan assigned" });
      }

      const settings = await getOrCreateSettings();
      const billingCutoffDay = settings.billingCutoffDay || 24;
      const monthlyRate = plan.price;
      const dailyRate = (monthlyRate * 12) / 365;

      let installationFee = 0;
      if (includeInstallationFee !== false) {
        const building = await getBuildingForApplication(application);
        if (building && building.installationFee > 0) {
          installationFee = building.installationFee;
        } else {
          installationFee = settings.installationFee || 1500;
        }
      }

      const installationDateLocal = startDate
        ? parseDateToLocalMidnight(startDate)
        : parseDateToLocalMidnight(new Date());

      const installationDay = installationDateLocal.getDate();
      const currentMonthEndLocal = getEndOfMonth(installationDateLocal);
      const actualBillableDays = daysInclusiveLocal(
        installationDateLocal,
        currentMonthEndLocal,
      );
      const isAfterCutoff = installationDay > billingCutoffDay;

      let createdInstallationBill: any = null;
      let createdProRatedBill: any = null;
      let createdMonthlyBill: any = null;

      if (!isAfterCutoff) {
        let proRatedAmount: number;
        if (installationDay === 1) {
          proRatedAmount = monthlyRate;
        } else {
          proRatedAmount =
            Math.round(dailyRate * actualBillableDays * 100) / 100;
        }
        const finalAmount = customAmount ? customAmount : proRatedAmount;

        const nextFullMonthStartLocal = getStartOfNextMonth(
          installationDateLocal,
        );
        const nextFullMonthEndLocal = getEndOfMonth(nextFullMonthStartLocal);
        const nextBillingDateLocal = getFirstDayOfMonth(
          nextFullMonthStartLocal,
        );

        const cycle = await BillingCycle.create(
          [
            {
              planId: plan._id,
              monthlyRate,
              currentProRatedAmount: finalAmount,
              proRatedPaid: false,
              actualBillableDays,
              isAfterCutoff: false,
              cutoffDayUsed: billingCutoffDay,
              applicationId: application.applicationId,
              installationFee,
              installationFeePaid: false,
              billingStartDate: toStorageDate(nextFullMonthStartLocal),
              billingEndDate: toStorageDate(nextFullMonthEndLocal),
              nextBillingDate: toStorageDate(nextBillingDateLocal),
              status: "active",
            },
          ],
          { session },
        );

        createdProRatedBill = await createProRatedBill(
          application,
          cycle[0]._id,
          installationDateLocal,
          currentMonthEndLocal,
          finalAmount,
          actualBillableDays,
          dailyRate,
          settings,
          false,
          session,
          req,
        );

        if (installationFee > 0) {
          createdInstallationBill = await createInstallationBill(
            application,
            cycle[0]._id,
            installationFee,
            settings,
            session,
            req,
          );
        }

        await session.commitTransaction();

        await Application.updateOne(
          { applicationId: application.applicationId },
          {
            $set: {
              billingStarted: true,
              billingCycleId: cycle[0]._id,
              serviceStatus: "active",
              installationFee,
              installationFeePaid: false,
            },
          },
        );

        eventService.emitBillingCycleCreated({
          billingCycle: cycle[0],
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          isBackdated: false,
        });

        if (createdProRatedBill) {
          eventService.emitBillingCreated({
            billing: createdProRatedBill,
            applicationId: application.applicationId,
            type: "pro-rated",
            customerName: `${application.firstName} ${application.lastName}`,
          });
        }
        if (createdInstallationBill) {
          eventService.emitBillingCreated({
            billing: createdInstallationBill,
            applicationId: application.applicationId,
            type: "installation",
            customerName: `${application.firstName} ${application.lastName}`,
          });
        }

        eventService.emitDashboardUpdate({
          reason: "New billing started - FORCE REFRESH",
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          forceRefresh: true,
          timestamp: Date.now(),
        });

        return res.status(200).json({
          success: true,
          message: `Billing started. Pro-rated ₱${finalAmount.toFixed(2)} for ${actualBillableDays} days.`,
          data: {
            billingCycle: cycle[0],
            proRatedBill: createdProRatedBill,
            installationBill: createdInstallationBill,
            proRatedAmount: finalAmount,
            dailyRate,
            monthlyRate,
            annualRate: monthlyRate * 12,
            actualBillableDays,
            installationDay,
            billingCutoffDay,
            isAfterCutoff: false,
            nextBillingDate: nextBillingDateLocal,
            applicationId: application.applicationId,
            installationFee,
            installationFeeSeparate: createdInstallationBill !== null,
            buildingInstallationFee: installationFee,
          },
        });
      } else {
        let proRatedAmount: number;
        if (installationDay === 1) {
          proRatedAmount = monthlyRate;
        } else {
          proRatedAmount =
            Math.round(dailyRate * actualBillableDays * 100) / 100;
        }
        const finalAmount = customAmount ? customAmount : proRatedAmount;

        const nextFullMonthStartLocal = getStartOfNextMonth(
          installationDateLocal,
        );
        const nextFullMonthEndLocal = getEndOfMonth(nextFullMonthStartLocal);
        const nextBillingDateLocal = getFirstDayOfMonth(
          nextFullMonthStartLocal,
        );
        const combinedDueStorage = getDueDateForMonthly(
          nextFullMonthStartLocal,
          settings,
        );

        const cycle = await BillingCycle.create(
          [
            {
              planId: plan._id,
              monthlyRate,
              currentProRatedAmount: finalAmount,
              proRatedPaid: false,
              actualBillableDays,
              isAfterCutoff: true,
              cutoffDayUsed: billingCutoffDay,
              applicationId: application.applicationId,
              installationFee,
              installationFeePaid: false,
              billingStartDate: toStorageDate(nextFullMonthStartLocal),
              billingEndDate: toStorageDate(nextFullMonthEndLocal),
              nextBillingDate: toStorageDate(nextBillingDateLocal),
              status: "active",
            },
          ],
          { session },
        );

        createdProRatedBill = await createProRatedBill(
          application,
          cycle[0]._id,
          installationDateLocal,
          currentMonthEndLocal,
          finalAmount,
          actualBillableDays,
          dailyRate,
          settings,
          true,
          session,
          req,
        );

        const nextMonthAlreadyBilled = await monthlyBillExistsForMonth(
          cycle[0]._id,
          nextFullMonthStartLocal,
          session,
        );

        if (!nextMonthAlreadyBilled) {
          const monthlyBillData = {
            billingCycleId: cycle[0]._id,
            invoiceNumber: generateInvoiceNumber(),
            billingPeriod: {
              start: toStorageDate(nextFullMonthStartLocal),
              end: toStorageDate(nextFullMonthEndLocal),
            },
            dueDate: combinedDueStorage,
            items: [
              {
                description: `Monthly Subscription - ${formatDateForDisplay(nextFullMonthStartLocal)} to ${formatDateForDisplay(nextFullMonthEndLocal)} (PREPAID)`,
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
            isInstallationBill: false,
            installationFee: 0,
            installationFeePaid: false,
            notes: `Regular monthly subscription - PREPAID`,
            applicationId: application.applicationId,
          };
          const result = await Billing.create([monthlyBillData], { session });
          createdMonthlyBill = result[0];
          const inv = await createInvoiceFromBilling(
            createdMonthlyBill,
            application,
            settings,
          );
          if (inv) await sendInvoiceWithPDFAttachment(inv, application, req);
        }

        if (installationFee > 0) {
          createdInstallationBill = await createInstallationBill(
            application,
            cycle[0]._id,
            installationFee,
            settings,
            session,
            req,
          );
        }

        await session.commitTransaction();

        await Application.updateOne(
          { applicationId: application.applicationId },
          {
            $set: {
              billingStarted: true,
              billingCycleId: cycle[0]._id,
              serviceStatus: "active",
              installationFee,
              installationFeePaid: false,
            },
          },
        );

        eventService.emitBillingCycleCreated({
          billingCycle: cycle[0],
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          isBackdated: false,
        });

        if (createdProRatedBill) {
          eventService.emitBillingCreated({
            billing: createdProRatedBill,
            applicationId: application.applicationId,
            type: "pro-rated",
            customerName: `${application.firstName} ${application.lastName}`,
          });
        }
        if (createdMonthlyBill) {
          eventService.emitBillingCreated({
            billing: createdMonthlyBill,
            applicationId: application.applicationId,
            type: "monthly",
            customerName: `${application.firstName} ${application.lastName}`,
          });
        }
        if (createdInstallationBill) {
          eventService.emitBillingCreated({
            billing: createdInstallationBill,
            applicationId: application.applicationId,
            type: "installation",
            customerName: `${application.firstName} ${application.lastName}`,
          });
        }

        eventService.emitDashboardUpdate({
          reason: "New billing started (after cutoff) - FORCE REFRESH",
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          forceRefresh: true,
          timestamp: Date.now(),
        });

        const totalFirstPayment = finalAmount + monthlyRate;

        return res.status(200).json({
          success: true,
          message: `Billing started. Total first payment: ₱${totalFirstPayment.toFixed(2)}`,
          data: {
            billingCycle: cycle[0],
            proRatedBill: createdProRatedBill,
            monthlyBill: createdMonthlyBill,
            installationBill: createdInstallationBill,
            proRatedAmount: finalAmount,
            monthlyAmount: monthlyRate,
            totalFirstPayment,
            dailyRate,
            monthlyRate,
            annualRate: monthlyRate * 12,
            actualBillableDays,
            installationDay,
            billingCutoffDay,
            isAfterCutoff: true,
            dueDate: combinedDueStorage,
            nextBillingDate: nextBillingDateLocal,
            applicationId: application.applicationId,
            installationFee,
            installationFeeSeparate: createdInstallationBill !== null,
            buildingInstallationFee: installationFee,
          },
        });
      }
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in startBilling with retry:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to start billing due to database conflict",
        error: error.message,
      });
    }
  });
};

export const stopBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId, reason } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }
      const application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      const cycle = await BillingCycle.findOne({
        applicationId: application.applicationId,
        status: { $in: ["active", "paused"] },
      }).lean();
      if (!cycle) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "No active billing cycle" });
      }
      await BillingCycle.updateOne(
        { _id: cycle._id },
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
      eventService.emitBillingCycleDeleted({
        billingCycleId: cycle._id,
        applicationId: application.applicationId,
        reason: reason || "Admin action",
        customerName: `${application.firstName} ${application.lastName}`,
      });
      eventService.emitDashboardUpdate({
        reason: "Billing stopped - FORCE REFRESH",
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: `Billing stopped for ${application.firstName} ${application.lastName}`,
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in stopBilling:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to stop billing",
        error: error.message,
      });
    }
  });
};

export const pauseBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId, reason, pauseUntilDate } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }
      const application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      const cycle = await BillingCycle.findOne({
        applicationId: application.applicationId,
        status: { $in: ["active", "pending_activation"] },
      }).lean();
      if (!cycle) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "No active billing cycle" });
      }
      const unpaid = await Billing.find({
        applicationId: application.applicationId,
        status: { $in: ["sent", "overdue", "pending_confirmation"] },
        isInstallationBill: false,
      }).lean();
      if (unpaid.length > 0) {
        await session.abortTransaction();
        const total = unpaid.reduce((s, b) => s + (b.total || 0), 0);
        return res.status(400).json({
          success: false,
          message: `Cannot pause. ${unpaid.length} unpaid bill(s) totaling ₱${total.toFixed(2)}.`,
          data: { unpaidMonthlyBills: unpaid, totalAmount: total },
        });
      }
      await BillingCycle.updateOne(
        { _id: cycle._id },
        {
          $set: {
            status: "paused",
            pausedAt: new Date(),
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
      eventService.emitBillingCycleUpdated({
        billingCycleId: cycle._id,
        applicationId: application.applicationId,
        status: "paused",
        reason: reason || "Customer requested pause",
        customerName: `${application.firstName} ${application.lastName}`,
      });
      eventService.emitDashboardUpdate({
        reason: "Billing paused - FORCE REFRESH",
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      const location = await getLocationFromEntity(application);
      const adminId = getRequestingAdminId(req);
      const emailEnabled = await areCustomerEmailAlertsEnabled(adminId);
      try {
        if (application.email && emailEnabled) {
          await emailService.sendEmail(
            application.email,
            "Your Service Has Been Paused - Mister Fyber",
            emailService.generateServiceStatusHTML(
              application.firstName,
              application.lastName,
              "paused",
              `Service paused. Reason: ${reason || "Customer requested pause"}.`,
            ),
            true,
            location,
            { adminId },
          );
        }
      } catch (e) {
        console.error("Pause email failed:", e);
      }
      return res.status(200).json({
        success: true,
        message: `Service paused for ${application.firstName} ${application.lastName}`,
        data: {
          customerName: `${application.firstName} ${application.lastName}`,
          customerEmail: application.email,
          pausedAt: new Date(),
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in pauseBilling:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to pause billing",
        error: error.message,
      });
    }
  });
};

export const resumeBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
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
      const cycle = await BillingCycle.findOne({
        applicationId: application.applicationId,
        status: "paused",
      }).lean();
      if (!cycle) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "No paused billing cycle" });
      }
      const pending = await Billing.find({
        applicationId: application.applicationId,
        status: { $in: ["sent", "overdue", "pending_confirmation"] },
        isInstallationBill: false,
      }).lean();
      if (pending.length > 0) {
        await session.abortTransaction();
        const total = pending.reduce((s, b) => s + (b.total || 0), 0);
        return res.status(400).json({
          success: false,
          message: `Cannot resume. ${pending.length} unpaid bill(s) totaling ₱${total.toFixed(2)}.`,
        });
      }
      const resumeDate = new Date();
      const nextBillingLocal = getFirstDayOfMonth(
        getStartOfNextMonth(resumeDate),
      );
      await BillingCycle.updateOne(
        { _id: cycle._id },
        {
          $set: {
            status: "active",
            resumedAt: resumeDate,
            nextBillingDate: toStorageDate(nextBillingLocal),
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
      eventService.emitBillingCycleUpdated({
        billingCycleId: cycle._id,
        applicationId: application.applicationId,
        status: "active",
        customerName: `${application.firstName} ${application.lastName}`,
      });
      eventService.emitDashboardUpdate({
        reason: "Billing resumed - FORCE REFRESH",
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: `Service resumed for ${application.firstName} ${application.lastName}`,
        data: {
          customerName: `${application.firstName} ${application.lastName}`,
          customerEmail: application.email,
          resumedAt: resumeDate,
          nextBillingDate: nextBillingLocal,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in resumeBilling:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to resume billing",
        error: error.message,
      });
    }
  });
};

export const disconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId, reason } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }
      const application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      const now = new Date();
      await Application.updateOne(
        { applicationId: application.applicationId },
        {
          $set: {
            status: "disconnected",
            serviceStatus: "disconnected",
            disconnectedAt: now,
            disconnectReason: reason || "Admin action",
          },
        },
        { session },
      );
      await BillingCycle.updateOne(
        { applicationId: application.applicationId },
        {
          $set: {
            status: "disconnected",
            disconnectedAt: now,
            disconnectReason: reason || "Admin action",
          },
        },
        { session },
      );
      await session.commitTransaction();
      eventService.emitCustomerUpdated({
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        status: "disconnected",
        type: "disconnect",
      });
      eventService.emitDashboardUpdate({
        reason: "Client disconnected - bills preserved",
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: `Service disconnected for ${application.firstName} ${application.lastName}. Bills preserved.`,
        data: {
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          disconnectedAt: now,
          billsPreserved: true,
          reason: reason || "Admin action",
          status: "disconnected",
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in disconnectClient:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to disconnect client",
        error: error.message,
      });
    }
  });
};

export const reconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }
      const application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      const now = new Date();
      await Application.updateOne(
        { applicationId: application.applicationId },
        {
          $set: {
            status: "approved",
            serviceStatus: "active",
            reconnectedAt: now,
          },
          $unset: { disconnectedAt: "", disconnectReason: "" },
        },
        { session },
      );
      await BillingCycle.updateOne(
        { applicationId: application.applicationId },
        {
          $set: { status: "active", reconnectedAt: now },
          $unset: { disconnectedAt: "", disconnectReason: "" },
        },
        { session },
      );
      await session.commitTransaction();
      eventService.emitCustomerUpdated({
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        status: "approved",
        type: "reconnect",
      });
      eventService.emitDashboardUpdate({
        reason: "Client reconnected - bills restored",
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: `Service reconnected for ${application.firstName} ${application.lastName}.`,
        data: {
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          reconnectedAt: now,
          billsRestored: true,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in reconnectClient:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to reconnect client",
        error: error.message,
      });
    }
  });
};

export const deleteBillingCycle = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
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
      const cycle =
        await BillingCycle.findById(billingCycleId).session(session);
      if (!cycle) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Billing cycle not found" });
      }
      await Invoice.deleteMany({ billingCycleId: cycle._id }, { session });
      await Billing.deleteMany({ billingCycleId: cycle._id }, { session });
      await BillingCycle.deleteOne({ _id: cycle._id }, { session });
      if (applicationId) {
        await Application.updateOne(
          { applicationId },
          { $set: { billingStarted: false }, $unset: { billingCycleId: "" } },
          { session },
        );
      }
      await session.commitTransaction();
      eventService.emitBillingCycleDeleted({
        billingCycleId,
        applicationId,
        reason: "Deleted by admin",
      });
      eventService.emitDashboardUpdate({
        reason: "Billing cycle deleted - FORCE REFRESH",
        billingCycleId,
        applicationId,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res
        .status(200)
        .json({ success: true, message: "Billing cycle deleted successfully" });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in deleteBillingCycle:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to delete billing cycle",
        error: error.message,
      });
    }
  });
};

export const deleteBill = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId } = req.params;
      const { reason } = req.body;
      if (!billId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "Bill ID is required" });
      }
      const bill = await Billing.findById(billId).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Bill not found" });
      }
      if (bill.status === "paid") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Cannot delete a paid bill.",
        });
      }
      let application = null;
      if (bill.applicationId) {
        application = await Application.findOne({
          applicationId: bill.applicationId,
        })
          .select("firstName lastName email applicationId")
          .session(session)
          .lean();
      }
      await Invoice.deleteMany({ billingId: bill._id }, { session });
      await Payment.deleteMany(
        { billingId: bill._id, status: "pending" },
        { session },
      );
      if (bill.billingCycleId) {
        await BillingCycle.updateOne(
          { _id: bill.billingCycleId },
          { $pull: { paymentHistory: { billingId: bill._id } } },
          { session },
        );
        if (bill.isInstallationBill) {
          await BillingCycle.updateOne(
            { _id: bill.billingCycleId },
            {
              $unset: { installationFeeBillId: "" },
              $set: { installationFeePaid: false },
            },
            { session },
          );
        }
        if (bill.isProRated) {
          await BillingCycle.updateOne(
            { _id: bill.billingCycleId },
            {
              $set: {
                proRatedPaid: false,
                proRatedPaidAt: null,
                currentProRatedAmount: 0,
              },
            },
            { session },
          );
        }
      }
      await Billing.deleteOne({ _id: bill._id }, { session });
      await session.commitTransaction();
      eventService.emitDashboardUpdate({
        reason: "Bill deleted - FORCE REFRESH",
        billId,
        applicationId: bill.applicationId,
        invoiceNumber: bill.invoiceNumber,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: `Bill ${bill.invoiceNumber} deleted successfully`,
        data: {
          deletedBillId: billId,
          invoiceNumber: bill.invoiceNumber,
          applicationId: bill.applicationId,
          customerName: application
            ? `${application.firstName} ${application.lastName}`
            : undefined,
          wasInstallationBill: bill.isInstallationBill,
          wasProRated: bill.isProRated,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in deleteBill:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to delete bill",
        error: error.message,
      });
    }
  });
};

export const confirmProRatedPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId, paymentDetails } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
      }
      const application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Application not found" });
      }
      const cycle = await BillingCycle.findOne({
        applicationId: application.applicationId,
        status: "pending_activation",
      })
        .populate("planId")
        .lean();
      if (!cycle) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Billing cycle not found" });
      }
      const bill = await Billing.findOne({
        applicationId: application.applicationId,
        billingCycleId: cycle._id,
        isProRated: true,
        status: "pending_confirmation",
        isInstallationBill: false,
      }).lean();
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Pro-rated bill not found" });
      }
      await Billing.updateOne(
        { _id: bill._id },
        { $set: { status: "paid", paidAt: new Date() } },
        { session },
      );
      const inv = await Invoice.findOne({ billingId: bill._id }).session(
        session,
      );
      if (inv) {
        inv.status = "paid";
        inv.paidAt = new Date();
        await inv.save({ session });
      }
      const payment = await Payment.create(
        [
          {
            amount: bill.total,
            paymentMethod: "manual",
            paymentType: "pro_rated",
            status: "completed",
            referenceNumber: `PRO-${Date.now()}`,
            billingId: bill._id,
            paymentDetails: {
              gateway: "manual",
              gatewayResponse: paymentDetails,
              notes: "Pro-rated payment confirmed",
            },
            paidAt: new Date(),
            applicationId: application.applicationId,
          },
        ],
        { session },
      );
      await Billing.updateOne(
        { _id: bill._id },
        { $set: { paymentId: payment[0]._id } },
        { session },
      );
      await BillingCycle.updateOne(
        { _id: cycle._id },
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
      eventService.emitBillingPaid({
        billId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        applicationId: application.applicationId,
        paymentId: payment[0]._id,
        amount: bill.total,
        isProRated: true,
        customerName: `${application.firstName} ${application.lastName}`,
      });
      eventService.emitBillingCycleUpdated({
        billingCycleId: cycle._id,
        applicationId: application.applicationId,
        status: "active",
        customerName: `${application.firstName} ${application.lastName}`,
      });
      eventService.emitPaymentConfirmed({
        payment: payment[0],
        billingId: bill._id,
        applicationId: application.applicationId,
        type: "pro-rated",
      });
      eventService.emitDashboardUpdate({
        reason: "Pro-rated payment confirmed",
        applicationId: application.applicationId,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      const adminId = getRequestingAdminId(req);
      try {
        await sendPaidOrFreeInvoiceEmail(bill, application, payment[0], {
          isFree: false,
          adminId,
        });
      } catch (e) {
        console.error("Pro-rated paid email failed:", e);
      }
      return res
        .status(200)
        .json({ success: true, message: "Pro-rated payment confirmed" });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in confirmProRatedPayment:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to confirm pro-rated payment",
        error: error.message,
      });
    }
  });
};

export const startMonthlyBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { applicationId } = req.body;
      if (!applicationId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "applicationId is required" });
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
      const cycle = await BillingCycle.findOne({
        applicationId: application.applicationId,
        status: "pending_activation",
        proRatedPaid: true,
      })
        .populate("planId")
        .lean();
      if (!cycle) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Billing cycle not found" });
      }
      const settings = await getOrCreateSettings();
      const todayLocal = new Date();
      todayLocal.setHours(0, 0, 0, 0);
      const billingStartLocal = getFirstDayOfMonth(todayLocal);
      const billingEndLocal = getEndOfMonth(billingStartLocal);
      const plan = cycle.planId as any;
      const monthlyBill = await createMonthlyBill(
        application,
        cycle._id,
        billingStartLocal,
        billingEndLocal,
        plan.price,
        settings,
        session,
        req,
      );
      const nextLocal = getFirstDayOfMonth(
        getStartOfNextMonth(billingStartLocal),
      );
      await BillingCycle.updateOne(
        { _id: cycle._id },
        {
          $set: {
            status: "active",
            manualBillStart: true,
            manuallyStartedAt: new Date(),
            nextBillingDate: toStorageDate(nextLocal),
          },
        },
        { session },
      );
      await session.commitTransaction();
      if (monthlyBill) {
        eventService.emitBillingCreated({
          billing: monthlyBill,
          applicationId: application.applicationId,
          type: "monthly",
          customerName: `${application.firstName} ${application.lastName}`,
        });
      }
      eventService.emitBillingCycleUpdated({
        billingCycleId: cycle._id,
        applicationId: application.applicationId,
        status: "active",
        customerName: `${application.firstName} ${application.lastName}`,
      });
      eventService.emitDashboardUpdate({
        reason: "Monthly billing started",
        applicationId: application.applicationId,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: "Monthly billing started",
        data: { firstMonthlyBill: monthlyBill },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in startMonthlyBilling:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to start monthly billing",
        error: error.message,
      });
    }
  });
};

export const autoGenerateMonthlyBills = async (
  req?: AuthRequest,
  res?: Response,
) => {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.autoGenerateBills) {
      if (res)
        return res.status(200).json({
          success: true,
          message: "Auto-generate bills is disabled",
        });
      return;
    }
    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);
    const nextMonthLocal = getStartOfNextMonth(todayLocal);
    const nextMonthEndLocal = getEndOfMonth(nextMonthLocal);
    const dueDateStorage = getDueDateForMonthly(nextMonthLocal, settings);

    const cycles = await BillingCycle.find({
      status: "active",
      proRatedPaid: true,
      applicationId: { $exists: true, $ne: null },
    })
      .populate("planId")
      .lean();

    const appIds = cycles.map((c) => c.applicationId).filter((id) => id);
    const apps = await Application.find({
      applicationId: { $in: appIds },
    }).lean();
    const map = new Map(apps.map((a) => [a.applicationId, a]));

    const { y, m } = extractYMD(nextMonthLocal);
    const existingBills = await Billing.find({
      billingCycleId: { $in: cycles.map((c) => c._id) },
      isProRated: false,
      isInstallationBill: false,
      "billingPeriod.start": {
        $gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        $lte: new Date(Date.UTC(y, m + 1, 0, 0, 0, 0, 0)),
      },
    }).lean();
    const existingCycleIds = new Set(
      existingBills.map((b) => b.billingCycleId.toString()),
    );

    let generated = 0;
    let skipped = 0;
    let alreadyGenerated = 0;
    const bills: any[] = [];

    for (const c of cycles) {
      if (!c.applicationId) {
        skipped++;
        continue;
      }
      const app = map.get(c.applicationId);
      if (!app) {
        skipped++;
        continue;
      }
      const plan = c.planId as any;
      if (!plan) {
        skipped++;
        continue;
      }
      if (existingCycleIds.has(c._id.toString())) {
        alreadyGenerated++;
        continue;
      }
      const newBill = await createMonthlyBill(
        app,
        c._id,
        nextMonthLocal,
        nextMonthEndLocal,
        plan.price,
        settings,
        undefined,
        req,
      );
      generated++;
      bills.push(newBill);
    }

    if (generated > 0) {
      for (const b of bills) {
        eventService.emitBillingCreated({
          billing: b,
          applicationId: b.applicationId,
          type: "monthly",
          autoGenerated: true,
        });
      }
      eventService.emitDashboardUpdate({
        reason: "Auto-generated monthly bills - FORCE REFRESH",
        count: generated,
        forceRefresh: true,
        timestamp: Date.now(),
      });
    }

    if (res) {
      res.status(200).json({
        success: true,
        message: `Generated ${generated} bills for ${formatDateForDisplay(nextMonthLocal)}`,
        data: {
          generated,
          alreadyGenerated,
          skipped,
          billingMonth: formatDateForDisplay(nextMonthLocal),
          dueDate: formatDateForDisplay(fromStorageDate(dueDateStorage)),
          generationDate: formatDateForDisplay(todayLocal),
        },
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
    const overdue = await Billing.find({
      status: "overdue",
      dueDate: { $lt: gracePeriodDate },
      suspensionNotified: { $ne: true },
      applicationId: { $exists: true, $ne: null },
      isInstallationBill: false,
    }).lean();
    let suspended = 0;
    for (const bill of overdue) {
      if (!bill.applicationId) continue;
      await Billing.updateOne(
        { _id: bill._id },
        { $set: { suspensionNotified: true } },
      );
      await Application.updateOne(
        { applicationId: bill.applicationId },
        { $set: { status: "suspended" } },
      );
      suspended++;
    }
    if (suspended > 0) {
      eventService.emitSuspensionUpdated({
        count: suspended,
        type: "auto_suspend",
        timestamp: new Date(),
      });
      eventService.emitDashboardUpdate({
        reason: "Auto-suspended overdue customers",
        count: suspended,
        forceRefresh: true,
        timestamp: Date.now(),
      });
    }
    if (res) {
      res
        .status(200)
        .json({ success: true, message: `Suspended ${suspended} customers` });
    }
  } catch (error) {
    console.error("Auto-suspend overdue error:", error);
    if (res)
      res
        .status(500)
        .json({ success: false, message: "Failed to suspend customers" });
  }
};

export const submitProRatedPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId, referenceNumber, notes } = req.body;
      const userId = req.user?._id || req.user?.id;
      if (!billId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "billId is required" });
      }
      const bill = await Billing.findOne({
        _id: billId,
        isInstallationBill: false,
      }).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Bill not found" });
      }
      let isOwner = false;
      if (bill.userId && String(bill.userId) === String(userId)) isOwner = true;
      else if (bill.applicationId) {
        const u = await User.findById(userId)
          .select("applicationId")
          .session(session)
          .lean();
        if (u?.applicationId === bill.applicationId) isOwner = true;
      }
      if (!isOwner) {
        await session.abortTransaction();
        return res
          .status(403)
          .json({ success: false, message: "You do not own this bill" });
      }
      if (bill.status === "paid") {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "Bill already paid" });
      }
      if (bill.status === "pending_confirmation") {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "Payment already pending" });
      }
      await Billing.updateOne(
        { _id: bill._id },
        { $set: { status: "pending_confirmation" } },
        { session },
      );
      const correctType = bill.isProRated ? "pro_rated" : "subscription";
      const payment = await Payment.create(
        [
          {
            userId,
            amount: bill.total,
            paymentMethod: "manual",
            paymentType: correctType,
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
      eventService.emitPaymentCreated({
        paymentId: payment[0]._id,
        billingId: bill._id,
        applicationId: bill.applicationId,
        amount: bill.total,
        type: correctType,
      });
      eventService.emitDashboardUpdate({
        reason: "Payment submitted - FORCE REFRESH",
        billingId: bill._id,
        applicationId: bill.applicationId,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message: "Payment submitted! Awaiting admin confirmation.",
        data: { status: "pending_confirmation", paymentType: correctType },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in submitProRatedPayment:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to submit payment",
        error: error.message,
      });
    }
  });
};

export const submitInstallationPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId, referenceNumber, notes } = req.body;
      const userId = req.user?._id || req.user?.id;
      if (!billId) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "billId is required" });
      }
      const bill = await Billing.findOne({
        _id: billId,
        isInstallationBill: true,
      }).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Installation bill not found" });
      }
      let isOwner = false;
      if (bill.userId && String(bill.userId) === String(userId)) isOwner = true;
      else if (bill.applicationId) {
        const u = await User.findById(userId)
          .select("applicationId")
          .session(session)
          .lean();
        if (u?.applicationId === bill.applicationId) isOwner = true;
      }
      if (!isOwner) {
        await session.abortTransaction();
        return res
          .status(403)
          .json({ success: false, message: "You do not own this bill" });
      }
      if (bill.installationFeePaid) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "Installation fee already paid" });
      }
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
            paymentType: "installation",
            status: "pending",
            referenceNumber: referenceNumber || `INST-PAY-${Date.now()}`,
            billingId: bill._id,
            applicationId: bill.applicationId,
            paymentDetails: {
              gateway: "manual",
              gatewayResponse: {
                submittedAt: new Date(),
                notes: notes || "Installation fee submitted",
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
      eventService.emitPaymentCreated({
        paymentId: payment[0]._id,
        billingId: bill._id,
        applicationId: bill.applicationId,
        amount: bill.total,
        type: "installation",
      });
      eventService.emitDashboardUpdate({
        reason: "Installation payment submitted - FORCE REFRESH",
        billingId: bill._id,
        applicationId: bill.applicationId,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      return res.status(200).json({
        success: true,
        message:
          "Installation fee payment submitted! Awaiting admin confirmation.",
        data: { status: "pending_confirmation" },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in submitInstallationPayment:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to submit installation payment",
        error: error.message,
      });
    }
  });
};

export const submitMonthlyPayment = submitProRatedPayment;

export const markInstallationBillAsPaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId } = req.params;
      const { referenceNumber, notes } = req.body;
      const adminId = getRequestingAdminId(req);
      const bill = await Billing.findById(billId).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Bill not found" });
      }
      if (!bill.isInstallationBill) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "Not an installation bill" });
      }
      if (bill.status === "paid") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Bill ${bill.invoiceNumber} is already paid`,
        });
      }
      let application = null;
      if (bill.applicationId) {
        application = await Application.findOne({
          applicationId: bill.applicationId,
        })
          .select(
            "firstName lastName email phoneNumber applicationId buildingName",
          )
          .session(session)
          .lean();
      }
      const paymentData: any = {
        amount: bill.total,
        paymentMethod: "manual",
        paymentType: "installation",
        status: "completed",
        referenceNumber: referenceNumber || `INST-ADMIN-${Date.now()}`,
        billingId: bill._id,
        paymentDetails: {
          gateway: "manual",
          gatewayResponse: {
            confirmedBy: adminId,
            confirmedAt: new Date(),
            notes: notes || "Installation fee marked as paid",
            applicationId: bill.applicationId,
          },
        },
        paidAt: new Date(),
      };
      if (application) paymentData.applicationId = application.applicationId;
      const payment = await Payment.create([paymentData], { session });
      await Billing.updateOne(
        { _id: bill._id },
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
      const inv = await Invoice.findOne({ billingId: bill._id }).session(
        session,
      );
      if (inv) {
        inv.status = "paid";
        inv.paidAt = new Date();
        inv.paymentId = payment[0]._id;
        await inv.save({ session });
      }
      if (bill.billingCycleId) {
        await BillingCycle.updateOne(
          { _id: bill.billingCycleId },
          {
            $set: { installationFeePaid: true },
            $push: {
              paymentHistory: {
                billingId: bill._id,
                amount: bill.total,
                paidAt: new Date(),
              },
            },
          },
          { session },
        );
      }
      if (application) {
        await Application.updateOne(
          { applicationId: application.applicationId },
          {
            $set: {
              installationFeePaid: true,
              installationFeePaidAt: new Date(),
            },
          },
          { session },
        );
      }
      await session.commitTransaction();
      eventService.emitBillingPaid({
        billId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        applicationId: bill.applicationId,
        paymentId: payment[0]._id,
        amount: bill.total,
        isInstallation: true,
        customerName: application
          ? `${application.firstName} ${application.lastName}`
          : undefined,
      });
      eventService.emitPaymentConfirmed({
        payment: payment[0],
        billingId: bill._id,
        applicationId: bill.applicationId,
        type: "installation",
      });
      eventService.emitDashboardUpdate({
        reason: "Installation fee paid - FORCE REFRESH",
        applicationId: bill.applicationId,
        billId: bill._id,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      let emailSent = false;
      if (application) {
        try {
          emailSent = await sendPaidOrFreeInvoiceEmail(
            bill,
            application,
            payment[0],
            { isFree: false, adminId },
          );
        } catch (e) {
          console.error("Installation paid email failed:", e);
        }
      }
      return res.status(200).json({
        success: true,
        message: `Installation bill ${bill.invoiceNumber} marked as paid${emailSent ? " and receipt emailed" : ""}`,
        data: {
          billId: bill._id,
          invoiceNumber: bill.invoiceNumber,
          paymentId: payment[0]._id,
          installationFeePaid: true,
          emailSent,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in markInstallationBillAsPaid:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to mark installation bill as paid",
        error: error.message,
      });
    }
  });
};

export const markBillAsPaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId } = req.params;
      const { referenceNumber, notes } = req.body;
      const adminId = getRequestingAdminId(req);
      const bill = await Billing.findById(billId).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Bill not found" });
      }
      if (bill.isInstallationBill) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Use installation bill payment endpoint for installation",
        });
      }
      if (bill.status === "paid") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Bill ${bill.invoiceNumber} is already paid`,
        });
      }
      let application = null;
      if (bill.applicationId) {
        application = await Application.findOne({
          applicationId: bill.applicationId,
        }).lean();
      }
      const correctType = bill.isProRated ? "pro_rated" : "subscription";
      const paymentData: any = {
        amount: bill.total,
        paymentMethod: "manual",
        paymentType: correctType,
        status: "completed",
        referenceNumber: referenceNumber || `ADMIN-${Date.now()}`,
        billingId: bill._id,
        paymentDetails: {
          gateway: "manual",
          gatewayResponse: {
            confirmedBy: adminId,
            confirmedAt: new Date(),
            notes: notes || "Manually marked as paid",
            applicationId: bill.applicationId,
          },
        },
        paidAt: new Date(),
      };
      if (application) paymentData.applicationId = application.applicationId;
      const payment = await Payment.create([paymentData], { session });
      await Billing.updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "paid",
            paymentId: payment[0]._id,
            paidAt: new Date(),
          },
        },
        { session },
      );
      const inv = await Invoice.findOne({ billingId: bill._id }).session(
        session,
      );
      if (inv) {
        inv.status = "paid";
        inv.paidAt = new Date();
        inv.paymentId = payment[0]._id;
        await inv.save({ session });
      }
      const cycle = await BillingCycle.findById(bill.billingCycleId).session(
        session,
      );
      if (cycle) {
        cycle.paymentHistory = cycle.paymentHistory || [];
        cycle.paymentHistory.push({
          billingId: bill._id,
          amount: bill.total,
          paidAt: new Date(),
        });
        if (bill.isProRated && !cycle.proRatedPaid) {
          cycle.proRatedPaid = true;
          cycle.proRatedPaidAt = new Date();
          if (cycle.status === "pending_activation") cycle.status = "active";
        }
        await cycle.save({ session });
      }
      await session.commitTransaction();
      eventService.emitBillingPaid({
        billId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        applicationId: bill.applicationId,
        paymentId: payment[0]._id,
        amount: bill.total,
        isInstallation: false,
        isProRated: bill.isProRated || false,
        customerName: application
          ? `${application.firstName} ${application.lastName}`
          : undefined,
      });
      eventService.emitPaymentConfirmed({
        payment: payment[0],
        billingId: bill._id,
        applicationId: bill.applicationId,
        type: correctType,
      });
      eventService.emitDashboardUpdate({
        reason: "Bill marked as paid - FORCE REFRESH",
        applicationId: bill.applicationId,
        billId: bill._id,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      let emailSent = false;
      if (application) {
        try {
          emailSent = await sendPaidOrFreeInvoiceEmail(
            bill,
            application,
            payment[0],
            { isFree: false, adminId },
          );
        } catch (e) {
          console.error("Paid email failed:", e);
        }
      }
      return res.status(200).json({
        success: true,
        message: `Bill ${bill.invoiceNumber} marked as paid${emailSent ? " and receipt emailed" : ""}`,
        data: {
          billId: bill._id,
          invoiceNumber: bill.invoiceNumber,
          paymentId: payment[0]._id,
          paymentType: correctType,
          emailSent,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in markBillAsPaid:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to mark bill as paid",
        error: error.message,
      });
    }
  });
};

export const markBillAsFree = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId } = req.params;
      const { notes } = req.body;
      const adminId = getRequestingAdminId(req);
      const bill = await Billing.findById(billId).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Bill not found" });
      }
      if (bill.status === "paid") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Bill ${bill.invoiceNumber} is already paid`,
        });
      }
      if (bill.isInstallationBill) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Use installation free endpoint for installation fees",
        });
      }
      let application = null;
      if (bill.applicationId) {
        application = await Application.findOne({
          applicationId: bill.applicationId,
        }).lean();
      }
      const correctType = bill.isProRated ? "pro_rated" : "subscription";
      const paymentData: any = {
        amount: 0,
        paymentMethod: "free",
        paymentType: correctType,
        status: "completed",
        referenceNumber: `FREE-${Date.now()}`,
        billingId: bill._id,
        paymentDetails: {
          gateway: "free",
          gatewayResponse: {
            confirmedBy: adminId,
            confirmedAt: new Date(),
            notes: notes || "Marked as free",
            applicationId: bill.applicationId,
            isFree: true,
          },
          notes: notes || "Marked as free",
          isFree: true,
        },
        paidAt: new Date(),
      };
      if (application) {
        paymentData.applicationId = application.applicationId;
        paymentData.customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        paymentData.customerEmail = application.email || "";
        paymentData.customerPhone = application.phoneNumber || "";
      }
      const payment = await Payment.create([paymentData], { session });
      await Billing.updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "paid",
            paymentId: payment[0]._id,
            paidAt: new Date(),
            total: 0,
            subtotal: 0,
            items: bill.items.map((item: any) => ({
              ...item,
              amount: 0,
              rate: 0,
            })),
          },
        },
        { session },
      );
      const inv = await Invoice.findOne({ billingId: bill._id }).session(
        session,
      );
      if (inv) {
        inv.status = "paid";
        inv.paidAt = new Date();
        inv.paymentId = payment[0]._id;
        inv.total = 0;
        inv.subtotal = 0;
        inv.items = inv.items.map((item: any) => ({
          ...item,
          amount: 0,
          rate: 0,
        }));
        await inv.save({ session });
      }
      const cycle = await BillingCycle.findById(bill.billingCycleId).session(
        session,
      );
      if (cycle) {
        cycle.paymentHistory = cycle.paymentHistory || [];
        cycle.paymentHistory.push({
          billingId: bill._id,
          amount: 0,
          paidAt: new Date(),
        });
        if (bill.isProRated && !cycle.proRatedPaid) {
          cycle.proRatedPaid = true;
          cycle.proRatedPaidAt = new Date();
          if (cycle.status === "pending_activation") cycle.status = "active";
        }
        await cycle.save({ session });
      }
      await session.commitTransaction();
      eventService.emitBillingPaid({
        billId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        applicationId: bill.applicationId,
        paymentId: payment[0]._id,
        amount: 0,
        isInstallation: false,
        isProRated: bill.isProRated || false,
        customerName: application
          ? `${application.firstName} ${application.lastName}`
          : undefined,
      });
      eventService.emitPaymentConfirmed({
        payment: payment[0],
        billingId: bill._id,
        applicationId: bill.applicationId,
        type: correctType,
      });
      eventService.emitDashboardUpdate({
        reason: "Bill marked as free - FORCE REFRESH",
        applicationId: bill.applicationId,
        billId: bill._id,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      let emailSent = false;
      if (application) {
        try {
          emailSent = await sendPaidOrFreeInvoiceEmail(
            bill,
            application,
            payment[0],
            { isFree: true, adminId },
          );
        } catch (e) {
          console.error("Free email failed:", e);
        }
      }
      return res.status(200).json({
        success: true,
        message: `Bill ${bill.invoiceNumber} marked as FREE${emailSent ? " and receipt emailed" : ""}`,
        data: {
          billId: bill._id,
          invoiceNumber: bill.invoiceNumber,
          paymentId: payment[0]._id,
          isFree: true,
          paymentType: correctType,
          emailSent,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in markBillAsFree:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to mark bill as free",
        error: error.message,
      });
    }
  });
};

export const markInstallationBillAsFree = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  await withRetry(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { billId } = req.params;
      const { notes } = req.body;
      const adminId = getRequestingAdminId(req);
      const bill = await Billing.findById(billId).session(session);
      if (!bill) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Bill not found" });
      }
      if (!bill.isInstallationBill) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ success: false, message: "Not an installation bill" });
      }
      if (bill.status === "paid") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Bill ${bill.invoiceNumber} is already paid`,
        });
      }
      let application = null;
      if (bill.applicationId) {
        application = await Application.findOne({
          applicationId: bill.applicationId,
        })
          .select(
            "firstName lastName email phoneNumber applicationId buildingName",
          )
          .session(session)
          .lean();
      }
      const paymentData: any = {
        amount: 0,
        paymentMethod: "free",
        paymentType: "installation",
        status: "completed",
        referenceNumber: `FREE-INST-${Date.now()}`,
        billingId: bill._id,
        paymentDetails: {
          gateway: "free",
          gatewayResponse: {
            confirmedBy: adminId,
            confirmedAt: new Date(),
            notes: notes || "Installation fee marked as free",
            applicationId: bill.applicationId,
            isFree: true,
          },
          notes: notes || "Installation fee marked as free",
          isFree: true,
        },
        paidAt: new Date(),
      };
      if (application) {
        paymentData.applicationId = application.applicationId;
        paymentData.customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        paymentData.customerEmail = application.email || "";
        paymentData.customerPhone = application.phoneNumber || "";
      }
      const payment = await Payment.create([paymentData], { session });
      await Billing.updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "paid",
            paymentId: payment[0]._id,
            paidAt: new Date(),
            installationFeePaid: true,
            total: 0,
            subtotal: 0,
            items: bill.items.map((item: any) => ({
              ...item,
              amount: 0,
              rate: 0,
            })),
          },
        },
        { session },
      );
      const inv = await Invoice.findOne({ billingId: bill._id }).session(
        session,
      );
      if (inv) {
        inv.status = "paid";
        inv.paidAt = new Date();
        inv.paymentId = payment[0]._id;
        inv.total = 0;
        inv.subtotal = 0;
        inv.items = inv.items.map((item: any) => ({
          ...item,
          amount: 0,
          rate: 0,
        }));
        await inv.save({ session });
      }
      if (bill.billingCycleId) {
        await BillingCycle.updateOne(
          { _id: bill.billingCycleId },
          {
            $set: { installationFeePaid: true },
            $push: {
              paymentHistory: {
                billingId: bill._id,
                amount: 0,
                paidAt: new Date(),
              },
            },
          },
          { session },
        );
      }
      if (application) {
        await Application.updateOne(
          { applicationId: application.applicationId },
          {
            $set: {
              installationFeePaid: true,
              installationFeePaidAt: new Date(),
            },
          },
          { session },
        );
      }
      await session.commitTransaction();
      eventService.emitBillingPaid({
        billId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        applicationId: bill.applicationId,
        paymentId: payment[0]._id,
        amount: 0,
        isInstallation: true,
        customerName: application
          ? `${application.firstName} ${application.lastName}`
          : undefined,
      });
      eventService.emitPaymentConfirmed({
        payment: payment[0],
        billingId: bill._id,
        applicationId: bill.applicationId,
        type: "installation",
      });
      eventService.emitDashboardUpdate({
        reason: "Installation fee marked as free",
        applicationId: bill.applicationId,
        billId: bill._id,
        forceRefresh: true,
        timestamp: Date.now(),
      });
      let emailSent = false;
      if (application) {
        try {
          emailSent = await sendPaidOrFreeInvoiceEmail(
            bill,
            application,
            payment[0],
            { isFree: true, adminId },
          );
        } catch (e) {
          console.error("Installation free email failed:", e);
        }
      }
      return res.status(200).json({
        success: true,
        message: `Installation bill ${bill.invoiceNumber} marked as FREE${emailSent ? " and receipt emailed" : ""}`,
        data: {
          billId: bill._id,
          invoiceNumber: bill.invoiceNumber,
          paymentId: payment[0]._id,
          installationFeePaid: true,
          isFree: true,
          emailSent,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }).catch((error) => {
    console.error("Error in markInstallationBillAsFree:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to mark installation bill as free",
        error: error.message,
      });
    }
  });
};

export const autoGenerateEarlyBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const settings = await getOrCreateSettings();
    const earlyDays = settings.earlyBillGenerationDays || 15;
    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);
    const currentMonthStartLocal = getFirstDayOfMonth(todayLocal);
    const nextMonthLocal = new Date(currentMonthStartLocal);
    nextMonthLocal.setMonth(currentMonthStartLocal.getMonth() + 1);
    const nextMonthStartLocal = getFirstDayOfMonth(nextMonthLocal);
    const nextMonthEndLocal = getEndOfMonth(nextMonthStartLocal);
    const daysUntilNextMonth = Math.ceil(
      (nextMonthStartLocal.getTime() - todayLocal.getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (daysUntilNextMonth > earlyDays) {
      return res.status(200).json({
        success: true,
        message: `Too early. ${daysUntilNextMonth} days until next month, need ${earlyDays} days or less.`,
        data: {
          generated: 0,
          daysUntilNextMonth,
          earlyBillGenerationDays: earlyDays,
        },
      });
    }
    const cycles = await BillingCycle.find({
      status: "active",
      proRatedPaid: true,
      applicationId: { $exists: true, $ne: null },
    })
      .populate("planId")
      .lean();
    const appIds = cycles.map((c) => c.applicationId).filter((id) => id);
    const apps = await Application.find({
      applicationId: { $in: appIds },
    }).lean();
    const map = new Map(apps.map((a) => [a.applicationId, a]));
    const { y, m } = extractYMD(nextMonthStartLocal);
    const existing = await Billing.find({
      billingCycleId: { $in: cycles.map((c) => c._id) },
      isProRated: false,
      isInstallationBill: false,
      "billingPeriod.start": {
        $gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        $lte: new Date(Date.UTC(y, m + 1, 0, 0, 0, 0, 0)),
      },
    }).lean();
    const existingIds = new Set(
      existing.map((b) => b.billingCycleId.toString()),
    );
    let generated = 0;
    let skipped = 0;
    const bills: any[] = [];
    for (const c of cycles) {
      if (!c.applicationId) {
        skipped++;
        continue;
      }
      const app = map.get(c.applicationId);
      if (!app) {
        skipped++;
        continue;
      }
      const plan = c.planId as any;
      if (!plan) {
        skipped++;
        continue;
      }
      if (existingIds.has(c._id.toString())) {
        skipped++;
        continue;
      }
      const newBill = await createMonthlyBill(
        app,
        c._id,
        nextMonthStartLocal,
        nextMonthEndLocal,
        plan.price,
        settings,
        undefined,
        req,
      );
      generated++;
      bills.push(newBill);
    }
    if (generated > 0) {
      for (const b of bills) {
        eventService.emitBillingCreated({
          billing: b,
          applicationId: b.applicationId,
          type: "monthly",
          autoGenerated: true,
        });
      }
      eventService.emitDashboardUpdate({
        reason: "Auto-generated early bills - FORCE REFRESH",
        count: generated,
        forceRefresh: true,
        timestamp: Date.now(),
      });
    }
    res.status(200).json({
      success: true,
      message: `Generated ${generated} early bills for next month (${formatDateForDisplay(nextMonthStartLocal)})`,
      data: {
        generated,
        skipped,
        nextMonth: formatDateForDisplay(nextMonthStartLocal),
        daysUntilNextMonth,
        earlyBillGenerationDays: earlyDays,
        generatedBills: bills,
      },
    });
  } catch (error) {
    console.error("Error auto-generating early bills:", error);
    next(error);
  }
};

export const updateBillPrice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { billId } = req.params;
    const { total, subtotal, items } = req.body;
    if (!billId) {
      return res
        .status(400)
        .json({ success: false, message: "Bill ID is required" });
    }
    const bill = await Billing.findById(billId);
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }
    if (bill.status === "paid") {
      return res
        .status(400)
        .json({ success: false, message: "Cannot update a paid bill" });
    }
    const updateData: any = {};
    if (total !== undefined) {
      updateData.total = total;
      updateData.subtotal = total;
    }
    if (subtotal !== undefined) updateData.subtotal = subtotal;
    if (items !== undefined && Array.isArray(items) && items.length > 0) {
      updateData.items = items;
      const newSubtotal = items.reduce(
        (sum, item) => sum + (item.amount || 0),
        0,
      );
      updateData.subtotal = newSubtotal;
      if (total === undefined) updateData.total = newSubtotal;
    }
    if (total !== undefined && (!items || items.length === 0)) {
      const existingItems = bill.items || [];
      if (existingItems.length > 0) {
        const updated = [...existingItems];
        const first = updated[0];
        if (first) {
          const newRate = total;
          const newQty = first.quantity || 1;
          updated[0] = {
            ...first,
            rate: newRate,
            amount: newRate * newQty,
          };
          updateData.items = updated;
          const newSubtotal = updated.reduce((s, i) => s + (i.amount || 0), 0);
          updateData.subtotal = newSubtotal;
          updateData.total = newSubtotal;
        }
      } else {
        updateData.items = [
          {
            description: "Monthly Subscription (Updated)",
            quantity: 1,
            rate: total,
            amount: total,
          },
        ];
        updateData.subtotal = total;
        updateData.total = total;
      }
    }
    const updated = await Billing.findByIdAndUpdate(
      billId,
      { $set: updateData },
      { new: true, runValidators: true },
    ).lean();
    const inv = await Invoice.findOne({ billingId: billId });
    if (inv) {
      await Invoice.findByIdAndUpdate(inv._id, {
        $set: {
          total: updated.total,
          subtotal: updated.subtotal,
          items: updated.items,
        },
      });
    }
    eventService.emitBillingUpdated({ billId });
    eventService.emitDashboardUpdate({
      reason: "Bill price updated - FORCE REFRESH",
      billId,
      forceRefresh: true,
      timestamp: Date.now(),
    });
    res.status(200).json({
      success: true,
      message: `Bill price updated from ₱${bill.total} to ₱${updated.total}`,
      data: updated,
    });
  } catch (error) {
    console.error("Error updating bill price:", error);
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
  deleteBill,
  getBillingSettings,
  updateBillingSettings,
  getBillingSettingsAdmin,
  updateBillingSettingsAdmin,
  getBillingSummaryAdmin,
  getAllBillingCycles,
  getAllBills,
  markBillAsPaid,
  markBillAsFree,
  markInstallationBillAsPaid,
  markInstallationBillAsFree,
  getPendingProRatedBills,
  getPendingInstallationBills,
  getPendingActivations,
  confirmProRatedPayment,
  startMonthlyBilling,
  autoGenerateMonthlyBills,
  autoGenerateEarlyBills,
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
  manuallyGenerateBillsForMonth,
  getLocationEmails,
  testLocationEmail,
  getBuildingInstallationFee,
  getDashboardData,
  checkForUpdates,
  manuallyGenerateEarlyBill,
  checkForNewCustomers,
  updateBillPrice,
  getUserCurrentBilling,
  getUserBillingHistory,
};
