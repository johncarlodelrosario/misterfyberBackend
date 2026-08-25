// backend/src/controllers/billingController.ts - COMPLETE FIXED
// (COPY THIS ENTIRE FILE - 100% COMPLETE)

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
import emailService, {
  getCollectionEmailByLocation,
  getLocationFromEntity,
} from "../services/emailService";
import mongoose from "mongoose";
import { generateInvoicePDF } from "../services/pdfService";
import fs from "fs";
import path from "path";
import NodeCache from "node-cache";

type AuthRequest = Request & { user?: any };

// ==================== CACHE SYSTEM ====================
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

let billingSettingsCache: any = null;
let billingSettingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60 * 60 * 1000;

let summaryCache: { data: any; timestamp: number } | null = null;
const SUMMARY_CACHE_TTL = 2 * 60 * 1000;

// ==================== DASHBOARD DATA CACHE ====================
let dashboardDataCache: any = null;
let dashboardDataCacheTime = 0;
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000;

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

function clearAllCache(): void {
  cache.flushAll();
  billingSettingsCache = null;
  summaryCache = null;
  dashboardDataCache = null;
  dashboardDataCacheTime = 0;
  console.log("🗑️ Billing cache cleared");
}

// ============================================================
// ✅ CRITICAL: CREATE INVOICE FROM BILLING
// ============================================================
async function createInvoiceFromBilling(
  billing: any,
  application: any,
  settings: any,
): Promise<any> {
  try {
    const existingInvoice = await Invoice.findOne({
      billingId: billing._id,
    });

    if (existingInvoice) {
      return existingInvoice;
    }

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
          description: `Pro-rated (${formatDateForDisplay(billing.billingPeriod.start)} - ${formatDateForDisplay(billing.billingPeriod.end)})`,
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
            description: `Monthly Subscription - ${formatDateForDisplay(billing.billingPeriod.start)} to ${formatDateForDisplay(billing.billingPeriod.end)}`,
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
    if (isInstallationFee && isProRated) {
      invoiceType = "combined";
    } else if (isInstallationFee) {
      invoiceType = "installation";
    } else if (isProRated) {
      invoiceType = "pro-rated";
    }

    const customerAddress = application.buildingName
      ? `${application.buildingName}, ${application.buildingId?.streetAddress || ""}`
      : application.address || "N/A";

    const planName = plan?.name || "N/A";

    const location = await getLocationFromEntity(application);
    const collectionEmail = getCollectionEmailByLocation(location);

    const invoiceData = {
      invoiceNumber: generateInvoiceNumber(),
      invoiceType: invoiceType,
      applicationId: application.applicationId,

      customerName:
        `${application.firstName || ""} ${application.lastName || ""}`.trim() ||
        application.email,
      customerAddress: customerAddress,
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

      items: items,
      subtotal: subtotal,
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

      isInstallationFee: isInstallationFee,
      isProRated: isProRated,
      proRatedDays: proRatedDays,
      planName: planName,

      notes: billing.notes || "",
      termsAndConditions:
        "Please be advised that failure to settle your account on or before the due date may result in temporary service interruption.",
      location: location,
      collectionEmail: collectionEmail,
    };

    const invoice = await Invoice.create(invoiceData);
    console.log(`✅ Invoice created: ${invoice.invoiceNumber}`);
    return invoice;
  } catch (error) {
    console.error("Error creating invoice from billing:", error);
    return null;
  }
}

