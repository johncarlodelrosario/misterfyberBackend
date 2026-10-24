// backend/src/controllers/manualEmailController.ts - COMPLETE FIXED VERSION
// FIXED: Timezone handling, billIds support, template support, HARD DELETE, LATEST FIRST sorting, and sender safety
// NEW: Wilconnect buildings (Vitalez, El Pueblo, Newport) use workselpueblo@fyberblizz.com

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Application from "../models/Application";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import EmailSentRecord from "../models/EmailSentRecord";
import EmailTemplate from "../models/EmailTemplate";
import EmailSchedule from "../models/EmailSchedule";
import emailService, {
  getLocationFromEntity,
  getCollectionEmailByLocation,
} from "../services/emailService";

type AuthRequest = Request & { user?: any };

// ============================================================
// WILCONNECT BUILDINGS - Use workselpueblo@fyberblizz.com
// ============================================================
const WILCONNECT_BUILDINGS = ["el pueblo", "vitalez", "newport"];

function isWilconnectBuilding(buildingName?: string): boolean {
  if (!buildingName) return false;
  const normalized = buildingName.toLowerCase().trim();
  return WILCONNECT_BUILDINGS.some((b) => normalized.includes(b));
}

// ============================================================
// SENDER TYPES
// ============================================================
export type SenderType =
  | "admin"
  | "collection"
  | "workselpueblo"
  | "fbsilkresidence";

// ============================================================
// SENDER EMAIL CONFIGURATION (from .env with fallbacks)
// ============================================================
const getSafeSenderEmail = (envKey: string, fallback: string): string => {
  const envValue = process.env[envKey];
  if (envValue && envValue.trim().length > 0) {
    if (envKey === "SENDER_EMAIL_WORKSELPUEBLO" && envValue.includes("gmail")) {
      console.warn(
        `⚠️ WARNING: ${envKey} is set to a Gmail address. Using fallback instead.`,
      );
      return fallback;
    }
    return envValue.trim();
  }
  return fallback;
};

const ADDITIONAL_SENDER_EMAILS = {
  workselpueblo: getSafeSenderEmail(
    "SENDER_EMAIL_WORKSELPUEBLO",
    "workselpueblo@fyberblizz.com",
  ),
  fbsilkresidence: getSafeSenderEmail(
    "SENDER_EMAIL_FBSILKRESIDENCE",
    "fbsilkresidence@gmail.com",
  ),
};

const ADDITIONAL_SENDER_NAMES = {
  workselpueblo: process.env.SENDER_NAME_WORKSELPUEBLO || "Workselpueblo",
  fbsilkresidence:
    process.env.SENDER_NAME_FBSILKRESIDENCE || "FB Silk Residence",
};