// ============================================================
// ✅ CRITICAL: SEND INVOICE WITH PDF
// ============================================================
async function sendInvoiceWithPDFAttachment(
  invoice: any,
  application: any,
): Promise<boolean> {
  try {
    const location = await getLocationFromEntity(application);

    const pdfBuffer = await generateInvoicePDF(invoice);

    const pdfDir = path.join(__dirname, "../../uploads/invoices");
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const pdfFileName = `${invoice.invoiceNumber}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFileName);
    fs.writeFileSync(pdfPath, pdfBuffer);

    const pdfUrl = `/uploads/invoices/${pdfFileName}`;
    await Invoice.findByIdAndUpdate(invoice._id, {
      pdfUrl: pdfUrl,
      pdfGeneratedAt: new Date(),
      status: "sent",
    });

    invoice.location = location;
    invoice.collectionEmail = getCollectionEmailByLocation(location);

    const emailSent = await emailService.sendInvoiceWithPDF(
      invoice,
      pdfBuffer,
      pdfFileName,
      location,
    );

    return emailSent;
  } catch (error) {
    console.error("Error sending invoice with PDF:", error);
    return false;
  }
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
      return await Building.findById(application.buildingId);
    }
    return null;
  } catch (error) {
    console.error("Error getting building for application:", error);
    return null;
  }
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

function getDueDateForMonthly(billingPeriodStart: Date, settings: any): Date {
  const dueDay = settings.monthlyDueDay || 5;
  const dueDate = new Date(billingPeriodStart);
  dueDate.setDate(dueDay);
  dueDate.setHours(23, 59, 59, 999);

  if (dueDate < billingPeriodStart) {
    dueDate.setMonth(dueDate.getMonth() + 1);
  }

  const lastDayOfMonth = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth() + 1,
    0,
  ).getDate();

  let targetDay = dueDay;
  if (targetDay > lastDayOfMonth) {
    targetDay = lastDayOfMonth;
  }

  dueDate.setDate(targetDay);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate;
}

function getDueDateForProRatedBeforeCutoff(
  installationDate: Date,
  settings: any,
): Date {
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

// ============================================================
// ✅ GET LOCATION EMAILS
// ============================================================
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

    res.status(200).json({
      success: true,
      data: emails,
    });
  } catch (error: any) {
    console.error("❌ Error getting location emails:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error getting location emails",
    });
  }
};

// ============================================================
// ✅ TEST LOCATION EMAIL
// ============================================================
export const testLocationEmail = async (req: AuthRequest, res: Response) => {
  try {
    const { location, email } = req.body;

    if (!location) {
      return res.status(400).json({
        success: false,
        message: "Location is required",
      });
    }

    const collectionEmail = getCollectionEmailByLocation(location);

    const result = await emailService.sendEmail(
      email || collectionEmail,
      `🧪 Test Email - Location: ${location}`,
      emailService.generateTestLocationEmailHTML(location, collectionEmail),
      false,
      location,
      {
        replyTo: process.env.SUPPORT_EMAIL || "admin@misterfyber.com",
      },
    );

    res.status(200).json({
      success: true,
      message: "Test email sent successfully",
      data: {
        location,
        collectionEmail,
        result,
      },
    });
  } catch (error: any) {
    console.error("❌ Error sending test email:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error sending test email",
    });
  }
};

// ============================================================
// ✅ GET BUILDING INSTALLATION FEE
// ============================================================
export const getBuildingInstallationFee = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { buildingId } = req.params;

    if (!buildingId) {
      return res.status(400).json({
        success: false,
        message: "Building ID is required",
      });
    }

    const building = await Building.findById(buildingId).lean();
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
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
// ✅ GET ALL BILLING CYCLES - SUPER FAST!
// ============================================================
export const getAllBillingCycles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const startTime = Date.now();
    const { limit = 100 } = req.query;
    const limitNum = parseInt(limit as string) || 100;

    const cacheKey = `billing_cycles_limit_${limitNum}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`📦 CACHE HIT! billing_cycles - ${Date.now() - startTime}ms`);
      return res.status(200).json({
        success: true,
        data: cachedData,
        cached: true,
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    console.log(`📊 FETCHING billing cycles (limit: ${limitNum})`);

    const cycles = await BillingCycle.find()
      .select(
        "userId applicationId planId billingStartDate billingEndDate nextBillingDate status monthlyRate currentProRatedAmount totalPaid balance installationFee installationFeePaid isAfterCutoff cutoffDayUsed createdAt updatedAt",
      )
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .lean()
      .maxTimeMS(3000);

    const applicationIds = cycles
      .map((c) => c.applicationId)
      .filter((id) => id)
      .filter((id, index, self) => self.indexOf(id) === index);

    let applicationsMap = new Map();
    if (applicationIds.length > 0) {
      const applications = await Application.find({
        applicationId: { $in: applicationIds },
      })
        .select(
          "applicationId firstName lastName email phoneNumber buildingName",
        )
        .lean()
        .maxTimeMS(2000);

      applications.forEach((app) => {
        applicationsMap.set(app.applicationId, app);
      });
    }

    const enrichedCycles = cycles.map((cycle) => {
      const enriched = { ...cycle };
      if (cycle.applicationId && applicationsMap.has(cycle.applicationId)) {
        (enriched as any).applicationData = applicationsMap.get(
          cycle.applicationId,
        );
      }
      return enriched;
    });

    const elapsed = Date.now() - startTime;
    console.log(`✅ ${enrichedCycles.length} cycles in ${elapsed}ms`);

    cache.set(cacheKey, enrichedCycles, 30);

    res.status(200).json({
      success: true,
      data: enrichedCycles,
      _responseTime: `${elapsed}ms`,
    });
  } catch (error) {
    console.error("Error fetching billing cycles:", error);
    next(error);
  }
};

// ============================================================
// ✅ GET ALL BILLS - SUPER FAST!
// ============================================================
export const getAllBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const startTime = Date.now();
    const { status, type, limit = 100 } = req.query;
    const limitNum = parseInt(limit as string) || 100;

    const cacheKey = `bills_${status || "all"}_${type || "all"}_limit_${limitNum}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`📦 CACHE HIT! bills - ${Date.now() - startTime}ms`);
      return res.status(200).json({
        success: true,
        data: cachedData,
        cached: true,
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    console.log(
      `📊 FETCHING bills (status: ${status || "all"}, type: ${type || "all"})`,
    );

    let query: any = {};
    if (status && status !== "all") query.status = status;
    if (type === "pro-rated") query.isProRated = true;
    if (type === "monthly") query.isProRated = false;
    if (type === "installation") query.isInstallationBill = true;

    const bills = await Billing.find(query)
      .select(
        "userId applicationId invoiceNumber billingPeriod dueDate items subtotal tax discount total status paymentId notes isProRated proRatedDays billingCycleId isInstallationBill installationFee installationFeePaid paidAt createdAt updatedAt",
      )
      .sort({ dueDate: -1 })
      .limit(limitNum)
      .lean()
      .maxTimeMS(3000);

    const applicationIds = bills
      .map((b) => b.applicationId)
      .filter((id) => id)
      .filter((id, index, self) => self.indexOf(id) === index);

    let applicationsMap = new Map();
    if (applicationIds.length > 0) {
      const applications = await Application.find({
        applicationId: { $in: applicationIds },
      })
        .select(
          "applicationId firstName lastName email phoneNumber buildingName",
        )
        .lean()
        .maxTimeMS(2000);

      applications.forEach((app) => {
        applicationsMap.set(app.applicationId, app);
      });
    }

    const enrichedBills = bills.map((bill) => {
      const enriched = { ...bill };
      if (bill.applicationId && applicationsMap.has(bill.applicationId)) {
        (enriched as any).applicationData = applicationsMap.get(
          bill.applicationId,
        );
      }
      return enriched;
    });

    const elapsed = Date.now() - startTime;
    console.log(`✅ ${enrichedBills.length} bills in ${elapsed}ms`);

    cache.set(cacheKey, enrichedBills, 30);

    res.status(200).json({
      success: true,
      data: enrichedBills,
      _responseTime: `${elapsed}ms`,
    });
  } catch (error) {
    console.error("Error fetching bills:", error);
    next(error);
  }
};

// ============================================================
// ✅ GET PENDING PRO-RATED BILLS
// ============================================================
export const getPendingProRatedBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const startTime = Date.now();
    const cacheKey = "pending_pro_rated_bills";
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({ success: true, data: cachedData });
    }

    const pendingBills = await Billing.find({
      isProRated: true,
      status: "pending_confirmation",
      isInstallationBill: false,
    })
      .select(
        "userId applicationId invoiceNumber billingPeriod dueDate items total status notes proRatedDays createdAt",
      )
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(3000);

    const appIds = pendingBills.map((b) => b.applicationId).filter(Boolean);
    let appMap = new Map();
    if (appIds.length > 0) {
      const apps = await Application.find({ applicationId: { $in: appIds } })
        .select("applicationId firstName lastName email phoneNumber")
        .lean();
      apps.forEach((a) => appMap.set(a.applicationId, a));
    }

    const enriched = pendingBills.map((bill) => {
      const b = { ...bill };
      if (bill.applicationId && appMap.has(bill.applicationId)) {
        (b as any).applicationData = appMap.get(bill.applicationId);
      }
      return b;
    });

    cache.set(cacheKey, enriched, 30);
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ GET PENDING INSTALLATION BILLS
// ============================================================
export const getPendingInstallationBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const startTime = Date.now();
    const cacheKey = "pending_installation_bills";
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({ success: true, data: cachedData });
    }

    const pendingBills = await Billing.find({
      isInstallationBill: true,
      installationFeePaid: false,
      status: { $in: ["sent", "overdue"] },
    })
      .select(
        "userId applicationId invoiceNumber billingPeriod dueDate items total status installationFee installationFeePaid notes createdAt",
      )
      .sort({ dueDate: 1 })
      .lean()
      .maxTimeMS(3000);

    const appIds = pendingBills.map((b) => b.applicationId).filter(Boolean);
    let appMap = new Map();
    if (appIds.length > 0) {
      const apps = await Application.find({ applicationId: { $in: appIds } })
        .select(
          "applicationId firstName lastName email phoneNumber buildingName",
        )
        .lean();
      apps.forEach((a) => appMap.set(a.applicationId, a));
    }

    const enriched = pendingBills.map((bill) => {
      const b = { ...bill };
      if (bill.applicationId && appMap.has(bill.applicationId)) {
        (b as any).applicationData = appMap.get(bill.applicationId);
      }
      return b;
    });

    cache.set(cacheKey, enriched, 30);
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ GET PENDING ACTIVATIONS
// ============================================================
export const getPendingActivations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const startTime = Date.now();
    const cacheKey = "pending_activations";
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({ success: true, data: cachedData });
    }

    const pendingCycles = await BillingCycle.find({
      status: "pending_activation",
      proRatedPaid: true,
      manualBillStart: false,
    })
      .select(
        "userId applicationId planId billingStartDate billingEndDate nextBillingDate status monthlyRate currentProRatedAmount proRatedPaid proRatedPaidAt installationFee createdAt",
      )
      .sort({ proRatedPaidAt: -1 })
      .lean()
      .maxTimeMS(3000);

    const appIds = pendingCycles.map((c) => c.applicationId).filter(Boolean);
    let appMap = new Map();
    if (appIds.length > 0) {
      const apps = await Application.find({ applicationId: { $in: appIds } })
        .select(
          "applicationId firstName lastName email phoneNumber buildingName",
        )
        .lean();
      apps.forEach((a) => appMap.set(a.applicationId, a));
    }

    const planIds = pendingCycles.map((c) => c.planId).filter(Boolean);
    let planMap = new Map();
    if (planIds.length > 0) {
      const plans = await Plan.find({ _id: { $in: planIds } })
        .select("_id name price")
        .lean();
      plans.forEach((p) => planMap.set(p._id.toString(), p));
    }

    const enriched = pendingCycles.map((cycle) => {
      const c = { ...cycle };
      if (cycle.applicationId && appMap.has(cycle.applicationId)) {
        (c as any).applicationData = appMap.get(cycle.applicationId);
      }
      if (cycle.planId && planMap.has(cycle.planId.toString())) {
        (c as any).planData = planMap.get(cycle.planId.toString());
      }
      return c;
    });

    cache.set(cacheKey, enriched, 30);
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ GET BILLING SUMMARY ADMIN
// ============================================================
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

    const data = {
      activeSubscriptions: totalActiveCycles,
      pausedSubscriptions: totalPausedCycles,
      pendingProRated: pendingProRated,
      pendingActivations: pendingActivations,
      overdueAccounts: overdueBills,
      totalOutstanding: outstandingResult[0]?.total || 0,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      unpaidProRated: unpaidProRated,
      unpaidInstallationFees: {
        total: unpaidInstallationFees[0]?.total || 0,
        count: unpaidInstallationFees[0]?.count || 0,
      },
    };

    summaryCache = { data, timestamp: now };
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ GET BILLING SETTINGS
// ============================================================
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
        earlyBillGenerationDays: 15,
      });
    }

    billingSettingsCache = settings;
    billingSettingsCacheTime = now;

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ UPDATE BILLING SETTINGS
// ============================================================
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

// ============================================================
// ✅ GET BILLING SETTINGS ADMIN
// ============================================================
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

// ============================================================
// ✅ UPDATE BILLING SETTINGS ADMIN
// ============================================================
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

// ============================================================
// ✅ MARK BILL AS PAID
// ============================================================
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
    if (existingBill.applicationId) {
      application = await Application.findOne({
        applicationId: existingBill.applicationId,
      }).lean();
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

    const invoice = await Invoice.findOne({
      billingId: existingBill._id,
    }).session(session);
    if (invoice) {
      invoice.status = "paid";
      invoice.paidAt = new Date();
      invoice.paymentId = payment[0]._id;
      await invoice.save({ session });
    }

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

    const location = await getLocationFromEntity(application);

    try {
      if (application && application.email) {
        const collectionEmail = getCollectionEmailByLocation(location);
        const htmlContent = emailService.generatePaymentConfirmationHTML(
          existingBill,
          payment[0],
          existingBill.total,
          new Date().toLocaleString(),
          location,
          collectionEmail,
          false,
        );

        await emailService.sendEmail(
          application.email,
          `Payment Confirmation - ${existingBill.invoiceNumber}`,
          htmlContent,
          true,
          location,
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

// ============================================================
// ✅ MARK INSTALLATION BILL AS PAID
// ============================================================
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
      }).session(session);
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

    const invoice = await Invoice.findOne({
      billingId: installationBill._id,
    }).session(session);
    if (invoice) {
      invoice.status = "paid";
      invoice.paidAt = new Date();
      invoice.paymentId = payment[0]._id;
      await invoice.save({ session });
    }

    if (installationBill.billingCycleId) {
      await BillingCycle.updateOne(
        { _id: installationBill.billingCycleId },
        {
          $set: {
            installationFeePaid: true,
          },
          $push: {
            paymentHistory: {
              billingId: installationBill._id,
              amount: installationBill.total,
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

    clearAllCache();

    const location = await getLocationFromEntity(application);
    try {
      if (application && application.email) {
        const collectionEmail = getCollectionEmailByLocation(location);
        const htmlContent = emailService.generatePaymentConfirmationHTML(
          installationBill,
          payment[0],
          installationBill.total,
          new Date().toLocaleString(),
          location,
          collectionEmail,
          true,
        );

        await emailService.sendEmail(
          application.email,
          `Installation Fee Payment Confirmation - ${installationBill.invoiceNumber}`,
          htmlContent,
          true,
          location,
        );
      }
    } catch (emailError) {
      console.error(
        "Failed to send installation fee payment confirmation email:",
        emailError,
      );
    }

    res.status(200).json({
      success: true,
      message: `Installation bill ${installationBill.invoiceNumber} marked as paid`,
      data: {
        billId: installationBill._id,
        invoiceNumber: installationBill.invoiceNumber,
        paymentId: payment[0]._id,
        installationFeePaid: true,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ============================================================
// ✅ CONFIRM PRO-RATED PAYMENT
// ============================================================
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

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "pending_activation",
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Billing cycle not found" });
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

    const invoice = await Invoice.findOne({
      billingId: proRatedBill._id,
    }).session(session);
    if (invoice) {
      invoice.status = "paid";
      invoice.paidAt = new Date();
      await invoice.save({ session });
    }

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

    const location = await getLocationFromEntity(application);

    if (application.email) {
      try {
        const collectionEmail = getCollectionEmailByLocation(location);
        const htmlContent = emailService.generatePaymentConfirmationHTML(
          proRatedBill,
          payment[0],
          proRatedBill.total,
          new Date().toLocaleString(),
          location,
          collectionEmail,
          false,
        );

        await emailService.sendEmail(
          application.email,
          "Pro-rated Payment Confirmed",
          htmlContent,
          true,
          location,
        );
      } catch (emailError) {
        console.error(
          "Failed to send pro-rated payment confirmation email:",
          emailError,
        );
      }
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

// ============================================================
// ✅ START MONTHLY BILLING
// ============================================================
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

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "pending_activation",
      proRatedPaid: true,
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Billing cycle not found" });
    }

    const settings = await getOrCreateSettings();

    const today = new Date();
    let billingStart = getFirstDayOfMonth(today);
    billingStart.setHours(0, 0, 0, 0);

    const billingEnd = getEndOfMonth(billingStart);

    const plan = billingCycle.planId as any;
    const monthlyRate = plan.price;

    const monthlyBillData: any = {
      billingCycleId: billingCycle._id,
      invoiceNumber: generateInvoiceNumber(),
      billingPeriod: { start: billingStart, end: billingEnd },
      dueDate: getDueDateForMonthly(billingStart, settings),
      items: [
        {
          description: `Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)} (PREPAID)`,
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
      notes: `Monthly subscription - PREPAID: Generated on 1st of month, Due on 5th of ${formatDateForDisplay(billingStart)}`,
      applicationId: application.applicationId,
    };

    const monthlyBill = await Billing.create([monthlyBillData], { session });
    const createdBill = monthlyBill[0];

    const invoice = await createInvoiceFromBilling(
      createdBill,
      application,
      settings,
    );
    if (invoice) {
      await sendInvoiceWithPDFAttachment(invoice, application);
    }

    const nextDate = getFirstDayOfMonth(getStartOfNextMonth(billingStart));

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
      data: { firstMonthlyBill: createdBill },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ============================================================
// ✅ START BILLING FOR APPLICATION
// ============================================================
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

    let installationFee = 0;
    if (includeInstallationFee !== false) {
      const building = await getBuildingForApplication(application);
      if (
        building &&
        building.installationFee !== undefined &&
        building.installationFee > 0
      ) {
        installationFee = building.installationFee;
        console.log(
          `🏢 Using building-specific installation fee: ₱${installationFee} for ${building.buildingName}`,
        );
      } else {
        installationFee = settings.installationFee || 1500;
        console.log(`🌐 Using global installation fee: ₱${installationFee}`);
      }
    }

    let installationDate = startDate ? new Date(startDate) : new Date();
    installationDate.setHours(0, 0, 0, 0);

    const installationDay = installationDate.getDate();
    const currentMonthEnd = getEndOfMonth(installationDate);
    const actualBillableDays = currentMonthEnd.getDate() - installationDay + 1;
    const isAfterCutoff = installationDay > billingCutoffDay;

    let createdInstallationBill: any = null;
    let createdProRatedBill: any = null;
    let createdMonthlyBill: any = null;
    let billingStatus = "active";

    if (!isAfterCutoff) {
      const proRatedAmount =
        Math.round(dailyRate * actualBillableDays * 100) / 100;
      const finalProRatedAmount = customAmount ? customAmount : proRatedAmount;

      const proRatedStartDate = installationDate;
      const proRatedEndDate = currentMonthEnd;

      const nextFullMonthStart = getStartOfNextMonth(installationDate);
      const nextFullMonthEnd = getEndOfMonth(nextFullMonthStart);
      const nextBillingDate = getFirstDayOfMonth(nextFullMonthStart);

      const billingCycle = await BillingCycle.create(
        [
          {
            planId: plan._id,
            monthlyRate: monthlyRate,
            currentProRatedAmount: finalProRatedAmount,
            proRatedPaid: false,
            actualBillableDays: actualBillableDays,
            isAfterCutoff: false,
            cutoffDayUsed: billingCutoffDay,
            applicationId: application.applicationId,
            installationFee: installationFee,
            installationFeePaid: false,
            billingStartDate: nextFullMonthStart,
            billingEndDate: nextFullMonthEnd,
            nextBillingDate: nextBillingDate,
            status: billingStatus,
          },
        ],
        { session },
      );

      // Create pro-rated bill
      const proRatedBillData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: proRatedStartDate, end: proRatedEndDate },
        dueDate: getDueDateForProRatedBeforeCutoff(installationDate, settings),
        items: [
          {
            description: `Pro-rated payment from ${formatDateForDisplay(proRatedStartDate)} to ${formatDateForDisplay(proRatedEndDate)} (${actualBillableDays} days) - Due on 25th of current month`,
            quantity: actualBillableDays,
            rate: dailyRate,
            amount: finalProRatedAmount,
          },
        ],
        subtotal: finalProRatedAmount,
        tax: 0,
        discount: 0,
        total: finalProRatedAmount,
        status: "sent",
        isProRated: true,
        proRatedDays: actualBillableDays,
        isInstallationBill: false,
        installationFee: 0,
        installationFeePaid: false,
        notes: `Pro-rated bill - Due on 25th of current month. Next billing starts on 1st of next month.`,
        applicationId: application.applicationId,
      };

      const proRatedBillResult = await Billing.create([proRatedBillData], {
        session,
      });
      createdProRatedBill = proRatedBillResult[0];

      const proRatedInvoice = await createInvoiceFromBilling(
        createdProRatedBill,
        application,
        settings,
      );
      if (proRatedInvoice) {
        await sendInvoiceWithPDFAttachment(proRatedInvoice, application);
      }

      if (installationFee > 0) {
        const installBillData: any = {
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInstallationInvoiceNumber(),
          billingPeriod: { start: new Date(), end: new Date() },
          dueDate: getDueDateForInstallationFee(new Date(), settings),
          items: [
            {
              description: `Installation Fee (One-time) - Building: ${application.buildingName || "N/A"} - Due within ${settings.installationFeeDueDays || 7} days`,
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
          notes: `Installation fee bill - Building: ${application.buildingName || "N/A"} - Separate from monthly subscription. Due on ${formatDateForDisplay(getDueDateForInstallationFee(new Date(), settings))}`,
          applicationId: application.applicationId,
        };

        const installBillResult = await Billing.create([installBillData], {
          session,
        });
        createdInstallationBill = installBillResult[0];

        await BillingCycle.updateOne(
          { _id: billingCycle[0]._id },
          { $set: { installationFeeBillId: createdInstallationBill._id } },
          { session },
        );

        const installInvoice = await createInvoiceFromBilling(
          createdInstallationBill,
          application,
          settings,
        );
        if (installInvoice) {
          await sendInvoiceWithPDFAttachment(installInvoice, application);
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

      let message = `Installation on day ${installationDay} (on/before cutoff). Pro-rated amount of ₱${finalProRatedAmount.toFixed(2)} for ${actualBillableDays} days due on ${formatDateForDisplay(createdProRatedBill.dueDate)}.`;
      if (createdInstallationBill) {
        message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately (Invoice: ${createdInstallationBill.invoiceNumber}, due on ${formatDateForDisplay(createdInstallationBill.dueDate)}).`;
      }
      message += ` Regular monthly billing will start next month on 1st with due date on 5th of that month.`;

      res.status(200).json({
        success: true,
        message: message,
        data: {
          billingCycle: billingCycle[0],
          proRatedBill: createdProRatedBill,
          installationBill: createdInstallationBill,
          proRatedAmount: finalProRatedAmount,
          dailyRate: dailyRate,
          monthlyRate: monthlyRate,
          annualRate: monthlyRate * 12,
          actualBillableDays: actualBillableDays,
          installationDay: installationDay,
          billingCutoffDay: billingCutoffDay,
          isAfterCutoff: false,
          dueDate: createdProRatedBill.dueDate,
          nextBillingDate: nextBillingDate,
          applicationId: application.applicationId,
          installationFee: installationFee,
          installationFeeSeparate: createdInstallationBill !== null,
          buildingInstallationFee: installationFee,
        },
      });
    } else {
      const proRatedAmount =
        Math.round(dailyRate * actualBillableDays * 100) / 100;
      const finalProRatedAmount = customAmount ? customAmount : proRatedAmount;

      const proRatedStartDate = installationDate;
      const proRatedEndDate = currentMonthEnd;

      const nextFullMonthStart = getStartOfNextMonth(installationDate);
      const nextFullMonthEnd = getEndOfMonth(nextFullMonthStart);
      const nextBillingDate = getFirstDayOfMonth(nextFullMonthStart);

      const combinedDueDate = getDueDateForMonthly(
        nextFullMonthStart,
        settings,
      );

      const billingCycle = await BillingCycle.create(
        [
          {
            planId: plan._id,
            monthlyRate: monthlyRate,
            currentProRatedAmount: finalProRatedAmount,
            proRatedPaid: false,
            actualBillableDays: actualBillableDays,
            isAfterCutoff: true,
            cutoffDayUsed: billingCutoffDay,
            applicationId: application.applicationId,
            installationFee: installationFee,
            installationFeePaid: false,
            billingStartDate: nextFullMonthStart,
            billingEndDate: nextFullMonthEnd,
            nextBillingDate: nextBillingDate,
            status: billingStatus,
          },
        ],
        { session },
      );

      // Create pro-rated bill
      const proRatedBillData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: proRatedStartDate, end: proRatedEndDate },
        dueDate: getDueDateForMonthly(nextFullMonthStart, settings),
        items: [
          {
            description: `Pro-rated payment from ${formatDateForDisplay(proRatedStartDate)} to ${formatDateForDisplay(proRatedEndDate)} (${actualBillableDays} days) - Due on 5th of next month`,
            quantity: actualBillableDays,
            rate: dailyRate,
            amount: finalProRatedAmount,
          },
        ],
        subtotal: finalProRatedAmount,
        tax: 0,
        discount: 0,
        total: finalProRatedAmount,
        status: "sent",
        isProRated: true,
        proRatedDays: actualBillableDays,
        isInstallationBill: false,
        installationFee: 0,
        installationFeePaid: false,
        notes: `Pro-rated bill for installation on ${formatDateForDisplay(installationDate)} - Due on 5th of next month`,
        applicationId: application.applicationId,
      };

      const proRatedBillResult = await Billing.create([proRatedBillData], {
        session,
      });
      createdProRatedBill = proRatedBillResult[0];

      const proRatedInvoice = await createInvoiceFromBilling(
        createdProRatedBill,
        application,
        settings,
      );
      if (proRatedInvoice) {
        await sendInvoiceWithPDFAttachment(proRatedInvoice, application);
      }

      // Create monthly bill
      const monthlyBillData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: nextFullMonthStart, end: nextFullMonthEnd },
        dueDate: combinedDueDate,
        items: [
          {
            description: `Monthly Subscription - ${formatDateForDisplay(nextFullMonthStart)} to ${formatDateForDisplay(nextFullMonthEnd)} (PREPAID) - Generated on ${formatDateForDisplay(new Date())}`,
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
        notes: `Regular monthly subscription - PREPAID: Generated on 1st, Due on 5th of ${formatDateForDisplay(nextFullMonthStart)}`,
        applicationId: application.applicationId,
      };

      const monthlyBillResult = await Billing.create([monthlyBillData], {
        session,
      });
      createdMonthlyBill = monthlyBillResult[0];

      const monthlyInvoice = await createInvoiceFromBilling(
        createdMonthlyBill,
        application,
        settings,
      );
      if (monthlyInvoice) {
        await sendInvoiceWithPDFAttachment(monthlyInvoice, application);
      }

      if (installationFee > 0) {
        const installBillData: any = {
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInstallationInvoiceNumber(),
          billingPeriod: { start: new Date(), end: new Date() },
          dueDate: getDueDateForInstallationFee(new Date(), settings),
          items: [
            {
              description: `Installation Fee (One-time) - Building: ${application.buildingName || "N/A"} - Due within ${settings.installationFeeDueDays || 7} days`,
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
          notes: `Installation fee bill - Building: ${application.buildingName || "N/A"} - Separate from monthly subscription. Due on ${formatDateForDisplay(getDueDateForInstallationFee(new Date(), settings))}`,
          applicationId: application.applicationId,
        };

        const installBillResult = await Billing.create([installBillData], {
          session,
        });
        createdInstallationBill = installBillResult[0];

        await BillingCycle.updateOne(
          { _id: billingCycle[0]._id },
          { $set: { installationFeeBillId: createdInstallationBill._id } },
          { session },
        );

        const installInvoice = await createInvoiceFromBilling(
          createdInstallationBill,
          application,
          settings,
        );
        if (installInvoice) {
          await sendInvoiceWithPDFAttachment(installInvoice, application);
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

      const totalFirstPayment = finalProRatedAmount + monthlyRate;
      let message = `Installation on day ${installationDay} (after cutoff). Pro-rated amount of ₱${finalProRatedAmount.toFixed(2)} for ${actualBillableDays} days PLUS regular monthly bill of ₱${monthlyRate.toFixed(2)} for period ${formatDateForDisplay(nextFullMonthStart)} to ${formatDateForDisplay(nextFullMonthEnd)}.`;
      message += ` TOTAL FIRST PAYMENT: ₱${totalFirstPayment.toFixed(2)} due on ${formatDateForDisplay(combinedDueDate)}.`;
      if (createdInstallationBill) {
        message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately (Invoice: ${createdInstallationBill.invoiceNumber}, due on ${formatDateForDisplay(createdInstallationBill.dueDate)}).`;
      }

      res.status(200).json({
        success: true,
        message: message,
        data: {
          billingCycle: billingCycle[0],
          proRatedBill: createdProRatedBill,
          monthlyBill: createdMonthlyBill,
          installationBill: createdInstallationBill,
          proRatedAmount: finalProRatedAmount,
          monthlyAmount: monthlyRate,
          totalFirstPayment: totalFirstPayment,
          dailyRate: dailyRate,
          monthlyRate: monthlyRate,
          annualRate: monthlyRate * 12,
          actualBillableDays: actualBillableDays,
          installationDay: installationDay,
          billingCutoffDay: billingCutoffDay,
          isAfterCutoff: true,
          dueDate: combinedDueDate,
          nextBillingDate: nextBillingDate,
          applicationId: application.applicationId,
          installationFee: installationFee,
          installationFeeSeparate: createdInstallationBill !== null,
          buildingInstallationFee: installationFee,
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

// ============================================================
// ✅ STOP BILLING
// ============================================================
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

// ============================================================
// ✅ PAUSE BILLING
// ============================================================
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

    const location = await getLocationFromEntity(application);

    try {
      await emailService.sendEmail(
        application.email,
        "Your Service Has Been Paused - Mister Fyber",
        emailService.generateServiceStatusHTML(
          application.firstName,
          application.lastName,
          "paused",
          `Your internet service has been paused. Reason: ${reason || "Customer requested pause"}.`,
        ),
        true,
        location,
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

// ============================================================
// ✅ RESUME BILLING
// ============================================================
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
    const nextBillingDate = getFirstDayOfMonth(getStartOfNextMonth(resumeDate));

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

    const location = await getLocationFromEntity(application);

    try {
      await emailService.sendEmail(
        application.email,
        "Your Service Has Been Resumed - Mister Fyber",
        emailService.generateServiceStatusHTML(
          application.firstName,
          application.lastName,
          "resumed",
          "Your internet service has been resumed.",
        ),
        true,
        location,
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

// ============================================================
// ✅ DISCONNECT CLIENT
// ============================================================
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

// ============================================================
// ✅ RECONNECT CLIENT
// ============================================================
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

// ============================================================
// ✅ DELETE BILLING CYCLE
// ============================================================
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

    await Invoice.deleteMany({ billingCycleId: billingCycle._id }, { session });
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

// ============================================================
// ✅ AUTO GENERATE MONTHLY BILLS
// ============================================================
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextMonth = getStartOfNextMonth(today);
    const nextMonthEnd = getEndOfMonth(nextMonth);

    const billingCycles = await BillingCycle.find({
      status: "active",
      proRatedPaid: true,
      applicationId: { $exists: true, $ne: null },
    })
      .populate("planId")
      .lean();

    let generatedCount = 0;
    let skippedCount = 0;
    let alreadyGeneratedCount = 0;

    for (const cycle of billingCycles) {
      if (!cycle.applicationId) {
        skippedCount++;
        continue;
      }

      const application = await Application.findOne({
        applicationId: cycle.applicationId,
      }).lean();

      if (!application) {
        skippedCount++;
        continue;
      }

      const plan = cycle.planId as any;
      if (!plan) {
        skippedCount++;
        continue;
      }

      const nextMonthYear = nextMonth.getFullYear();
      const nextMonthMonth = nextMonth.getMonth();

      const existingBill = await Billing.findOne({
        applicationId: cycle.applicationId,
        billingCycleId: cycle._id,
        isProRated: false,
        isInstallationBill: false,
        $expr: {
          $and: [
            { $eq: [{ $year: "$billingPeriod.start" }, nextMonthYear] },
            { $eq: [{ $month: "$billingPeriod.start" }, nextMonthMonth + 1] },
          ],
        },
      }).lean();

      if (!existingBill) {
        const billData: any = {
          billingCycleId: cycle._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: nextMonth, end: nextMonthEnd },
          dueDate: getDueDateForMonthly(nextMonth, settings),
          items: [
            {
              description: `Monthly Subscription - ${formatDateForDisplay(nextMonth)} to ${formatDateForDisplay(nextMonthEnd)} (PREPAID)`,
              quantity: 1,
              rate: plan.price,
              amount: plan.price,
            },
          ],
          subtotal: plan.price,
          tax: 0,
          discount: 0,
          total: plan.price,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
          isInstallationBill: false,
          installationFee: 0,
          installationFeePaid: false,
          notes: `Monthly subscription - PREPAID: Generated on 1st of month, Due on 5th of ${formatDateForDisplay(nextMonth)}`,
          applicationId: application.applicationId,
        };

        const bill = await Billing.create([billData]);
        generatedCount++;

        const invoice = await createInvoiceFromBilling(
          bill[0],
          application,
          settings,
        );
        if (invoice) {
          await sendInvoiceWithPDFAttachment(invoice, application);
        }

        console.log(
          `✅ Generated bill for ${application.firstName} ${application.lastName}`,
        );
      } else {
        alreadyGeneratedCount++;
      }
    }

    clearAllCache();

    if (res) {
      res.status(200).json({
        success: true,
        message: `Generated ${generatedCount} bills for ${formatDateForDisplay(nextMonth)}`,
        data: {
          generated: generatedCount,
          alreadyGenerated: alreadyGeneratedCount,
          skipped: skippedCount,
          billingMonth: formatDateForDisplay(nextMonth),
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

// ============================================================
// ✅ AUTO SUSPEND OVERDUE
// ============================================================
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

// ============================================================
// ✅ GET APPLICATION CURRENT BILLING
// ============================================================
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextMonthStart = getStartOfNextMonth(today);
    const nextMonthYear = nextMonthStart.getFullYear();
    const nextMonthMonth = nextMonthStart.getMonth();

    const nextMonthBill = await Billing.findOne({
      applicationId: applicationId,
      billingCycleId: billingCycle._id,
      isProRated: false,
      isInstallationBill: false,
      $expr: {
        $and: [
          { $eq: [{ $year: "$billingPeriod.start" }, nextMonthYear] },
          { $eq: [{ $month: "$billingPeriod.start" }, nextMonthMonth + 1] },
        ],
      },
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentMonthlyBill,
        pendingInstallationBill,
        nextMonthBill,
        needsFirstPayment,
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

// ============================================================
// ✅ GET APPLICATION BILLING HISTORY
// ============================================================
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

// ============================================================
// ✅ SUBMIT PRO-RATED PAYMENT
// ============================================================
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

// ============================================================
// ✅ SUBMIT INSTALLATION PAYMENT
// ============================================================
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

// ============================================================
// ✅ SUBMIT MONTHLY PAYMENT (ALIAS)
// ============================================================
export const submitMonthlyPayment = submitProRatedPayment;

// ============================================================
// ✅ GET APPLICATION BILLING STATUS
// ============================================================
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
        location: location,
        collectionEmail: collectionEmail,
        buildingInstallationFee: billingCycle?.installationFee || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ RECOVER MISSING BILLS
// ============================================================
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
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const plan = billingCycle.planId as any;
    const monthlyRate = plan.price;

    let startDate: Date;
    if (startFromDate) {
      startDate = new Date(startFromDate);
      startDate = getFirstDayOfMonth(startDate);
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
        startDate = getFirstDayOfMonth(getStartOfNextMonth(startDate));
      } else {
        startDate = getFirstDayOfMonth(billingCycle.billingStartDate);
      }
    }

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const settings = await getOrCreateSettings();
    const missingBills = [];
    let currentBillDate = new Date(startDate);

    while (currentBillDate <= currentDate) {
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
        const billData: any = {
          billingCycleId: billingCycle._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: billingStart, end: billingEnd },
          dueDate: getDueDateForMonthly(billingStart, settings),
          items: [
            {
              description: `[RECOVERED] Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)} (PREPAID)`,
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
          notes: `RECOVERED BILL - Generated from backdated billing. Original period: ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}.`,
          applicationId: application.applicationId,
        };

        const bill = await Billing.create([billData]);
        missingBills.push(bill[0]);

        const invoice = await createInvoiceFromBilling(
          bill[0],
          application,
          settings,
        );
        if (invoice) {
          await sendInvoiceWithPDFAttachment(invoice, application);
        }
      }

      currentBillDate.setMonth(currentBillDate.getMonth() + 1);
    }

    const nextBilling = getFirstDayOfMonth(getStartOfNextMonth(currentDate));

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

// ============================================================
// ✅ INITIALIZE BACKDATED BILLING
// ============================================================
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
        message: "serviceStartDate is required",
      });
    }

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();

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
      plan = await require("../models/Plan").default.findById(plan._id);
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

    let installationFee = 0;
    if (includeInstallationFee !== false) {
      const building = await getBuildingForApplication(application);
      if (
        building &&
        building.installationFee !== undefined &&
        building.installationFee > 0
      ) {
        installationFee = building.installationFee;
        console.log(
          `🏢 Using building-specific installation fee: ₱${installationFee} for ${building.buildingName}`,
        );
      } else {
        installationFee = settings.installationFee || 1500;
        console.log(`🌐 Using global installation fee: ₱${installationFee}`);
      }
    }

    const startDate = new Date(serviceStartDate);
    startDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const installationDay = startDate.getDate();
    const billingCutoffDay = settings.billingCutoffDay || 24;
    const isAfterCutoff = installationDay > billingCutoffDay;

    const nextFullMonthStart = getStartOfNextMonth(startDate);
    const nextFullMonthEnd = getEndOfMonth(nextFullMonthStart);
    const nextBillingDate = getFirstDayOfMonth(nextFullMonthStart);

    const billingCycle = await BillingCycle.create(
      [
        {
          applicationId: application.applicationId,
          planId: plan?._id || null,
          monthlyRate: actualMonthlyRate,
          billingStartDate: nextFullMonthStart,
          billingEndDate: nextFullMonthEnd,
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
    let totalMonthlyAmount = 0;
    const unpaidMonths = [];

    // Pro-rated bill for first month
    if (startDate.getDate() > 1) {
      const daysInMonth = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        0,
      ).getDate();
      const daysUsed = daysInMonth - startDate.getDate() + 1;
      const dailyRate = (actualMonthlyRate * 12) / 365;
      const proRatedAmount = Math.round(dailyRate * daysUsed * 100) / 100;
      const monthEnd = getEndOfMonth(startDate);

      const dueDate = isAfterCutoff
        ? getDueDateForMonthly(getStartOfNextMonth(startDate), settings)
        : getDueDateForProRatedBeforeCutoff(startDate, settings);

      const proRatedBillData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInvoiceNumber(),
        billingPeriod: { start: startDate, end: monthEnd },
        dueDate: dueDate,
        items: [
          {
            description: `Pro-rated payment from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(monthEnd)} (${daysUsed} days)`,
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
          `Generated from backdated billing starting ${formatDateForDisplay(startDate)}.`,
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
        await sendInvoiceWithPDFAttachment(invoice, application);
      }
    }

    // Generate missing monthly bills
    let currentBillDate = getStartOfNextMonth(startDate);

    while (currentBillDate <= today) {
      const billingStart = new Date(currentBillDate);
      const billingEnd = getEndOfMonth(billingStart);
      const dueDate = getDueDateForMonthly(billingStart, settings);

      const existingBill = await Billing.findOne({
        applicationId: application.applicationId,
        billingCycleId: billingCycle[0]._id,
        "billingPeriod.start": billingStart,
        isInstallationBill: false,
        isProRated: false,
      }).session(session);

      if (!existingBill) {
        let amount = actualMonthlyRate;
        let isMissingBill = currentBillDate < today;

        const billData: any = {
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: billingStart, end: billingEnd },
          dueDate: dueDate,
          items: [
            {
              description: isMissingBill
                ? `[MISSING BILL - BACKDATED] Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)} (PREPAID)`
                : `Monthly Subscription - ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)} (PREPAID)`,
              quantity: 1,
              rate: amount,
              amount: amount,
            },
          ],
          subtotal: amount,
          total: amount,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
          isInstallationBill: false,
          installationFee: 0,
          installationFeePaid: false,
          applicationId: application.applicationId,
          notes:
            notes ||
            (isMissingBill
              ? `MISSING BILL - Generated from backdated billing. Original period: ${formatDateForDisplay(billingStart)} to ${formatDateForDisplay(billingEnd)}.`
              : `Generated from backdated billing starting ${formatDateForDisplay(startDate)}.`),
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

        const invoice = await createInvoiceFromBilling(
          newBill[0],
          application,
          settings,
        );
        if (invoice) {
          await sendInvoiceWithPDFAttachment(invoice, application);
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

    const lastGeneratedMonth = new Date(currentBillDate);
    lastGeneratedMonth.setMonth(lastGeneratedMonth.getMonth() - 1);
    lastGeneratedMonth.setDate(1);

    const newNextBillingDate = getFirstDayOfMonth(
      getStartOfNextMonth(lastGeneratedMonth),
    );

    await BillingCycle.updateOne(
      { _id: billingCycle[0]._id },
      { $set: { nextBillingDate: newNextBillingDate } },
      { session },
    );

    let installationBill = null;
    if (installationFee > 0) {
      const installBillData: any = {
        billingCycleId: billingCycle[0]._id,
        invoiceNumber: generateInstallationInvoiceNumber(),
        billingPeriod: { start: new Date(), end: new Date() },
        dueDate: getDueDateForInstallationFee(new Date(), settings),
        items: [
          {
            description: `Installation Fee (One-time) - Building: ${application.buildingName || "N/A"} - Due within ${settings.installationFeeDueDays || 7} days`,
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
        notes: `Installation fee bill - Building: ${application.buildingName || "N/A"} - Separate from monthly subscription. Due on ${formatDateForDisplay(getDueDateForInstallationFee(new Date(), settings))}`,
        applicationId: application.applicationId,
      };

      const installBillResult = await Billing.create([installBillData], {
        session,
      });
      installationBill = installBillResult[0];

      await BillingCycle.updateOne(
        { _id: billingCycle[0]._id },
        { $set: { installationFeeBillId: installationBill._id } },
        { session },
      );

      const installInvoice = await createInvoiceFromBilling(
        installationBill,
        application,
        settings,
      );
      if (installInvoice) {
        await sendInvoiceWithPDFAttachment(installInvoice, application);
      }
    }

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

    let message = `Backdated billing initialized for ${application.firstName} ${application.lastName}. Generated ${generatedBills.length} bill(s) totaling ₱${totalMonthlyAmount.toFixed(2)}.`;

    if (installationBill) {
      message += ` Installation fee of ₱${installationFee.toFixed(2)} billed separately (Invoice: ${installationBill.invoiceNumber}, due on ${formatDateForDisplay(installationBill.dueDate)}).`;
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
        buildingInstallationFee: installationFee,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ============================================================
// ✅ GET UNPAID BILLS REPORT
// ============================================================
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
            .select(
              "firstName lastName email applicationId phoneNumber location buildingName",
            )
            .lean();
          if (application) {
            (b as any).applicationData = application;
            const location = await getLocationFromEntity(application);
            (b as any).location = location || "";
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
          location: (bill as any).location || "",
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
        location: (bill as any).location || "",
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

// ============================================================
// ✅ MANUALLY GENERATE BILLS FOR MONTH
// ============================================================
export const manuallyGenerateBillsForMonth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { year, month, applicationId } = req.body;

    const targetDate = new Date();
    if (year && month) {
      targetDate.setFullYear(year);
      targetDate.setMonth(month - 1);
      targetDate.setDate(1);
    } else {
      targetDate.setDate(1);
    }

    targetDate.setHours(0, 0, 0, 0);

    const settings = await getOrCreateSettings();
    const targetMonthStart = getFirstDayOfMonth(targetDate);
    const targetMonthEnd = getEndOfMonth(targetMonthStart);

    let query: any = {
      status: "active",
      proRatedPaid: true,
      applicationId: { $exists: true, $ne: null },
    };

    if (applicationId) {
      query.applicationId = applicationId;
    }

    const billingCycles = await BillingCycle.find(query)
      .populate("planId")
      .lean();

    let generatedCount = 0;
    let skippedCount = 0;
    const generatedBills = [];

    for (const cycle of billingCycles) {
      if (!cycle.applicationId) {
        skippedCount++;
        continue;
      }

      const application = await Application.findOne({
        applicationId: cycle.applicationId,
      }).lean();

      if (!application) {
        skippedCount++;
        continue;
      }

      const plan = cycle.planId as any;
      if (!plan) {
        skippedCount++;
        continue;
      }

      const existingBill = await Billing.findOne({
        applicationId: cycle.applicationId,
        billingCycleId: cycle._id,
        isProRated: false,
        isInstallationBill: false,
        "billingPeriod.start": targetMonthStart,
      }).lean();

      if (!existingBill) {
        const billData: any = {
          billingCycleId: cycle._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: targetMonthStart, end: targetMonthEnd },
          dueDate: getDueDateForMonthly(targetMonthStart, settings),
          items: [
            {
              description: `Monthly Subscription - ${formatDateForDisplay(targetMonthStart)} to ${formatDateForDisplay(targetMonthEnd)} (PREPAID) - Manually generated`,
              quantity: 1,
              rate: plan.price,
              amount: plan.price,
            },
          ],
          subtotal: plan.price,
          tax: 0,
          discount: 0,
          total: plan.price,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
          isInstallationBill: false,
          installationFee: 0,
          installationFeePaid: false,
          notes: `Manually generated for ${formatDateForDisplay(targetMonthStart)}`,
          applicationId: application.applicationId,
        };

        const bill = await Billing.create([billData]);
        generatedCount++;
        generatedBills.push(bill[0]);

        const invoice = await createInvoiceFromBilling(
          bill[0],
          application,
          settings,
        );
        if (invoice) {
          await sendInvoiceWithPDFAttachment(invoice, application);
        }

        console.log(
          `✅ Manually generated bill for ${application.firstName} ${application.lastName}`,
        );
      } else {
        skippedCount++;
      }
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `Generated ${generatedCount} bills for ${formatDateForDisplay(targetMonthStart)}`,
      data: {
        generated: generatedCount,
        skipped: skippedCount,
        billingMonth: formatDateForDisplay(targetMonthStart),
        generatedBills: generatedBills,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ MANUALLY GENERATE EARLY BILL
// ============================================================
export const manuallyGenerateEarlyBill = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    const settings = await getOrCreateSettings();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextMonthStart = getStartOfNextMonth(today);
    const nextMonthEnd = getEndOfMonth(nextMonthStart);

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const billingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
      status: "active",
      proRatedPaid: true,
    })
      .populate("planId")
      .lean();

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found for this application",
      });
    }

    const plan = billingCycle.planId as any;
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "No plan found for this billing cycle",
      });
    }

    const nextMonthYear = nextMonthStart.getFullYear();
    const nextMonthMonth = nextMonthStart.getMonth();

    const existingBill = await Billing.findOne({
      applicationId: application.applicationId,
      billingCycleId: billingCycle._id,
      isProRated: false,
      isInstallationBill: false,
      $expr: {
        $and: [
          { $eq: [{ $year: "$billingPeriod.start" }, nextMonthYear] },
          { $eq: [{ $month: "$billingPeriod.start" }, nextMonthMonth + 1] },
        ],
      },
    }).lean();

    if (existingBill) {
      return res.status(400).json({
        success: false,
        message: `Bill already exists for ${formatDateForDisplay(nextMonthStart)}`,
        data: {
          existingBill,
          invoiceNumber: existingBill.invoiceNumber,
        },
      });
    }

    const billData: any = {
      billingCycleId: billingCycle._id,
      invoiceNumber: generateInvoiceNumber(),
      billingPeriod: { start: nextMonthStart, end: nextMonthEnd },
      dueDate: getDueDateForMonthly(nextMonthStart, settings),
      items: [
        {
          description: `Monthly Subscription - ${formatDateForDisplay(nextMonthStart)} to ${formatDateForDisplay(nextMonthEnd)} (PREPAID) - EARLY BILL`,
          quantity: 1,
          rate: plan.price,
          amount: plan.price,
        },
      ],
      subtotal: plan.price,
      tax: 0,
      discount: 0,
      total: plan.price,
      status: "sent",
      isProRated: false,
      proRatedDays: 0,
      isInstallationBill: false,
      installationFee: 0,
      installationFeePaid: false,
      notes: `Early bill for ${formatDateForDisplay(nextMonthStart)} - Generated on ${formatDateForDisplay(today)}`,
      applicationId: application.applicationId,
    };

    const bill = await Billing.create([billData]);
    const newBill = bill[0];

    const invoice = await createInvoiceFromBilling(
      newBill,
      application,
      settings,
    );
    if (invoice) {
      await sendInvoiceWithPDFAttachment(invoice, application);
    }

    clearAllCache();

    res.status(200).json({
      success: true,
      message: `✅ Early bill generated for ${application.firstName} ${application.lastName} for ${formatDateForDisplay(nextMonthStart)}`,
      data: {
        bill: newBill,
        billingMonth: formatDateForDisplay(nextMonthStart),
        dueDate: formatDateForDisplay(newBill.dueDate),
        applicationName: `${application.firstName} ${application.lastName}`,
        applicationId: application.applicationId,
        invoiceNumber: newBill.invoiceNumber,
        amount: plan.price,
      },
    });
  } catch (error) {
    console.error("Error manually generating early bill:", error);
    next(error);
  }
};

// ============================================================
// ✅ GET DASHBOARD DATA
// ============================================================
export const getDashboardData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();
    if (
      dashboardDataCache &&
      now - dashboardDataCacheTime < DASHBOARD_CACHE_TTL
    ) {
      console.log("📦 Returning cached dashboard data");
      return res.status(200).json({
        success: true,
        data: dashboardDataCache,
      });
    }

    console.log("🔄 Fetching fresh dashboard data...");

    const buildings = await Building.find({}).lean().maxTimeMS(3000);

    const [
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
      BillingCycle.find({})
        .select(
          "userId applicationId planId billingStartDate billingEndDate nextBillingDate status monthlyRate currentProRatedAmount proRatedPaid installationFee installationFeePaid",
        )
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean()
        .maxTimeMS(3000),

      Billing.find({
        status: { $in: ["sent", "overdue", "pending_confirmation"] },
      })
        .select(
          "userId applicationId invoiceNumber billingPeriod dueDate items subtotal total status isProRated proRatedDays isInstallationBill installationFee installationFeePaid",
        )
        .sort({ dueDate: 1 })
        .limit(1000)
        .lean()
        .maxTimeMS(3000),

      User.find({})
        .select(
          "firstName lastName email username phoneNumber status planId building unitNumber floor",
        )
        .populate("planId", "name price")
        .limit(1000)
        .lean()
        .maxTimeMS(3000),

      Application.find({ status: { $in: ["approved", "pending"] } })
        .select(
          "firstName lastName email phoneNumber status applicationId planId buildingId buildingName unitNumber floor installationFee installationFeePaid billingStarted",
        )
        .populate("planId", "name price")
        .populate("buildingId", "buildingName streetAddress city")
        .limit(1000)
        .lean()
        .maxTimeMS(3000),

      Payment.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
        .maxTimeMS(2000),

      Application.find({
        status: "approved",
        $or: [
          { registeredUserId: { $exists: false } },
          { registeredUserId: null },
        ],
        billingStarted: { $ne: true },
      })
        .select("firstName lastName email applicationId planId buildingName")
        .populate("planId", "name price")
        .limit(100)
        .lean()
        .maxTimeMS(2000),

      Billing.find({
        isInstallationBill: true,
        installationFeePaid: false,
        status: { $in: ["sent", "overdue"] },
      })
        .select(
          "userId applicationId invoiceNumber dueDate total installationFee installationFeePaid",
        )
        .sort({ dueDate: 1 })
        .limit(100)
        .lean()
        .maxTimeMS(2000),

      Billing.find({
        isProRated: true,
        status: "pending_confirmation",
        isInstallationBill: false,
      })
        .select("userId applicationId invoiceNumber dueDate total proRatedDays")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
        .maxTimeMS(2000),

      BillingCycle.find({
        status: "pending_activation",
        proRatedPaid: true,
        manualBillStart: false,
      })
        .select(
          "userId applicationId planId billingStartDate nextBillingDate status monthlyRate proRatedPaidAt",
        )
        .populate("planId", "name price")
        .sort({ proRatedPaidAt: -1 })
        .limit(100)
        .lean()
        .maxTimeMS(2000),
    ]);

    // Build application map
    const appIds = applications.map((a) => a.applicationId).filter(Boolean);
    let appMap = new Map();
    applications.forEach((a) => appMap.set(a.applicationId, a));

    // Build user map
    let userMap = new Map();
    users.forEach((u) => userMap.set(u._id.toString(), u));

    // Enrich billing cycles
    const enrichedCycles = billingCycles.map((cycle) => {
      const c = { ...cycle };
      if (cycle.applicationId && appMap.has(cycle.applicationId)) {
        (c as any).applicationData = appMap.get(cycle.applicationId);
      }
      return c;
    });

    // Enrich bills
    const enrichedBills = bills.map((bill) => {
      const b = { ...bill };
      if (bill.applicationId && appMap.has(bill.applicationId)) {
        (b as any).applicationData = appMap.get(bill.applicationId);
      }
      return b;
    });

    // Build customers list
    const userCustomers = users.map((user: any) => {
      const userBills = enrichedBills.filter(
        (bill) => bill.userId?.toString() === user._id.toString(),
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
        (cycle) => cycle.userId?.toString() === user._id.toString(),
      );

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
        overdueBills: overdueBills,
        billingCycle: userCycle || null,
        installationFee: 0,
        installationFeePaid: true,
        building: user.building || null,
        unitNumber: user.unitNumber,
        floor: user.floor,
      };
    });

    const applicationCustomers = applications
      .filter(
        (app: any) => app.status === "approved" || app.billingStarted === true,
      )
      .map((app: any) => {
        const appBills = enrichedBills.filter(
          (bill) => bill.applicationId === app.applicationId,
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
          (cycle) => cycle.applicationId === app.applicationId,
        );

        let buildingObj = null;
        if (app.buildingId) {
          if (typeof app.buildingId === "object" && app.buildingId._id) {
            buildingObj = app.buildingId;
          } else if (typeof app.buildingId === "string") {
            const foundBuilding = buildings.find(
              (b) =>
                b._id.toString() === app.buildingId ||
                b.buildingName === app.buildingId,
            );
            if (foundBuilding) buildingObj = foundBuilding;
          }
        }
        if (!buildingObj && app.buildingName) {
          const foundBuilding = buildings.find(
            (b) => b.buildingName === app.buildingName,
          );
          if (foundBuilding) {
            buildingObj = foundBuilding;
          } else {
            buildingObj = { buildingName: app.buildingName };
          }
        }

        return {
          _id: app._id,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.billingStarted ? "billing_started" : "approved",
          type: "application" as const,
          planName: app.planId?.name || "No Plan",
          planPrice: app.planId?.price || 0,
          currentBalance: totalBalance,
          unpaidBills: appBills,
          overdueBills: overdueBills,
          billingCycle: appCycle || null,
          applicationId: app.applicationId,
          installationFee: app.installationFee || 0,
          installationFeePaid: app.installationFeePaid || false,
          building: buildingObj,
          unitNumber: app.unitNumber,
          floor: app.floor,
        };
      });

    const allCustomers = [...userCustomers, ...applicationCustomers];
    allCustomers.sort((a, b) => b.currentBalance - a.currentBalance);

    const totalBalance = allCustomers.reduce(
      (sum, c) => sum + c.currentBalance,
      0,
    );
    const customersWithBalance = allCustomers.filter(
      (c) => c.currentBalance > 0,
    ).length;
    const overdueCustomers = allCustomers.filter(
      (c) => c.overdueBills.length > 0,
    ).length;
    const activeCycles = enrichedCycles.filter(
      (c) => c.status === "active",
    ).length;
    const pausedCycles = enrichedCycles.filter(
      (c) => c.status === "paused",
    ).length;
    const applicationsWithoutBilling = applications.filter(
      (app: any) => app.status === "approved" && !app.billingStarted,
    ).length;

    const totalInstallationFeesDue = allCustomers
      .filter(
        (c) =>
          c.type === "application" &&
          !c.installationFeePaid &&
          (c.installationFee || 0) > 0,
      )
      .reduce((sum, c) => sum + (c.installationFee || 0), 0);
    const installationFeesPaidCount = allCustomers.filter(
      (c) => c.type === "application" && c.installationFeePaid,
    ).length;

    const stats = {
      totalCustomers: allCustomers.length,
      totalBalance: totalBalance,
      customersWithBalanceCount: customersWithBalance,
      overdueCustomersCount: overdueCustomers,
      activeCyclesCount: activeCycles,
      pausedCyclesCount: pausedCycles,
      pendingProRatedCount: pendingProRated.length,
      pendingActivationsCount: pendingActivations.length,
      pendingPaymentsCount: pendingPayments.length,
      pendingInstallationBillsCount: pendingInstallationBills.length,
      applicationsWithoutBilling: applicationsWithoutBilling,
      totalInstallationFeesDue: totalInstallationFeesDue,
      installationFeesPaidCount: installationFeesPaidCount,
    };

    const dashboardData = {
      customers: allCustomers,
      billingCycles: enrichedCycles,
      bills: enrichedBills,
      pendingPayments: pendingPayments,
      customersWithoutAccounts: customersWithoutAccounts,
      pendingInstallationBills: pendingInstallationBills,
      pendingProRated: pendingProRated,
      pendingActivations: pendingActivations,
      stats: stats,
    };

    dashboardDataCache = dashboardData;
    dashboardDataCacheTime = now;

    console.log(`✅ Dashboard data cached: ${allCustomers.length} customers`);

    res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error("Error in getDashboardData:", error);
    next(error);
  }
};

// ============================================================
// ✅ CHECK FOR UPDATES
// ============================================================
export const checkForUpdates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { lastUpdated } = req.query;

    if (!lastUpdated) {
      return res.status(200).json({
        success: true,
        hasUpdates: true,
      });
    }

    const lastCheck = new Date(lastUpdated as string);

    const [recentBill, recentCycle, recentPayment, recentApplication] =
      await Promise.all([
        Billing.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean()
          .maxTimeMS(2000),
        BillingCycle.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean()
          .maxTimeMS(2000),
        Payment.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean()
          .maxTimeMS(2000),
        Application.findOne({ updatedAt: { $gt: lastCheck } })
          .sort({ updatedAt: -1 })
          .lean()
          .maxTimeMS(2000),
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
    console.error("Error in checkForUpdates:", error);
    next(error);
  }
};

// ============================================================
// ✅ CHECK FOR NEW CUSTOMERS
// ============================================================
export const checkForNewCustomers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cacheKey = "new_customers";
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        data: cachedData,
        cached: true,
      });
    }

    const newCustomers = await Application.find({
      status: "approved",
      billingStarted: { $ne: true },
    })
      .select(
        "firstName lastName email applicationId planId buildingName phoneNumber",
      )
      .populate("planId", "name price")
      .lean()
      .maxTimeMS(3000);

    cache.set(cacheKey, newCustomers, 30);

    res.status(200).json({
      success: true,
      data: newCustomers,
      total: newCustomers.length,
    });
  } catch (error) {
    console.error("Error checking for new customers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check for new customers",
    });
  }
};

// ============================================================
// ✅ EXPORT DEFAULT
// ============================================================
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
};