// ============================================================
// CHECK ADMIN
// ============================================================
function checkAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user) {
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
// HELPER: Extract location from building name
// ============================================================
function extractLocationFromBuildingName(buildingName?: string): string {
  if (!buildingName) return "other";
  const name = buildingName.toLowerCase().trim();
  if (name.includes("breeze")) return "breeze";
  if (name.includes("sil") || name.includes("silk")) return "sil";
  return "other";
}

// ============================================================
// HELPER: Get sender type from request body
// ============================================================
function getSenderTypeFromRequest(body: any): SenderType {
  if (body.senderType && typeof body.senderType === "string") {
    const validTypes: SenderType[] = [
      "admin",
      "collection",
      "workselpueblo",
      "fbsilkresidence",
    ];
    if (validTypes.includes(body.senderType as SenderType)) {
      return body.senderType as SenderType;
    }
  }

  if (body.useAdminSender === true) {
    return "admin";
  }

  return "collection";
}

// ============================================================
// HELPER: Get sender info by type - WITH WILCONNECT OVERRIDE
// ============================================================
function getSenderInfoByType(
  senderType: SenderType,
  location?: string,
  buildingName?: string,
): { email: string; name: string; label: string } {
  // ✅ CHECK: If building is Wilconnect (Vitalez, El Pueblo, Newport), use workselpueblo@fyberblizz.com
  if (isWilconnectBuilding(buildingName)) {
    console.log(
      `🏢 Wilconnect building detected: "${buildingName}" - Using workselpueblo@fyberblizz.com`,
    );
    return {
      email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
      name: ADDITIONAL_SENDER_NAMES.workselpueblo,
      label: "Workselpueblo",
    };
  }

  switch (senderType) {
    case "admin":
      return {
        email: process.env.ADMIN_EMAIL || "admin@misterfyber.com",
        name: "Mister Fyber Admin",
        label: "Admin",
      };

    case "workselpueblo":
      return {
        email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
        name: ADDITIONAL_SENDER_NAMES.workselpueblo,
        label: "Workselpueblo",
      };

    case "fbsilkresidence":
      return {
        email: ADDITIONAL_SENDER_EMAILS.fbsilkresidence,
        name: ADDITIONAL_SENDER_NAMES.fbsilkresidence,
        label: "FB Silk Residence",
      };

    case "collection":
    default:
      const collectionEmail = location
        ? getCollectionEmailByLocation(location)
        : process.env.COLLECTION_EMAIL_DEFAULT || "admin@misterfyber.com";

      let name = "Mister Fyber Collection";
      let label = "Collection";

      if (collectionEmail.includes("breeze")) {
        name = "Mister Fyber Breeze Collection";
        label = "Breeze Collection";
      } else if (
        collectionEmail.includes("sil") ||
        collectionEmail.includes("silk")
      ) {
        name = "Mister Fyber SIL Collection";
        label = "SIL Collection";
      }

      return { email: collectionEmail, name, label };
  }
}

// ============================================================
// HELPER: Get all available sender options
// ============================================================
function getAllSenderOptions(
  location?: string,
  buildingName?: string,
): {
  value: SenderType;
  label: string;
  email: string;
  icon: string;
}[] {
  const options: {
    value: SenderType;
    label: string;
    email: string;
    icon: string;
  }[] = [];

  // ✅ If Wilconnect building, always show workselpueblo first
  if (isWilconnectBuilding(buildingName)) {
    options.push({
      value: "workselpueblo",
      label: "Workselpueblo (Auto - Wilconnect)",
      email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
      icon: "🏢",
    });
  }

  if (location && location !== "other") {
    const collectionEmail = getCollectionEmailByLocation(location);
    let locationName = location.charAt(0).toUpperCase() + location.slice(1);
    options.push({
      value: "collection",
      label: `${locationName} Collection`,
      email: collectionEmail,
      icon: "📍",
    });
  } else {
    options.push({
      value: "collection",
      label: "Collection",
      email: process.env.COLLECTION_EMAIL_DEFAULT || "admin@misterfyber.com",
      icon: "📍",
    });
  }

  // Add workselpueblo if not already added
  if (!isWilconnectBuilding(buildingName)) {
    options.push({
      value: "workselpueblo",
      label: ADDITIONAL_SENDER_NAMES.workselpueblo,
      email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
      icon: "🏢",
    });
  }

  options.push({
    value: "admin",
    label: "Admin",
    email: process.env.ADMIN_EMAIL || "admin@misterfyber.com",
    icon: "👤",
  });

  options.push({
    value: "fbsilkresidence",
    label: ADDITIONAL_SENDER_NAMES.fbsilkresidence,
    email: ADDITIONAL_SENDER_EMAILS.fbsilkresidence,
    icon: "🏠",
  });

  return options;
}

// ============================================================
// HELPER: Parse scheduledFor date
// ============================================================
function parseScheduledDate(scheduledFor: string): Date {
  const parsed = new Date(scheduledFor);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date format: ${scheduledFor}`);
  }
  return parsed;
}

// ============================================================
// GENERATE EMAIL PREVIEW
// ============================================================
function generateEmailPreview(
  subject: string,
  message: string,
  includeBilling: boolean,
  billingDataArray: any[] = [],
  customerData?: any,
  senderInfo?: string,
  richTextContent?: string,
): string {
  const content = richTextContent || message.replace(/\n/g, "<br>");

  const senderSection = senderInfo
    ? `
    <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
      <strong>📧 ${senderInfo}</strong>
    </div>
  `
    : "";

  let locationBadge = "";
  if (customerData && customerData.buildingName) {
    const location = extractLocationFromBuildingName(customerData.buildingName);
    const isWil = isWilconnectBuilding(customerData.buildingName);

    if (isWil) {
      locationBadge = `
        <div style="display: inline-block; background: #059669; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin: 10px 0;">
          🏢 WILCONNECT - ${customerData.buildingName}
        </div>
      `;
    } else if (location !== "other") {
      locationBadge = `
        <div style="display: inline-block; background: ${location === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin: 10px 0;">
          📍 ${location.toUpperCase()} - ${customerData.buildingName}
        </div>
      `;
    }
  }

  let billingSection = "";
  if (includeBilling && billingDataArray && billingDataArray.length > 0) {
    const totalAmount = billingDataArray.reduce(
      (sum, bill) => sum + (bill.total || 0),
      0,
    );

    let billsHtml = "";
    billingDataArray.forEach((bill) => {
      billsHtml += `
        <div style="border-bottom: 1px solid #e0e0e0; padding-bottom: 12px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong>${bill.invoiceNumber || "N/A"}</strong>
            <span style="color: #dc3545; font-size: 16px; font-weight: bold;">₱${(bill.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div style="font-size: 13px; color: #555;">
            <span>Due: ${bill.dueDate ? new Date(bill.dueDate).toLocaleDateString() : "N/A"}</span>
            <span style="margin-left: 15px;">Status: ${bill.status?.toUpperCase() || "UNKNOWN"}</span>
            ${bill.isInstallationBill ? `<span style="margin-left: 15px; background: #e8f0fe; padding: 2px 8px; border-radius: 4px;">Installation</span>` : ""}
            ${bill.isProRated ? `<span style="margin-left: 15px; background: #f0f0e8; padding: 2px 8px; border-radius: 4px;">Pro-rated</span>` : ""}
          </div>
        </div>
      `;
    });

    billingSection = `
      <div style="margin-top: 30px; padding: 20px; background-color: #f8f9fa; border-radius: 10px; border-left: 4px solid #007bff;">
        <h3 style="margin-top: 0; color: #007bff;">📋 Billing Information (${billingDataArray.length} Bill${billingDataArray.length > 1 ? "s" : ""})</h3>
        ${billsHtml}
        <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #007bff; display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 16px;">Total Amount Due:</strong>
          <span style="color: #dc3545; font-size: 20px; font-weight: bold;">₱${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    `;
  }

  const customerSection = customerData
    ? `
    <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 8px;">
      <h4 style="margin-top: 0;">👤 Customer Information</h4>
      <p style="margin: 5px 0;"><strong>Name:</strong> ${customerData.firstName || ""} ${customerData.lastName || ""}</p>
      <p style="margin: 5px 0;"><strong>Email:</strong> ${customerData.email || ""}</p>
      <p style="margin: 5px 0;"><strong>Phone:</strong> ${customerData.phoneNumber || "N/A"}</p>
      <p style="margin: 5px 0;"><strong>Application ID:</strong> ${customerData.applicationId || "N/A"}</p>
      ${customerData.buildingName ? `<p style="margin: 5px 0;"><strong>Building:</strong> ${customerData.buildingName}</p>` : ""}
    </div>
  `
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${subject}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
        .email-container { max-width: 650px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; padding: 20px 0; border-bottom: 3px solid #007bff; }
        .header h1 { color: #007bff; margin: 0; font-size: 24px; }
        .content { padding: 20px; }
        .message-box { background-color: #fafafa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
        .message-box strong, .message-box b { color: #1a56db; }
        .message-box em, .message-box i { color: #6b21a5; }
        .message-box mark { background-color: #fef08a; padding: 2px 4px; border-radius: 3px; }
        .footer { text-align: center; padding: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
        .button { display: inline-block; background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>📧 Mister Fyber</h1>
        </div>
        <div class="content">
          ${customerSection}
          ${locationBadge}
          ${senderSection}
          <div class="message-box">
            ${content}
          </div>
          ${billingSection}
        </div>
        <div class="footer">
          <p>Mister Fyber - Your trusted internet provider</p>
          <p><small>Need help? Contact us at <a href="mailto:${process.env.SUPPORT_EMAIL || "admin@misterfyber.com"}">${process.env.SUPPORT_EMAIL || "admin@misterfyber.com"}</a></small></p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ============================================================
// GET CUSTOMERS FOR EMAIL - FULLY OPTIMIZED + ALWAYS FRESH
// ============================================================
export const getCustomersForEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { search, status, hasBilling, forceRefresh, location } = req.query;

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });

    let query: any = {};

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { applicationId: { $regex: search, $options: "i" } },
      ];
    }

    if (status) query.status = status;

    if (location && location !== "all") {
      if (location === "breeze") {
        query.buildingName = { $regex: "breeze", $options: "i" };
      } else if (location === "sil") {
        query.buildingName = { $regex: /sil|silk/, $options: "i" };
      } else if (location === "other") {
        query.buildingName = {
          $not: { $regex: /breeze|sil|silk/, $options: "i" },
        };
      } else if (location === "wilconnect") {
        query.buildingName = {
          $regex: /el pueblo|vitalez|newport/i,
        };
      }
    }

    const applications = await Application.find(query)
      .select(
        "firstName lastName email phoneNumber applicationId status buildingName buildingId",
      )
      .lean()
      .sort({ createdAt: -1 })
      .limit(500);

    console.log(
      `📊 Found ${applications.length} applications for email selection`,
    );

    if (applications.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        total: 0,
        timestamp: new Date().toISOString(),
        _meta: {
          fetchedAt: new Date().toISOString(),
          totalApplications: 0,
          forceRefresh: forceRefresh === "true",
        },
      });
    }

    const applicationIds = applications.map((app) => app.applicationId);

    const billingCycles = await BillingCycle.find({
      applicationId: { $in: applicationIds },
    })
      .select("applicationId")
      .lean();

    const applicationsWithBilling = new Set(
      billingCycles.map((bc) => bc.applicationId),
    );

    const unpaidBillsAgg = await Billing.aggregate([
      {
        $match: {
          applicationId: { $in: applicationIds },
          status: { $in: ["sent", "overdue"] },
        },
      },
      {
        $group: {
          _id: "$applicationId",
          count: { $sum: 1 },
        },
      },
    ]);

    const applicationsWithUnpaidBills = new Set(
      unpaidBillsAgg.map((item) => item._id),
    );

    const lastBillsAgg = await Billing.aggregate([
      {
        $match: {
          applicationId: { $in: applicationIds },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: "$applicationId",
          lastBill: { $first: "$$ROOT" },
        },
      },
    ]);

    const lastBillMap = new Map(
      lastBillsAgg.map((item) => [item._id, item.lastBill]),
    );

    const enhancedCustomers = applications.map((app) => {
      const lastBill = lastBillMap.get(app.applicationId);
      const location = extractLocationFromBuildingName(app.buildingName);
      const isWilconnect = isWilconnectBuilding(app.buildingName);

      // ✅ Determine the sender email based on building
      let senderEmail = "";
      let senderLabel = "";
      if (isWilconnect) {
        senderEmail = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderLabel = "Workselpueblo";
      } else if (location !== "other") {
        senderEmail = getCollectionEmailByLocation(location);
        senderLabel = `${location.charAt(0).toUpperCase() + location.slice(1)} Collection`;
      } else {
        senderEmail =
          process.env.COLLECTION_EMAIL_DEFAULT || "admin@misterfyber.com";
        senderLabel = "Collection";
      }

      return {
        ...app,
        hasBilling: applicationsWithBilling.has(app.applicationId),
        hasUnpaidBills: applicationsWithUnpaidBills.has(app.applicationId),
        lastBillAmount: lastBill?.total || 0,
        lastBillStatus: lastBill?.status || null,
        location,
        isWilconnect,
        senderEmail,
        senderLabel,
        _fetchedAt: new Date().toISOString(),
      };
    });

    const filteredCustomers =
      hasBilling === "true"
        ? enhancedCustomers.filter((c) => c.hasBilling)
        : hasBilling === "false"
          ? enhancedCustomers.filter((c) => !c.hasBilling)
          : enhancedCustomers;

    console.log(
      `✅ Returning ${filteredCustomers.length} customers (fresh from DB)`,
    );

    res.status(200).json({
      success: true,
      data: filteredCustomers,
      total: filteredCustomers.length,
      timestamp: new Date().toISOString(),
      _meta: {
        fetchedAt: new Date().toISOString(),
        totalApplications: applications.length,
        forceRefresh: forceRefresh === "true",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET CUSTOMER BILLS
// ============================================================
export const getCustomerBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { applicationId } = req.params;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    });

    const [bills, customer] = await Promise.all([
      Billing.find({ applicationId }).sort({ createdAt: -1 }).lean(),
      Application.findOne({ applicationId })
        .select("firstName lastName email phoneNumber buildingName buildingId")
        .lean(),
    ]);

    // Add Wilconnect info
    const isWilconnect = isWilconnectBuilding(customer?.buildingName);
    const senderInfo = isWilconnect
      ? {
          email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
          label: "Workselpueblo",
        }
      : null;

    res.status(200).json({
      success: true,
      data: {
        customer: customer
          ? {
              ...customer,
              isWilconnect,
              senderInfo,
            }
          : null,
        bills,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET SENDER OPTIONS (NEW ENDPOINT)
// ============================================================
export const getSenderOptions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { location, buildingName } = req.query as {
      location?: string;
      buildingName?: string;
    };

    const options = getAllSenderOptions(location, buildingName);

    res.status(200).json({
      success: true,
      data: options,
      isWilconnect: isWilconnectBuilding(buildingName),
      autoSenderEmail: isWilconnectBuilding(buildingName)
        ? ADDITIONAL_SENDER_EMAILS.workselpueblo
        : null,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// SEND MANUAL EMAIL - UPDATED WITH SENDER TYPE + WILCONNECT
// ============================================================
export const sendManualEmail = async (
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
      subject,
      message,
      richTextContent,
      includeBilling,
      billIds,
      sendCopyToAdmin,
      attachments,
      priority,
      useAdminSender,
      senderType: rawSenderType,
    } = req.body;

    let senderType = getSenderTypeFromRequest(req.body);

    console.log("📧 sendManualEmail called");
    console.log("   Application ID:", applicationId);
    console.log("   Subject:", subject);
    console.log("   Requested Sender Type:", senderType);

    if (!applicationId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "applicationId is required",
      });
    }

    if (!subject || !message) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Subject and message are required",
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

    if (!application.email) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Customer does not have an email address",
      });
    }

    let location = extractLocationFromBuildingName(application.buildingName);

    if (location === "other" && application.buildingId) {
      const Building = require("../models/Building").default;
      const building = await Building.findById(application.buildingId).lean();
      if (building) {
        const buildingLocation = extractLocationFromBuildingName(building.name);
        if (buildingLocation !== "other") {
          location = buildingLocation;
        } else if (building.location) {
          location = building.location;
        }
      }
    }

    // ✅ CHECK: If Wilconnect building, override sender type to workselpueblo
    const isWilconnect = isWilconnectBuilding(application.buildingName);
    if (isWilconnect) {
      console.log(
        `🏢 Wilconnect building detected: "${application.buildingName}" - Overriding sender to workselpueblo`,
      );
      senderType = "workselpueblo";
    }

    let billingDataArray: any[] = [];
    let selectedBillIds: string[] = [];
    if (
      includeBilling &&
      billIds &&
      Array.isArray(billIds) &&
      billIds.length > 0
    ) {
      const bills = await Billing.find({ _id: { $in: billIds } }).lean();
      billingDataArray = bills;
      selectedBillIds = billIds;

      if (bills.length === 0) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "No bills found for the selected IDs",
        });
      }

      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";
      billingDataArray = billingDataArray.map((bill) => ({
        ...bill,
        paymentLink: `${frontendUrl}/billing/${bill._id}`,
      }));
    }

    const senderInfo = getSenderInfoByType(
      senderType,
      location,
      application.buildingName,
    );
    const senderInfoText = `Sent from: ${senderInfo.label} (${senderInfo.email})`;

    console.log(
      `📧 Final sender info: ${senderInfo.label} <${senderInfo.email}>`,
    );

    const emailHtml = generateEmailPreview(
      subject,
      message,
      includeBilling && billingDataArray.length > 0,
      billingDataArray,
      application,
      senderInfoText,
      richTextContent,
    );

    const isConfigured = emailService.isConfigured();

    let emailSent = false;
    let emailError = null;

    try {
      if (!isConfigured) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `📧 [DEV MODE] Would send email to: ${application.email}`,
          );
          emailSent = true;
        } else {
          throw new Error(
            "Email service is not configured. Please check BREVO_API_KEY in .env file.",
          );
        }
      } else {
        emailSent = await emailService.sendEmail(
          application.email,
          subject,
          emailHtml,
          true,
          location,
          {
            useAdminSender: senderType === "admin",
            senderType: senderType,
            isWilconnect: isWilconnect,
          },
        );

        if (!emailSent) {
          emailError = "Email service returned false - check logs for details";
        }
      }
    } catch (error: any) {
      emailError = error.message || "Email service error";
      console.error("❌ Email sending error:", error);
    }

    let adminCopySent = false;
    if (emailSent && sendCopyToAdmin) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
      if (adminEmail) {
        try {
          const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #007bff;">📧 Admin Copy - Manual Email Sent</h2>
              <p><strong>Sent To:</strong> ${application.firstName} ${application.lastName} (${application.email})</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Sent By:</strong> ${req.user?.email || req.user?.username || "Admin"}</p>
              <p><strong>Sender Type:</strong> ${senderInfo.label}</p>
              <p><strong>Sender Email:</strong> ${senderInfo.email}</p>
              <p><strong>Location:</strong> ${location || "NONE"}</p>
              <p><strong>Building:</strong> ${application.buildingName || "N/A"}</p>
              <p><strong>Is Wilconnect:</strong> ${isWilconnect ? "YES" : "NO"}</p>
            </div>
          `;
          adminCopySent = await emailService.sendEmail(
            adminEmail,
            `[ADMIN COPY] ${subject}`,
            adminHtml,
            false,
          );
        } catch (adminError) {
          console.error("Failed to send admin copy:", adminError);
        }
      }
    }

    const sentRecord = new EmailSentRecord({
      applicationId: application.applicationId,
      customerName: `${application.firstName} ${application.lastName}`,
      customerEmail: application.email,
      subject,
      message,
      richTextContent: richTextContent || message,
      sentAt: new Date(),
      status: emailSent ? "sent" : "failed",
      isBulk: false,
      recipientCount: 1,
      includeBilling: includeBilling || false,
      billIds: selectedBillIds,
      billCount: billingDataArray.length,
      error: emailError || (emailSent ? undefined : "Failed to send email"),
      sentBy: req.user?.username || req.user?.email || "Admin",
      sentByEmail: req.user?.email || "admin@misterfyber.com",
      adminCopySent: adminCopySent || false,
      senderType: senderType,
      location: location || "unknown",
      collectionEmail:
        location && location !== "other"
          ? getCollectionEmailByLocation(location)
          : null,
      isScheduled: false,
    });

    await sentRecord.save({ session });
    await session.commitTransaction();

    if (!emailSent) {
      const errorMessage =
        emailError ||
        "Failed to send email. Please check email service configuration.";
      return res.status(500).json({
        success: false,
        message: errorMessage,
        details: {
          error: emailError,
          customerEmail: application.email,
          isEmailConfigured: emailService.isConfigured(),
          location: location || "unknown",
          billsIncluded: billingDataArray.length,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: `Email sent successfully to ${application.firstName} ${application.lastName} via ${senderInfo.label}${isWilconnect ? " (Wilconnect - Auto)" : ""}`,
      data: {
        to: application.email,
        toName: `${application.firstName} ${application.lastName}`,
        subject,
        sentAt: new Date().toISOString(),
        adminCopySent,
        recordId: sentRecord._id,
        senderType: senderType,
        senderLabel: senderInfo.label,
        senderEmail: senderInfo.email,
        location: location || "unknown",
        isWilconnect,
        billsIncluded: billingDataArray.length,
        totalAmount: billingDataArray.reduce(
          (sum, bill) => sum + (bill.total || 0),
          0,
        ),
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
// SEND BULK EMAILS - UPDATED WITH SENDER TYPE + WILCONNECT
// ============================================================
export const sendBulkEmails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const {
      applicationIds,
      subject,
      message,
      richTextContent,
      includeBilling,
      billType,
      sendCopyToAdmin,
      useAdminSender,
      locationFilter,
      senderType: rawSenderType,
    } = req.body;

    const baseSenderType = getSenderTypeFromRequest(req.body);

    console.log("📧 sendBulkEmails called");
    console.log("   Recipients:", applicationIds?.length || 0);
    console.log("   Base Sender Type:", baseSenderType);

    if (
      !applicationIds ||
      !Array.isArray(applicationIds) ||
      applicationIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "applicationIds array is required with at least one ID",
      });
    }

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Subject and message are required",
      });
    }

    const isConfigured = emailService.isConfigured();
    if (!isConfigured && process.env.NODE_ENV !== "development") {
      return res.status(500).json({
        success: false,
        message: "Email service is not configured.",
      });
    }

    const applications = await Application.find({
      applicationId: { $in: applicationIds },
    }).lean();

    const applicationMap = new Map(
      applications.map((app) => [app.applicationId, app]),
    );

    let allBills: any[] = [];
    if (includeBilling) {
      let billQuery: any = { applicationId: { $in: applicationIds } };

      if (billType === "unpaid") {
        billQuery.status = { $in: ["sent", "overdue"] };
      } else if (billType === "installation") {
        billQuery.isInstallationBill = true;
        billQuery.installationFeePaid = false;
      }

      allBills = await Billing.find(billQuery).lean();
    }

    const billsByApplication = new Map<string, any[]>();
    for (const bill of allBills) {
      if (!billsByApplication.has(bill.applicationId)) {
        billsByApplication.set(bill.applicationId, []);
      }
      billsByApplication.get(bill.applicationId)!.push(bill);
    }

    if (includeBilling && billType === "latest") {
      const latestBillsAgg = await Billing.aggregate([
        {
          $match: {
            applicationId: { $in: applicationIds },
          },
        },
        {
          $sort: { createdAt: -1 },
        },
        {
          $group: {
            _id: "$applicationId",
            lastBill: { $first: "$$ROOT" },
          },
        },
      ]);

      for (const item of latestBillsAgg) {
        billsByApplication.set(item._id, [item.lastBill]);
      }
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;
    const failedEmails = [];

    for (const applicationId of applicationIds) {
      try {
        const application = applicationMap.get(applicationId);
        if (!application || !application.email) {
          results.push({
            applicationId,
            success: false,
            error: "Application not found or no email",
          });
          failCount++;
          continue;
        }

        const location = extractLocationFromBuildingName(
          application.buildingName,
        );

        if (locationFilter && locationFilter !== "all") {
          if (location !== locationFilter) {
            console.log(
              `⏭️ Skipping ${applicationId} - location ${location} doesn't match filter ${locationFilter}`,
            );
            continue;
          }
        }

        // ✅ CHECK: If Wilconnect building, override sender type to workselpueblo
        const isWilconnect = isWilconnectBuilding(application.buildingName);
        let effectiveSenderType = baseSenderType;
        if (isWilconnect) {
          effectiveSenderType = "workselpueblo";
          console.log(
            `🏢 Wilconnect building: "${application.buildingName}" - Using workselpueblo for ${applicationId}`,
          );
        }

        const billingDataArray = billsByApplication.get(applicationId) || [];
        const selectedBillIds = billingDataArray.map((b) => b._id);

        const senderInfo = getSenderInfoByType(
          effectiveSenderType,
          location,
          application.buildingName,
        );
        const senderInfoText = `Sent from: ${senderInfo.label} (${senderInfo.email})`;

        const emailHtml = generateEmailPreview(
          subject,
          message,
          includeBilling && billingDataArray.length > 0,
          billingDataArray,
          application,
          senderInfoText,
          richTextContent,
        );

        let emailSent = false;
        let emailError = null;

        try {
          if (isConfigured || process.env.NODE_ENV === "development") {
            if (!isConfigured && process.env.NODE_ENV === "development") {
              emailSent = true;
            } else {
              emailSent = await emailService.sendEmail(
                application.email,
                subject,
                emailHtml,
                true,
                location,
                {
                  useAdminSender: effectiveSenderType === "admin",
                  senderType: effectiveSenderType,
                  isWilconnect: isWilconnect,
                },
              );
            }
          } else {
            throw new Error("Email service is not configured");
          }
        } catch (error: any) {
          emailError = error.message || "Email service error";
          console.error(`Failed to send email to ${application.email}:`, error);
        }

        const record = new EmailSentRecord({
          applicationId: application.applicationId,
          customerName: `${application.firstName} ${application.lastName}`,
          customerEmail: application.email,
          subject,
          message,
          richTextContent: richTextContent || message,
          sentAt: new Date(),
          status: emailSent ? "sent" : "failed",
          isBulk: true,
          recipientCount: 1,
          includeBilling: includeBilling || false,
          billType: billType,
          billIds: selectedBillIds,
          billCount: billingDataArray.length,
          error: emailError || (emailSent ? undefined : "Failed to send email"),
          sentBy: req.user?.username || req.user?.email || "Admin",
          sentByEmail: req.user?.email || "admin@misterfyber.com",
          adminCopySent: false,
          senderType: effectiveSenderType,
          location: location || "unknown",
          collectionEmail:
            location && location !== "other"
              ? getCollectionEmailByLocation(location)
              : null,
          isScheduled: false,
        });

        await record.save();

        if (emailSent) {
          successCount++;
          results.push({
            applicationId,
            email: application.email,
            name: `${application.firstName} ${application.lastName}`,
            success: true,
            location: location || "unknown",
            isWilconnect,
            senderLabel: senderInfo.label,
            senderEmail: senderInfo.email,
            billsIncluded: billingDataArray.length,
          });
        } else {
          failCount++;
          failedEmails.push({
            applicationId,
            email: application.email,
            name: `${application.firstName} ${application.lastName}`,
            error: emailError || "Email sending failed",
          });
          results.push({
            applicationId,
            email: application.email,
            success: false,
            error: emailError || "Email sending failed",
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        failCount++;
        results.push({
          applicationId,
          success: false,
          error: String(error),
        });
      }
    }

    // Count how many were Wilconnect
    const wilconnectCount = results.filter((r) => r.isWilconnect).length;

    res.status(200).json({
      success: true,
      message: `Bulk email completed. Sent: ${successCount}, Failed: ${failCount}${wilconnectCount > 0 ? ` (${wilconnectCount} via Workselpueblo for Wilconnect buildings)` : ""}`,
      data: {
        total: applicationIds.length,
        successCount,
        failCount,
        wilconnectCount,
        results,
        failedEmails: failCount > 0 ? failedEmails : undefined,
        senderType: baseSenderType,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// SAVE EMAIL TEMPLATE
// ============================================================
export const saveEmailTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { name, subject, message, category, includeBillingDefault } =
      req.body;

    if (!name || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, subject, and message are required",
      });
    }

    const existingTemplate = await EmailTemplate.findOne({ name });
    if (existingTemplate) {
      existingTemplate.subject = subject;
      existingTemplate.message = message;
      existingTemplate.category = category || "general";
      existingTemplate.includeBillingDefault = includeBillingDefault || false;
      existingTemplate.updatedBy =
        req.user?.username || req.user?.email || "Admin";
      existingTemplate.updatedByEmail =
        req.user?.email || "admin@misterfyber.com";
      await existingTemplate.save();

      return res.status(200).json({
        success: true,
        message: `Template "${name}" updated successfully`,
        data: existingTemplate,
      });
    }

    const newTemplate = new EmailTemplate({
      name,
      subject,
      message,
      category: category || "general",
      includeBillingDefault: includeBillingDefault || false,
      createdBy: req.user?.username || req.user?.email || "Admin",
      createdByEmail: req.user?.email || "admin@misterfyber.com",
      updatedBy: req.user?.username || req.user?.email || "Admin",
      updatedByEmail: req.user?.email || "admin@misterfyber.com",
    });

    await newTemplate.save();

    res.status(200).json({
      success: true,
      message: `Template "${name}" saved successfully`,
      data: newTemplate,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET EMAIL TEMPLATES
// ============================================================
export const getEmailTemplates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { category, search } = req.query;

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    });

    let query: any = {};

    if (category && category !== "all") query.category = category;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
      ];
    }

    const templates = await EmailTemplate.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const formattedTemplates = templates.map((template) => ({
      id: template._id.toString(),
      name: template.name,
      subject: template.subject,
      message: template.message,
      category: template.category,
      includeBillingDefault: template.includeBillingDefault,
      createdAt: template.createdAt.toISOString(),
      updatedBy: template.updatedBy,
      createdBy: template.createdBy,
    }));

    res.status(200).json({
      success: true,
      data: formattedTemplates,
      total: formattedTemplates.length,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// UPDATE EMAIL TEMPLATE
// ============================================================
export const updateEmailTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { templateId } = req.params;
    const { name, subject, message, category, includeBillingDefault } =
      req.body;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        message: "Template ID is required",
      });
    }

    const template = await EmailTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        message: "Template not found",
      });
    }

    if (name && name !== template.name) {
      const existingTemplate = await EmailTemplate.findOne({ name });
      if (existingTemplate && existingTemplate._id.toString() !== templateId) {
        return res.status(400).json({
          success: false,
          message: `Template with name "${name}" already exists`,
        });
      }
      template.name = name;
    }

    if (subject) template.subject = subject;
    if (message) template.message = message;
    if (category) template.category = category;
    if (includeBillingDefault !== undefined) {
      template.includeBillingDefault = includeBillingDefault;
    }
    template.updatedBy = req.user?.username || req.user?.email || "Admin";
    template.updatedByEmail = req.user?.email || "admin@misterfyber.com";

    await template.save();

    res.status(200).json({
      success: true,
      message: `Template "${template.name}" updated successfully`,
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// DELETE EMAIL TEMPLATE
// ============================================================
export const deleteEmailTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        message: "Template ID is required",
      });
    }

    const template = await EmailTemplate.findByIdAndDelete(templateId);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: "Template not found",
      });
    }

    res.status(200).json({
      success: true,
      message: `Template "${template.name}" deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// PREVIEW EMAIL - UPDATED WITH SENDER TYPE + WILCONNECT
// ============================================================
export const previewEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const {
      subject,
      message,
      richTextContent,
      includeBilling,
      applicationId,
      billIds,
      useAdminSender,
      senderType: rawSenderType,
    } = req.body;

    let senderType = getSenderTypeFromRequest(req.body);

    console.log("📧 previewEmail called");
    console.log("   Requested Sender Type:", senderType);

    let customerData = null;
    let billingDataArray: any[] = [];
    let location = "";
    let isWilconnect = false;

    if (applicationId) {
      customerData = await Application.findOne({ applicationId }).lean();
      if (customerData) {
        location = extractLocationFromBuildingName(customerData.buildingName);
        isWilconnect = isWilconnectBuilding(customerData.buildingName);

        if (location === "other" && customerData.buildingId) {
          const Building = require("../models/Building").default;
          const building = await Building.findById(
            customerData.buildingId,
          ).lean();
          if (building) {
            const buildingLocation = extractLocationFromBuildingName(
              building.name,
            );
            if (buildingLocation !== "other") {
              location = buildingLocation;
            } else if (building.location) {
              location = building.location;
            }
          }
        }

        // ✅ CHECK: If Wilconnect building, override sender type
        if (isWilconnect) {
          console.log(
            `🏢 Wilconnect building in preview: "${customerData.buildingName}" - Using workselpueblo`,
          );
          senderType = "workselpueblo";
        }
      }
    }

    if (
      includeBilling &&
      billIds &&
      Array.isArray(billIds) &&
      billIds.length > 0
    ) {
      const bills = await Billing.find({ _id: { $in: billIds } }).lean();
      billingDataArray = bills;

      if (billingDataArray.length > 0) {
        const frontendUrl =
          process.env.FRONTEND_URL || "https://www.misterfyber.com";
        billingDataArray = billingDataArray.map((bill) => ({
          ...bill,
          paymentLink: `${frontendUrl}/billing/${bill._id}`,
        }));
      }
    }

    const senderInfo = getSenderInfoByType(
      senderType,
      location,
      customerData?.buildingName,
    );
    const senderInfoText = `Sent from: ${senderInfo.label} (${senderInfo.email})`;

    const previewHtml = generateEmailPreview(
      subject,
      message,
      includeBilling && billingDataArray.length > 0,
      billingDataArray,
      customerData,
      senderInfoText,
      richTextContent,
    );

    res.status(200).json({
      success: true,
      data: {
        html: previewHtml,
        subject,
        message,
        location: location || "unknown",
        isWilconnect,
        senderInfo: senderInfoText,
        senderType: senderType,
        senderLabel: senderInfo.label,
        senderEmail: senderInfo.email,
        billsIncluded: billingDataArray.length,
        totalAmount: billingDataArray.reduce(
          (sum, bill) => sum + (bill.total || 0),
          0,
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// SEND REMINDER TO UNPAID - UPDATED WITH SENDER TYPE + WILCONNECT
// ============================================================
export const sendReminderToUnpaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const {
      customMessage,
      includeDueDateReminder,
      useAdminSender,
      senderType: rawSenderType,
    } = req.body;

    const baseSenderType = getSenderTypeFromRequest(req.body);

    console.log("📧 sendReminderToUnpaid called");
    console.log("   Base Sender Type:", baseSenderType);

    const isConfigured = emailService.isConfigured();
    if (!isConfigured && process.env.NODE_ENV !== "development") {
      return res.status(500).json({
        success: false,
        message: "Email service is not configured.",
      });
    }

    const unpaidBills = await Billing.find({
      status: { $in: ["sent", "overdue"] },
      isInstallationBill: false,
    })
      .sort({ dueDate: 1 })
      .lean();

    const uniqueApplicationIds = [
      ...new Set(unpaidBills.map((bill) => bill.applicationId)),
    ];

    const applications = await Application.find({
      applicationId: { $in: uniqueApplicationIds },
    }).lean();

    const applicationMap = new Map(
      applications.map((app) => [app.applicationId, app]),
    );

    const billsByApplication = new Map<string, any[]>();
    for (const bill of unpaidBills) {
      if (!billsByApplication.has(bill.applicationId)) {
        billsByApplication.set(bill.applicationId, []);
      }
      billsByApplication.get(bill.applicationId)!.push(bill);
    }

    const results = [];
    let sentCount = 0;
    let failCount = 0;

    for (const applicationId of uniqueApplicationIds) {
      if (!applicationId) continue;

      const application = applicationMap.get(applicationId);
      if (!application || !application.email) continue;

      const location = extractLocationFromBuildingName(
        application.buildingName,
      );

      // ✅ CHECK: If Wilconnect building, override sender type
      const isWilconnect = isWilconnectBuilding(application.buildingName);
      let effectiveSenderType = baseSenderType;
      if (isWilconnect) {
        effectiveSenderType = "workselpueblo";
        console.log(
          `🏢 Wilconnect building in reminder: "${application.buildingName}" - Using workselpueblo`,
        );
      }

      const customerBills = billsByApplication.get(applicationId) || [];
      const totalAmount = customerBills.reduce(
        (sum, bill) => sum + (bill.total || 0),
        0,
      );

      let earliestDueDate: Date | null = null;
      for (const bill of customerBills) {
        if (bill.dueDate) {
          const dueDateObj = new Date(bill.dueDate);
          if (!earliestDueDate || dueDateObj < earliestDueDate) {
            earliestDueDate = dueDateObj;
          }
        }
      }

      let reminderMessage =
        customMessage ||
        "This is a friendly reminder about your unpaid bill(s).";

      if (includeDueDateReminder && earliestDueDate) {
        const dueDateStr = earliestDueDate.toLocaleDateString();
        reminderMessage += `\n\nYour payment of ₱${totalAmount.toLocaleString()} was due on ${dueDateStr}. Please settle your account to avoid service interruption.`;
      } else {
        reminderMessage += `\n\nYou have ${customerBills.length} unpaid bill(s) totaling ₱${totalAmount.toLocaleString()}.`;
      }

      const senderInfo = getSenderInfoByType(
        effectiveSenderType,
        location,
        application.buildingName,
      );
      const senderInfoText = `Sent from: ${senderInfo.label} (${senderInfo.email})`;

      const emailHtml = generateEmailPreview(
        "Payment Reminder - Unpaid Bill(s)",
        reminderMessage,
        true,
        customerBills,
        application,
        senderInfoText,
      );

      let emailSent = false;
      let emailError = null;

      try {
        if (isConfigured || process.env.NODE_ENV === "development") {
          if (!isConfigured && process.env.NODE_ENV === "development") {
            emailSent = true;
          } else {
            emailSent = await emailService.sendEmail(
              application.email,
              `⚠️ Payment Reminder - ${customerBills.length} Unpaid Bill(s)`,
              emailHtml,
              true,
              location,
              {
                useAdminSender: effectiveSenderType === "admin",
                senderType: effectiveSenderType,
                isWilconnect: isWilconnect,
              },
            );
          }
        } else {
          throw new Error("Email service is not configured");
        }
      } catch (error: any) {
        emailError = error.message || "Email service error";
        console.error(
          `Failed to send reminder to ${application.email}:`,
          error,
        );
      }

      const record = new EmailSentRecord({
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        customerEmail: application.email,
        subject: `⚠️ Payment Reminder - ${customerBills.length} Unpaid Bill(s)`,
        message: reminderMessage,
        sentAt: new Date(),
        status: emailSent ? "sent" : "failed",
        isBulk: true,
        recipientCount: 1,
        includeBilling: true,
        billType: "unpaid",
        billIds: customerBills.map((b) => b._id),
        billCount: customerBills.length,
        error:
          emailError || (emailSent ? undefined : "Failed to send reminder"),
        sentBy: req.user?.username || req.user?.email || "Admin",
        sentByEmail: req.user?.email || "admin@misterfyber.com",
        adminCopySent: false,
        senderType: effectiveSenderType,
        location: location || "unknown",
        collectionEmail:
          location && location !== "other"
            ? getCollectionEmailByLocation(location)
            : null,
        isScheduled: false,
      });

      await record.save();

      if (emailSent) {
        sentCount++;
        results.push({
          applicationId,
          email: application.email,
          name: `${application.firstName} ${application.lastName}`,
          billsCount: customerBills.length,
          totalAmount,
          location: location || "unknown",
          isWilconnect,
          senderLabel: senderInfo.label,
          senderEmail: senderInfo.email,
        });
      } else {
        failCount++;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const wilconnectCount = results.filter((r) => r.isWilconnect).length;

    res.status(200).json({
      success: true,
      message: `Sent reminders to ${sentCount} customers (${failCount} failed)${wilconnectCount > 0 ? ` - ${wilconnectCount} via Workselpueblo for Wilconnect buildings` : ""}`,
      data: {
        sentCount,
        failCount,
        totalCustomers: uniqueApplicationIds.length,
        wilconnectCount,
        results,
        senderType: baseSenderType,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET SENT RECORDS
// ============================================================
export const getSentRecords = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { applicationId, status, isBulk, scheduleId } = req.query;

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    });

    let query: any = {};

    if (applicationId) query.applicationId = applicationId;
    if (status) query.status = status;
    if (isBulk !== undefined) query.isBulk = isBulk === "true";
    if (scheduleId) query.scheduleId = scheduleId;

    const records = await EmailSentRecord.find(query)
      .sort({ sentAt: -1 })
      .limit(200)
      .lean();

    const formattedRecords = records.map((record) => ({
      id: record._id.toString(),
      applicationId: record.applicationId,
      customerName: record.customerName,
      customerEmail: record.customerEmail,
      subject: record.subject,
      message: record.message,
      richTextContent: record.richTextContent || record.message,
      sentAt: record.sentAt,
      status: record.status,
      isBulk: record.isBulk,
      recipientCount: record.recipientCount || 1,
      includeBilling: record.includeBilling,
      billType: record.billType,
      billCount: (record as any).billCount || 0,
      error: record.error,
      senderType: (record as any).senderType || "collection",
      location: (record as any).location || "unknown",
      collectionEmail: (record as any).collectionEmail || null,
      isScheduled: (record as any).isScheduled || false,
      scheduleId: (record as any).scheduleId || null,
    }));

    res.status(200).json({
      success: true,
      data: formattedRecords,
      total: formattedRecords.length,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// DELETE SENT RECORD
// ============================================================
export const deleteSentRecord = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { recordId } = req.params;

    if (!recordId) {
      return res.status(400).json({
        success: false,
        message: "Record ID is required",
      });
    }

    const record = await EmailSentRecord.findByIdAndDelete(recordId);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Sent record not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Sent record deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// ✅ FIXED: SCHEDULE EMAIL - PROPER TIMEZONE HANDLING
// ============================================================
export const scheduleEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const {
      name,
      applicationIds,
      subject,
      message,
      richTextContent,
      includeBilling,
      billIds,
      billType,
      sendCopyToAdmin,
      useAdminSender,
      scheduledFor,
      locationFilter,
      recurring,
      senderType: rawSenderType,
    } = req.body;

    const senderType = getSenderTypeFromRequest(req.body);

    console.log("📧 scheduleEmail called");
    console.log("   Name:", name);
    console.log("   Sender Type:", senderType);
    console.log("   Raw scheduledFor:", scheduledFor);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Schedule name is required",
      });
    }

    if (!scheduledFor) {
      return res.status(400).json({
        success: false,
        message: "Scheduled date and time is required",
      });
    }

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Subject and message are required",
      });
    }

    let scheduleDate: Date;
    try {
      scheduleDate = parseScheduledDate(scheduledFor);
    } catch (dateError: any) {
      return res.status(400).json({
        success: false,
        message: `Invalid schedule date: ${dateError.message}`,
      });
    }

    console.log(`📅 Parsed schedule date (UTC): ${scheduleDate.toISOString()}`);

    const now = new Date();
    if (scheduleDate.getTime() <= now.getTime() - 60000) {
      return res.status(400).json({
        success: false,
        message: "Scheduled time must be in the future",
      });
    }

    let targetApplicationIds = applicationIds || [];
    if (targetApplicationIds.length === 0 && locationFilter) {
      let query: any = {};
      if (locationFilter === "breeze") {
        query.buildingName = { $regex: "breeze", $options: "i" };
      } else if (locationFilter === "sil") {
        query.buildingName = { $regex: /sil|silk/, $options: "i" };
      } else if (locationFilter === "other") {
        query.buildingName = {
          $not: { $regex: /breeze|sil|silk/, $options: "i" },
        };
      }

      const customers = await Application.find(query)
        .select("applicationId")
        .lean();

      targetApplicationIds = customers.map((c) => c.applicationId);
      console.log(
        `📍 Found ${targetApplicationIds.length} customers for location filter: ${locationFilter}`,
      );
    }

    if (targetApplicationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No customers selected for the scheduled email",
      });
    }

    let validatedBillIds: string[] = [];
    if (
      includeBilling &&
      billIds &&
      Array.isArray(billIds) &&
      billIds.length > 0
    ) {
      validatedBillIds = billIds;
      console.log(`📋 Bill IDs provided: ${validatedBillIds.length}`);
    }

    const schedule = new EmailSchedule({
      name,
      applicationIds: targetApplicationIds,
      subject,
      message,
      richTextContent: richTextContent || message,
      includeBilling: includeBilling || false,
      billIds: validatedBillIds,
      billType: billType || "unpaid",
      sendCopyToAdmin: sendCopyToAdmin || false,
      useAdminSender: senderType === "admin",
      senderType: senderType,
      scheduledFor: scheduleDate,
      status: "pending",
      totalRecipients: targetApplicationIds.length,
      createdBy: req.user?.username || req.user?.email || "Admin",
      createdByEmail: req.user?.email || "admin@misterfyber.com",
      locationFilter: locationFilter || "all",
      recurring: recurring || { enabled: false },
    });

    await schedule.save();

    console.log(`✅ Email scheduled at: ${scheduleDate.toISOString()}`);
    console.log(
      `📧 Note: Wilconnect buildings will automatically use workselpueblo@fyberblizz.com`,
    );

    const senderInfo = getSenderInfoByType(senderType);

    res.status(200).json({
      success: true,
      message: `Email scheduled successfully for ${scheduleDate.toLocaleString()} via ${senderInfo.label}`,
      data: {
        scheduleId: schedule._id,
        name: schedule.name,
        scheduledFor: schedule.scheduledFor,
        totalRecipients: schedule.totalRecipients,
        status: schedule.status,
        senderType: senderType,
        senderLabel: senderInfo.label,
        senderEmail: senderInfo.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET SCHEDULED EMAILS
// ============================================================
export const getScheduledEmails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { status, page = 1, limit = 50 } = req.query;

    const query: any = {};
    if (status && status !== "all") query.status = status;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 50;
    const skip = (pageNum - 1) * limitNum;

    // ✅ FIX: Palitan ang sort. Dapat createdAt: -1 para pinaka-bago ang nasa taas.
    const schedules = await EmailSchedule.find(query)
      .sort({ createdAt: -1 }) // <--- ITO ANG BINAGO
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await EmailSchedule.countDocuments(query);

    const formattedSchedules = schedules.map((schedule) => ({
      id: schedule._id.toString(),
      name: schedule.name,
      applicationIds: schedule.applicationIds,
      subject: schedule.subject,
      message: schedule.message,
      richTextContent: schedule.richTextContent,
      includeBilling: schedule.includeBilling,
      billIds: schedule.billIds || [],
      billType: schedule.billType,
      sendCopyToAdmin: schedule.sendCopyToAdmin,
      useAdminSender: schedule.useAdminSender,
      senderType:
        (schedule as any).senderType ||
        (schedule.useAdminSender ? "admin" : "collection"),
      scheduledFor: schedule.scheduledFor,
      status: schedule.status,
      sentCount: schedule.sentCount,
      failedCount: schedule.failedCount,
      totalRecipients: schedule.totalRecipients,
      lastRunAt: schedule.lastRunAt,
      completedAt: schedule.completedAt,
      error: schedule.error,
      createdBy: schedule.createdBy,
      locationFilter: schedule.locationFilter,
      recurring: schedule.recurring,
      createdAt: schedule.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: formattedSchedules,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// UPDATE SCHEDULED EMAIL
// ============================================================
export const updateScheduledEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { scheduleId } = req.params;
    const updates = req.body;

    const schedule = await EmailSchedule.findById(scheduleId);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Scheduled email not found",
      });
    }

    if (schedule.status === "cancelled" || schedule.status === "sent") {
      return res.status(400).json({
        success: false,
        message: `Cannot update a ${schedule.status} schedule`,
      });
    }

    if (updates.senderType || updates.useAdminSender !== undefined) {
      const newSenderType = getSenderTypeFromRequest(updates);
      (schedule as any).senderType = newSenderType;
      schedule.useAdminSender = newSenderType === "admin";
    }

    const allowedFields = [
      "name",
      "subject",
      "message",
      "richTextContent",
      "includeBilling",
      "billIds",
      "billType",
      "sendCopyToAdmin",
      "scheduledFor",
      "locationFilter",
      "recurring",
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (schedule as any)[field] = updates[field];
      }
    }

    if (updates.scheduledFor) {
      try {
        const newDate = parseScheduledDate(updates.scheduledFor);
        if (newDate.getTime() <= Date.now() - 60000) {
          return res.status(400).json({
            success: false,
            message: "Scheduled time must be in the future",
          });
        }
        schedule.scheduledFor = newDate;
      } catch (dateError: any) {
        return res.status(400).json({
          success: false,
          message: `Invalid schedule date: ${dateError.message}`,
        });
      }
    }

    await schedule.save();

    res.status(200).json({
      success: true,
      message: "Schedule updated successfully",
      data: schedule,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// DELETE SCHEDULED EMAIL (HARD DELETE)
// ============================================================
export const deleteScheduledEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { scheduleId } = req.params;

    const schedule = await EmailSchedule.findById(scheduleId);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Scheduled email not found",
      });
    }

    if (schedule.status === "processing") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a processing schedule",
      });
    }

    // ✅ TOTOO NANG BUBURAHIN SA DATABASE
    await EmailSchedule.findByIdAndDelete(scheduleId);

    res.status(200).json({
      success: true,
      message: "Scheduled email deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// CANCEL SCHEDULED EMAIL
// ============================================================
export const cancelScheduledEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { scheduleId } = req.params;

    const schedule = await EmailSchedule.findById(scheduleId);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Scheduled email not found",
      });
    }

    if (schedule.status === "processing" || schedule.status === "sent") {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${schedule.status} schedule`,
      });
    }

    schedule.status = "cancelled";
    await schedule.save();

    res.status(200).json({
      success: true,
      message: "Scheduled email cancelled successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET SCHEDULE STATS
// ============================================================
export const getScheduleStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const [pending, processing, sent, failed, cancelled] = await Promise.all([
      EmailSchedule.countDocuments({ status: "pending" }),
      EmailSchedule.countDocuments({ status: "processing" }),
      EmailSchedule.countDocuments({ status: "sent" }),
      EmailSchedule.countDocuments({ status: "failed" }),
      EmailSchedule.countDocuments({ status: "cancelled" }),
    ]);

    const schedules = await EmailSchedule.find({
      status: { $in: ["pending", "processing", "sent"] },
    }).lean();

    let totalRecipients = 0;
    for (const schedule of schedules) {
      totalRecipients += schedule.totalRecipients || 0;
    }

    const upcoming = await EmailSchedule.find({
      status: "pending",
      scheduledFor: { $gte: new Date() },
    })
      .sort({ scheduledFor: 1 })
      .limit(5)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        pending,
        processing,
        sent,
        failed,
        cancelled,
        totalRecipients,
        upcoming: upcoming.map((s) => ({
          id: s._id,
          name: s.name,
          scheduledFor: s.scheduledFor,
          totalRecipients: s.totalRecipients,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// FORCE PROCESS SCHEDULES
// ============================================================
export const forceProcessSchedules = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { processScheduledEmails } = require("../services/schedulerService");
    await processScheduledEmails();

    res.status(200).json({
      success: true,
      message: "Scheduled emails processed successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// EXPORT DEFAULT
// ============================================================
export default {
  getCustomersForEmail,
  getCustomerBills,
  getSenderOptions,
  sendManualEmail,
  sendBulkEmails,
  saveEmailTemplate,
  getEmailTemplates,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmail,
  sendReminderToUnpaid,
  getSentRecords,
  deleteSentRecord,
  scheduleEmail,
  getScheduledEmails,
  updateScheduledEmail,
  deleteScheduledEmail,
  cancelScheduledEmail,
  getScheduleStats,
  forceProcessSchedules,
};
