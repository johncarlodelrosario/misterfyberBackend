// backend/src/services/emailService.ts - COMPLETE FIXED VERSION
// ✅ MAIN FIX: getBrandForApplication uses buildingName directly.
// ✅ FIX (NEW): areCustomerEmailsEnabled — when no adminId is provided
//    (e.g. public application submission), fall back to the PRIMARY ADMIN
//    and use THAT admin's customerEmailAlertsEnabled toggle.
//    So: toggle ON → send. Toggle OFF → block.
//    No forceSend. No bypass. Real toggle check.
// ✅ sendToAdmin RESPECTS the toggle.
// ✅ Password reset / account credentials use forceSend: true (security-critical only).

import { IUser } from "../models/User";
import Admin from "../models/Admin";
import Building from "../models/Building";
import Application from "../models/Application";
import Invoice from "../models/Invoice";
import Payment from "../models/Payment";
import Plan from "../models/Plan";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { generateInvoicePDF } from "./pdfService";

const envPath = path.resolve(process.cwd(), ".env");
console.log("📁 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error("❌ Failed to load .env file:", result.error);
} else {
  console.log("✅ .env file loaded successfully");
}

console.log("\n🔍 ENVIRONMENT VARIABLES CHECK:");
console.log(
  "   ADMIN_EMAIL:",
  process.env.ADMIN_EMAIL ? "✅ EXISTS" : "❌ MISSING",
);
console.log(
  "   SUPPORT_EMAIL:",
  process.env.SUPPORT_EMAIL ? "✅ EXISTS" : "❌ MISSING",
);
console.log(
  "   EMAIL_FROM:",
  process.env.EMAIL_FROM ? "✅ EXISTS" : "❌ MISSING",
);
console.log(
  "   BREVO_API_KEY:",
  process.env.BREVO_API_KEY ? "✅ EXISTS" : "❌ MISSING",
);
console.log(
  "   BREVO_API_KEY length:",
  process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.length : 0,
);
console.log(
  "   COLLECTION_EMAIL_BREEZE:",
  process.env.COLLECTION_EMAIL_BREEZE ? "✅ EXISTS" : "❌ MISSING",
);
console.log(
  "   COLLECTION_EMAIL_SIL:",
  process.env.COLLECTION_EMAIL_SIL ? "✅ EXISTS" : "❌ MISSING",
);
console.log("   FRONTEND_URL:", process.env.FRONTEND_URL || "❌ MISSING");
console.log(
  "   SENDER_EMAIL_WORKSELPUEBLO:",
  process.env.SENDER_EMAIL_WORKSELPUEBLO || "❌ MISSING (Using fallback)",
);
console.log(
  "   SENDER_EMAIL_FBSILKRESIDENCE:",
  process.env.SENDER_EMAIL_FBSILKRESIDENCE || "❌ MISSING (Using fallback)",
);

const safeToFixed = (value: any, decimals: number = 2): string => {
  if (value === undefined || value === null || isNaN(Number(value))) {
    return "0.00";
  }
  return Number(value).toFixed(decimals);
};

const LOCATION_EMAIL_MAP: { [key: string]: string } = {
  breeze:
    process.env.COLLECTION_EMAIL_BREEZE || "collection.breeze@misterfyber.com",
  sil: process.env.COLLECTION_EMAIL_SIL || "collection.silk@misterfyber.com",
};

const DEFAULT_COLLECTION_EMAIL =
  process.env.COLLECTION_EMAIL_DEFAULT || "admin@misterfyber.com";

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

export const ADDITIONAL_SENDER_EMAILS = {
  workselpueblo: getSafeSenderEmail(
    "SENDER_EMAIL_WORKSELPUEBLO",
    "workselpueblo@fyberblizz.com",
  ),
  fbsilkresidence: getSafeSenderEmail(
    "SENDER_EMAIL_FBSILKRESIDENCE",
    "fbsilkresidence@gmail.com",
  ),
} as const;

export const ADDITIONAL_SENDER_NAMES = {
  workselpueblo: process.env.SENDER_NAME_WORKSELPUEBLO || "Workselpueblo",
  fbsilkresidence:
    process.env.SENDER_NAME_FBSILKRESIDENCE || "FB Silk Residence",
};

export type SenderType =
  | "admin"
  | "collection"
  | "workselpueblo"
  | "fbsilkresidence";

const WILCONNECT_BUILDINGS = ["el pueblo", "vitalez", "newport"];

export function isWilconnectBuildingName(buildingName?: string): boolean {
  if (!buildingName) return false;
  const normalized = buildingName.toLowerCase().trim();
  return WILCONNECT_BUILDINGS.some((b) => normalized.includes(b));
}

export function isElPuebloBuilding(buildingName?: string): boolean {
  if (!buildingName) return false;
  return buildingName.toLowerCase().trim().includes("el pueblo");
}

export function isVitalezOrNewportBuilding(buildingName?: string): boolean {
  if (!buildingName) return false;
  const normalized = buildingName.toLowerCase().trim();
  return normalized.includes("vitalez") || normalized.includes("newport");
}

interface BankAccountInfo {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export function getBankAccountForBuilding(
  buildingName?: string,
  location?: string,
  customerAddress?: string,
): BankAccountInfo {
  const hint = [buildingName, location, customerAddress]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (hint.includes("el pueblo")) {
    return {
      bankName: "BDO",
      accountName: "RANDY D MANZANARES AND ANGELA C TAPEL",
      accountNumber: "013448003711",
    };
  }

  if (hint.includes("vitalez") || hint.includes("newport")) {
    return {
      bankName: "BDO",
      accountName: "RANDY MANZANARES AND ANGELA TAPEL",
      accountNumber: "013448003703",
    };
  }

  const isWilconnect =
    hint.includes("wilconnect") ||
    WILCONNECT_BUILDINGS.some((b) => hint.includes(b));

  if (isWilconnect) {
    return {
      bankName: "BDO",
      accountName: "WILCONNECT NETWORK CORPORATION",
      accountNumber: "013448002421",
    };
  }

  return {
    bankName: "BDO",
    accountName: "FYBERBLIZZ NETWORK CORPORATION",
    accountNumber: "013448002421",
  };
}

interface BrandInfo {
  isWilconnect: boolean;
  companyName: string;
  brandName: string;
  adminEmail: string;
  supportEmail: string;
  companyAddress: string;
  companyVat: string;
  companyContact: string;
}

function getBrandForBuilding(buildingName?: string): BrandInfo {
  const normalizedBuilding = (buildingName || "").toLowerCase().trim();
  const isWilconnect = WILCONNECT_BUILDINGS.some((b) =>
    normalizedBuilding.includes(b),
  );

  if (isWilconnect) {
    console.log(`🏢 Brand: WILCONNECT (matched building: "${buildingName}")`);
    return {
      isWilconnect: true,
      companyName: "WILCONNECT NETWORK CORPORATION",
      brandName: "Wilconnect",
      adminEmail: "admin@misterfyber.com",
      supportEmail: ADDITIONAL_SENDER_EMAILS.workselpueblo,
      companyAddress:
        "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
      companyVat: "697-461-165-00000",
      companyContact: "0969-341-4876",
    };
  }

  console.log(`🏢 Brand: MISTER FYBER (building: "${buildingName || "N/A"}")`);
  return {
    isWilconnect: false,
    companyName: "FYBERBLIZZ NETWORK CORPORATION",
    brandName: "Mister Fyber",
    adminEmail: "admin@misterfyber.com",
    supportEmail: "admin@misterfyber.com",
    companyAddress:
      "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
    companyVat: "697-461-165-00000",
    companyContact: "0969-341-4876",
  };
}

async function getBrandForApplication(application: any): Promise<BrandInfo> {
  try {
    if (!application) return getBrandForBuilding();

    if (application.buildingName) {
      return getBrandForBuilding(application.buildingName);
    }

    if (application.buildingId) {
      try {
        const building = await Building.findById(application.buildingId).lean();
        if (building && building.buildingName) {
          return getBrandForBuilding(building.buildingName);
        }
      } catch (e) {
        console.error("Error finding building by ID:", e);
      }
    }

    return getBrandForBuilding();
  } catch (error) {
    console.error("Error determining brand:", error);
    return getBrandForBuilding();
  }
}

async function resolvePlanForApplication(application: any): Promise<any> {
  try {
    if (!application) {
      console.log("⚠️ resolvePlanForApplication: No application provided");
      return null;
    }

    console.log(
      `🔍 resolvePlanForApplication for app: ${application.applicationId}`,
    );
    console.log(`   application.planId type: ${typeof application.planId}`);
    console.log(
      `   application.planId value: ${application.planId ? String(application.planId) : "NULL/UNDEFINED"}`,
    );
    console.log(
      `   application.planName (fallback): ${application.planName || "N/A"}`,
    );

    let planIdToFetch: string | null = null;

    if (application.planId) {
      if (typeof application.planId === "object" && application.planId._id) {
        if (application.planId.name && application.planId.price !== undefined) {
          console.log(
            `✅ Plan already populated: ${application.planId.name} - ₱${application.planId.price}`,
          );
          return application.planId;
        }
        planIdToFetch = String(application.planId._id);
      } else if (
        typeof application.planId === "string" ||
        application.planId instanceof mongoose.Types.ObjectId
      ) {
        planIdToFetch = String(application.planId);
      }
    }

    if (planIdToFetch && mongoose.Types.ObjectId.isValid(planIdToFetch)) {
      console.log(`🔄 Fetching plan from DB: ${planIdToFetch}`);
      const plan = await Plan.findById(planIdToFetch).lean();
      if (plan) {
        console.log(`✅ Plan fetched from DB: "${plan.name}" - ₱${plan.price}`);
        return plan;
      } else {
        console.log(`⚠️ Plan not found in DB for ID: ${planIdToFetch}`);
      }
    }

    if (application.planName) {
      console.log(
        `⚠️ Using fallback planName from application: ${application.planName}`,
      );
      return {
        name: application.planName,
        price: application.planPrice || application.monthlyRate || 0,
      };
    }

    console.log(
      `❌ Could not resolve plan for application: ${application.applicationId}`,
    );
    return null;
  } catch (error) {
    console.error("❌ Error resolving plan:", error);
    return null;
  }
}

function isValidPlan(plan: any): boolean {
  if (!plan || typeof plan !== "object") return false;
  return !!(plan.name || (plan.price !== undefined && plan.price > 0));
}

export const getSenderEmailByType = (
  senderType: SenderType,
  location?: string,
  buildingName?: string,
): { email: string; name: string } => {
  if (isWilconnectBuildingName(buildingName)) {
    console.log(
      `🏢 Wilconnect building detected in getSenderEmailByType: "${buildingName}" → workselpueblo@fyberblizz.com`,
    );
    return {
      email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
      name: ADDITIONAL_SENDER_NAMES.workselpueblo,
    };
  }

  switch (senderType) {
    case "admin":
      let isWilconnect = false;
      if (location) {
        const normLoc = location.toLowerCase();
        if (
          ["el pueblo", "vitalez", "newport"].some((b) => normLoc.includes(b))
        ) {
          isWilconnect = true;
        }
      }
      return {
        email: "admin@misterfyber.com",
        name: isWilconnect ? "Wilconnect Admin" : "Mister Fyber Admin",
      };
    case "workselpueblo":
      return {
        email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
        name: ADDITIONAL_SENDER_NAMES.workselpueblo,
      };
    case "fbsilkresidence":
      return {
        email: ADDITIONAL_SENDER_EMAILS.fbsilkresidence,
        name: ADDITIONAL_SENDER_NAMES.fbsilkresidence,
      };
    case "collection":
    default:
      const collectionEmail = location
        ? getCollectionEmailByLocation(location)
        : DEFAULT_COLLECTION_EMAIL;
      let name = "Mister Fyber Collection";
      if (collectionEmail.includes("breeze")) {
        name = "Mister Fyber Breeze Collection";
      } else if (
        collectionEmail.includes("sil") ||
        collectionEmail.includes("silk")
      ) {
        name = "Mister Fyber SIL Collection";
      }
      return { email: collectionEmail, name };
  }
};

export const getAllSenderOptions = (
  location?: string,
  buildingName?: string,
): { value: SenderType; label: string; email: string }[] => {
  const options: { value: SenderType; label: string; email: string }[] = [];

  if (isWilconnectBuildingName(buildingName)) {
    options.push({
      value: "workselpueblo",
      label: `Workselpueblo (Auto - Wilconnect: ${buildingName})`,
      email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
    });
  }

  if (location) {
    const collectionEmail = getCollectionEmailByLocation(location);
    if (collectionEmail && collectionEmail !== DEFAULT_COLLECTION_EMAIL) {
      let locationName = location.charAt(0).toUpperCase() + location.slice(1);
      options.unshift({
        value: "collection",
        label: `${locationName} Collection (${collectionEmail})`,
        email: collectionEmail,
      });
    }
  }

  if (!isWilconnectBuildingName(buildingName)) {
    options.push({
      value: "workselpueblo",
      label: `Workselpueblo (${ADDITIONAL_SENDER_EMAILS.workselpueblo})`,
      email: ADDITIONAL_SENDER_EMAILS.workselpueblo,
    });
  }

  options.push({
    value: "admin",
    label: "Admin (admin@misterfyber.com)",
    email: "admin@misterfyber.com",
  });

  options.push({
    value: "fbsilkresidence",
    label: `FB Silk Residence (${ADDITIONAL_SENDER_EMAILS.fbsilkresidence})`,
    email: ADDITIONAL_SENDER_EMAILS.fbsilkresidence,
  });

  return options;
};

export const getCollectionEmailByLocation = (location: string): string => {
  if (!location) {
    console.log("⚠️ No location provided, using default collection email");
    return DEFAULT_COLLECTION_EMAIL;
  }

  const normalizedLocation = location.toLowerCase().trim();
  const collectionEmail = LOCATION_EMAIL_MAP[normalizedLocation];

  if (collectionEmail) {
    console.log(
      `📍 Location "${location}" → Collection email: ${collectionEmail}`,
    );
    return collectionEmail;
  }

  console.log(
    `⚠️ Unknown location "${location}", using default collection email`,
  );
  return DEFAULT_COLLECTION_EMAIL;
};

export const getLocationFromEntity = async (entity: any): Promise<string> => {
  try {
    if (entity && entity.location) {
      return entity.location;
    }

    if (entity && entity.buildingName) {
      const buildingName = entity.buildingName.toLowerCase().trim();
      if (buildingName.includes("breeze")) return "breeze";
      if (buildingName.includes("sil") || buildingName.includes("silk"))
        return "sil";
    }

    if (entity && entity.buildingId) {
      const building = await Building.findById(entity.buildingId);
      if (building) {
        if (building.location) return building.location;
        if (building.buildingName) {
          const buildingName = building.buildingName.toLowerCase().trim();
          if (buildingName.includes("breeze")) return "breeze";
          if (buildingName.includes("sil") || buildingName.includes("silk"))
            return "sil";
        }
      }
    }

    if (entity && entity.applicationId) {
      const application = await Application.findOne({
        applicationId: entity.applicationId,
      });
      if (application) {
        if (application.buildingName) {
          const buildingName = application.buildingName.toLowerCase().trim();
          if (buildingName.includes("breeze")) return "breeze";
          if (buildingName.includes("sil") || buildingName.includes("silk"))
            return "sil";
        }
        if (application.buildingId) {
          const building = await Building.findById(application.buildingId);
          if (building) {
            if (building.location) return building.location;
            if (building.buildingName) {
              const buildingName = building.buildingName.toLowerCase().trim();
              if (buildingName.includes("breeze")) return "breeze";
              if (buildingName.includes("sil") || buildingName.includes("silk"))
                return "sil";
            }
          }
        }
      }
    }

    return "";
  } catch (error) {
    console.error("❌ Error getting location from entity:", error);
    return "";
  }
};

export const getBuildingInstallationFee = async (
  buildingId: string,
): Promise<number> => {
  try {
    if (!buildingId) return 0;
    const building = await Building.findById(buildingId);
    if (
      building &&
      building.installationFee !== undefined &&
      building.installationFee > 0
    ) {
      return building.installationFee;
    }
    return 0;
  } catch (error) {
    console.error("Error getting building installation fee:", error);
    return 0;
  }
};

export const getBuildingName = async (application: any): Promise<string> => {
  try {
    if (!application) return "N/A";
    if (application.buildingName) return application.buildingName;
    if (application.buildingId) {
      const building = await Building.findById(application.buildingId);
      if (building) return building.buildingName;
    }
    return "N/A";
  } catch (error) {
    console.error("Error getting building name:", error);
    return "N/A";
  }
};

export const getCollectionEmailForUser = async (
  user: IUser | any,
): Promise<string> => {
  try {
    const location = await getLocationFromEntity(user);
    if (location) {
      return getCollectionEmailByLocation(location);
    }
    return DEFAULT_COLLECTION_EMAIL;
  } catch (error) {
    console.error("Error getting collection email for user:", error);
    return DEFAULT_COLLECTION_EMAIL;
  }
};

export const getCollectionEmailForApplication = async (
  application: any,
): Promise<string> => {
  try {
    const location = await getLocationFromEntity(application);
    if (location) {
      return getCollectionEmailByLocation(location);
    }
    return DEFAULT_COLLECTION_EMAIL;
  } catch (error) {
    console.error("Error getting collection email for application:", error);
    return DEFAULT_COLLECTION_EMAIL;
  }
};

function getResolvedCollectionEmail(
  buildingName: string | undefined,
  location: string | undefined,
): string {
  if (isWilconnectBuildingName(buildingName)) {
    return ADDITIONAL_SENDER_EMAILS.workselpueblo;
  }
  return getCollectionEmailByLocation(location || "");
}

class EmailService {
  private apiKey: string;
  private initialized: boolean = false;
  private adminEmail: string;
  private supportEmail: string;
  private emailFrom: string;
  private brevoApiUrl: string = "https://api.brevo.com/v3/smtp/email";

  constructor() {
    this.adminEmail = process.env.ADMIN_EMAIL || "admin@misterfyber.com";
    this.supportEmail = process.env.SUPPORT_EMAIL || "admin@misterfyber.com";
    this.emailFrom =
      process.env.EMAIL_FROM || "Mister Fyber <admin@misterfyber.com>";
    this.apiKey = process.env.BREVO_API_KEY || "";

    console.log("\n📧 EmailService Constructor Values:");
    console.log("   ADMIN_EMAIL:", this.adminEmail);
    console.log("   SUPPORT_EMAIL:", this.supportEmail);
    console.log("   EMAIL_FROM:", this.emailFrom);
    console.log("   BREVO_API_KEY:", this.apiKey ? "✅ SET" : "❌ MISSING");
    console.log("   API Key length:", this.apiKey ? this.apiKey.length : 0);
    console.log("   Brevo API URL:", this.brevoApiUrl);

    if (this.apiKey && this.apiKey.length > 10) {
      this.initialized = true;
      console.log("✅ Email service initialized successfully!");
    } else {
      console.warn(
        "⚠️ Email service not initialized - BREVO_API_KEY is missing or invalid",
      );
      if (process.env.NODE_ENV === "development") {
        console.log(
          "📧 [DEV MODE] Email service will log emails instead of sending",
        );
        this.initialized = true;
      }
    }
  }

  // ============================================================
  // ⭐ FIXED: areCustomerEmailsEnabled
  // ------------------------------------------------------------
  // Behavior:
  //   1. If adminId is provided → check THAT admin's toggle.
  //   2. If adminId is NOT provided (e.g. public submission) →
  //      fall back to the PRIMARY ADMIN (oldest super_admin / admin).
  //      Use THAT admin's toggle.
  //   3. If no admin exists at all → BLOCK (safe default).
  //   4. Any error → BLOCK.
  //
  // ⚠️ NO forceSend bypass. This is a real toggle check.
  //    Toggle ON  → email sends.
  //    Toggle OFF → email blocks.
  // ============================================================
  private async areCustomerEmailsEnabled(adminId?: string): Promise<boolean> {
    let admin = null;

    try {
      if (adminId) {
        // Rule 1: check the specific admin
        admin = await Admin.findById(adminId);
        if (!admin) {
          console.log("📧 ========================================");
          console.log("📧 CUSTOMER EMAIL TOGGLE CHECK");
          console.log(`📧 ⛔ Admin with ID ${adminId} NOT FOUND → BLOCKING.`);
          console.log("📧 ========================================");
          return false;
        }
      } else {
        // Rule 2: fall back to the primary admin
        // Prefer oldest super_admin; then oldest admin; then any admin.
        admin = await Admin.findOne({ role: "super_admin" })
          .sort({ createdAt: 1 })
          .select("email customerEmailAlertsEnabled role");

        if (!admin) {
          admin = await Admin.findOne({ role: "admin" })
            .sort({ createdAt: 1 })
            .select("email customerEmailAlertsEnabled role");
        }

        if (!admin) {
          admin = await Admin.findOne({})
            .sort({ createdAt: 1 })
            .select("email customerEmailAlertsEnabled role");
        }

        if (!admin) {
          console.log("📧 ========================================");
          console.log("📧 CUSTOMER EMAIL TOGGLE CHECK");
          console.log("📧 ⛔ NO ADMIN FOUND IN DATABASE → BLOCKING.");
          console.log("📧 ========================================");
          return false;
        }

        console.log("📧 ========================================");
        console.log("📧 CUSTOMER EMAIL TOGGLE CHECK");
        console.log("📧 (No adminId provided — using primary admin's toggle)");
        console.log(`📧 Primary admin: ${admin.email} (${admin.role})`);
        console.log("📧 ========================================");
      }

      const isEnabled = admin.customerEmailAlertsEnabled === true;

      console.log("📧 ========================================");
      console.log("📧 CUSTOMER EMAIL TOGGLE CHECK (RESULT)");
      console.log(`📧 Admin ID: ${admin._id}`);
      console.log(`📧 Admin: ${admin.email} (${admin.role})`);
      console.log(
        `📧 customerEmailAlertsEnabled = ${admin.customerEmailAlertsEnabled}`,
      );
      console.log(
        `📧 RESULT: ${isEnabled ? "EMAILS ENABLED ✅ - will send" : "EMAILS DISABLED ❌ - will BLOCK"}`,
      );
      console.log("📧 ========================================");

      return isEnabled;
    } catch (error) {
      console.error(
        "📧 ⛔ ERROR checking customer email toggle → BLOCKING:",
        error,
      );
      return false;
    }
  }

  generatePaymentConfirmationHTML(
    invoice: any,
    payment: any,
    amount: number,
    paidAt: string,
    location?: string,
    collectionEmail?: string,
    isInstallation: boolean = false,
    buildingName?: string,
    buildingInstallationFee?: number,
  ): string {
    const brand = getBrandForBuilding(buildingName);
    const resolvedCollectionEmail = getResolvedCollectionEmail(
      buildingName,
      location,
    );

    const locationBadge = location
      ? `<div style="display: inline-block; background: ${location.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-top: 10px;">📍 ${location.toUpperCase()}</div>`
      : "";

    const buildingInfo = buildingName
      ? `<div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-top: 5px;">🏢 ${buildingName}</div>`
      : "";

    const installationFeeInfo =
      isInstallation && buildingInstallationFee
        ? `
      <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ff9800;">
        <p style="margin: 0; color: #e65100;">
          <strong>🔧 Installation Fee Details:</strong><br>
          Building: ${buildingName || "N/A"}<br>
          Installation Fee: ₱${buildingInstallationFee.toFixed(2)}<br>
          This is a one-time fee for installation at your building.
        </p>
      </div>
      `
        : "";

    const itemsHtml =
      invoice.items && invoice.items.length > 0
        ? `
    <div style="margin: 20px 0;">
      <h4>Invoice Items:</h4>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background-color: #f8f9fa;">
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Description</th>
            <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">Qty</th>
            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.items
            .map(
              (item: any) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${item.description}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.quantity || 1}</td>
            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">₱${(item.amount || 0).toFixed(2)}</td>
          </tr>
          `,
            )
            .join("")}
          <tr style="font-weight: bold; background-color: #f8f9fa;">
            <td colspan="2" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total:</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd; color: #28a745;">₱${amount.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    `
        : "";

    const installationNote = isInstallation
      ? `
    <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <p style="margin: 0; color: #856404;">
        <strong>🔧 Installation Fee Paid:</strong> Your installation fee of ₱${amount.toFixed(2)} for ${buildingName || "your building"} has been paid. Our technical team will contact you within 24-48 hours to schedule your installation.
      </p>
    </div>
    `
      : `
    <div style="background: #d1ecf1; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <p style="margin: 0; color: #0c5460;">
        <strong>📌 Monthly Subscription:</strong> Your monthly subscription payment has been confirmed. Your service will continue without interruption.
      </p>
    </div>
    `;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Payment Confirmation - Invoice ${invoice.invoiceNumber}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
        .header { text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; }
        .header h1 { color: #28a745; margin: 0; }
        .content { padding: 20px 0; }
        .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
        .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
        .status-badge { display: inline-block; background: #28a745; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; }
        .attachments-note { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #1a56db; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Payment Confirmed!</h1>
            <p>${brand.brandName}</p>
            ${locationBadge}
            ${buildingInfo}
        </div>
        <div class="content">
            <p>Dear <strong>${invoice.customerName || "Customer"}</strong>,</p>
            <p>We are pleased to confirm that your payment has been received and processed successfully.</p>
            
            <div class="details">
                <h3 style="margin-top: 0;">📋 Payment Details</h3>
                <p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
                <p><strong>Amount Paid:</strong> <span style="color: #28a745; font-size: 18px; font-weight: bold;">₱${amount.toFixed(2)}</span></p>
                <p><strong>Payment Date:</strong> ${paidAt}</p>
                <p><strong>Reference Number:</strong> ${payment?.referenceNumber || "N/A"}</p>
                <p><strong>Invoice Type:</strong> <span class="status-badge">${invoice.invoiceType || "Monthly"}</span></p>
                ${isInstallation ? `<p><strong>Note:</strong> This is an installation fee payment for ${buildingName || "your building"}.</p>` : ""}
                ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                ${resolvedCollectionEmail ? `<p><strong>Collection Email:</strong> <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></p>` : ""}
                ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                ${buildingInstallationFee ? `<p><strong>Installation Fee:</strong> ₱${buildingInstallationFee.toFixed(2)}</p>` : ""}
            </div>

            ${installationFeeInfo}
            ${itemsHtml}

            <div class="attachments-note">
                <p style="margin: 0; color: #1a56db;">
                    <strong>📎 Invoice PDF Attached:</strong> A copy of your paid invoice (${invoice.invoiceNumber}) is attached to this email for your records.
                </p>
            </div>

            ${installationNote}

            <p>Thank you for choosing ${brand.brandName} as your trusted internet provider.</p>
            <p><strong>Best regards,</strong><br>${brand.brandName} Team</p>
        </div>
        <div class="footer">
            <p>${brand.brandName} - Your trusted internet provider</p>
            <p><small>Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></small></p>
            ${resolvedCollectionEmail ? `<p><small>Collection Email: <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></small></p>` : ""}
            <p><small>This is a computer-generated receipt. No signature required.</small></p>
        </div>
    </div>
</body>
</html>
    `;
  }

  generateInvoiceHTML(
    user: any,
    billing: any,
    location: string,
    buildingName?: string,
    buildingInstallationFee?: number,
  ): string {
    const brand = getBrandForBuilding(buildingName);
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.total || billing.amount || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

    const resolvedCollectionEmail = getResolvedCollectionEmail(
      buildingName,
      location,
    );

    const bankAccount = getBankAccountForBuilding(
      buildingName,
      location,
      undefined,
    );

    const locationBadge = location
      ? `
      <div style="display: inline-block; background: ${location.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-top: 10px;">
        📍 ${location.toUpperCase()}
      </div>
    `
      : "";

    const buildingInfo = buildingName
      ? `
      <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-top: 5px;">
        🏢 ${buildingName}
      </div>
    `
      : "";

    const installationFeeInfo =
      billing.isInstallationBill && buildingInstallationFee
        ? `
      <div style="margin-top: 15px; padding: 10px; background-color: #fff3e0; border-radius: 5px; border-left: 4px solid #ff9800;">
        <p style="margin: 0; font-size: 12px; color: #e65100;">
          <strong>🔧 Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()} (One-time charge for ${buildingName || "your building"})
          ${billing.installationFeePaid ? '✅ <span style="color: #28a745;">(Paid)</span>' : '⚠️ <span style="">(Pending)</span>'}
        </p>
      </div>
      `
        : "";

    let additionalInfo = "";
    if (billing.isProRated && billing.items && billing.items[0]) {
      const item = billing.items[0];
      const monthlyRateFromItem = item.rate * 30;
      const annualRate = monthlyRateFromItem * 12;
      const dailyRate = annualRate / 365;
      additionalInfo = `
        <div style="margin-top: 15px; padding: 10px; background-color: #e8f4f8; border-radius: 5px;">
          <p style="margin: 0; font-size: 12px; color: #0056b3;">
            <strong>📌 Pro-rated Calculation:</strong> Daily rate = (₱${safeToFixed(monthlyRateFromItem)} × 12) ÷ 365 = ₱${safeToFixed(dailyRate, 4)}/day<br>
            Billable days: ${item.quantity} days × ₱${safeToFixed(dailyRate, 4)} = ₱${safeToFixed(amount)}
          </p>
        </div>
      `;
    }

    let senderName = brand.brandName;
    let senderEmailAddress = brand.adminEmail;

    if (isWilconnectBuildingName(buildingName)) {
      senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
      senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
      console.log(
        `🏢 Wilconnect building in generateInvoiceHTML: "${buildingName}" → workselpueblo@fyberblizz.com`,
      );
    } else if (location) {
      const collectionEmailForLocation = getCollectionEmailByLocation(location);
      if (
        collectionEmailForLocation &&
        collectionEmailForLocation !== DEFAULT_COLLECTION_EMAIL
      ) {
        senderEmailAddress = collectionEmailForLocation;
        if (collectionEmailForLocation.includes("breeze")) {
          senderName = `${brand.brandName} Breeze Collection`;
        } else if (
          collectionEmailForLocation.includes("sil") ||
          collectionEmailForLocation.includes("silk")
        ) {
          senderName = `${brand.brandName} SIL Collection`;
        } else {
          senderName = `${brand.brandName} Collection`;
        }
      }
    }

    const isBillingPaid =
      billing.status === "paid" || (billing as any).paidAt != null;
    const isBillingFree =
      billing.status === "free" ||
      (billing as any).isFree === true ||
      (billing as any).paymentMethod === "free";

    let bankAccountSection = "";
    if (!isBillingPaid && !isBillingFree) {
      bankAccountSection = `
        <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #1a56db;">
          <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
          <p style="margin: 5px 0;"><strong>BANK:</strong> ${bankAccount.bankName}</p>
          <p style="margin: 5px 0;"><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${bankAccount.accountNumber}</span></p>
          <p style="margin: 5px 0;"><strong>ACCOUNT NAME:</strong> ${bankAccount.accountName}</p>
          <p style="font-size: 12px; color: #555; margin-top: 10px;">
            Kindly send your proof of payment via Viber ${brand.companyContact} or at <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a> after completing the transaction.
          </p>
        </div>
      `;
    }

    let itemsTable = "";
    if (billing.items && billing.items.length > 0) {
      itemsTable = `
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Description</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">Qty</th>
              <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${billing.items
              .map(
                (item: any) => `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${item.description}</td>
                <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.quantity || 1}</td>
                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">₱${(item.amount || 0).toFixed(2)}</td>
              </tr>
            `,
              )
              .join("")}
            <tr style="font-weight: bold; background: #f8f9fa;">
              <td colspan="2" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total:</td>
              <td style="padding: 10px; text-align: right; border: 1px solid #ddd; ">₱${amount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Invoice Ready</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
              <h2 style="color: #333;">🧾 Invoice Ready</h2>
              <p>Hello ${user.firstName || user.email},</p>
              <p>Your ${brand.brandName} invoice is now ready for payment.</p>
              ${locationBadge}
              ${buildingInfo}
              <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
                <strong>📧 Sent from:</strong> ${senderName} (${senderEmailAddress})
              </div>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <h3 style="margin-top: 0;">Invoice Details</h3>
                  <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                  <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                  <p><strong>Due Date:</strong> ${dueDate}</p>
                  ${billing.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
                  ${billing.isInstallationBill ? `<p><strong>Bill Type:</strong> Installation Fee</p>` : ""}
                  ${!billing.isProRated && !billing.isInstallationBill ? `<p><strong>Bill Type:</strong> Monthly Subscription</p>` : ""}
                  ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                  ${buildingInstallationFee ? `<p><strong>Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()}</p>` : ""}
                  ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                  <p><strong>Collection Email:</strong> ${resolvedCollectionEmail}</p>
              </div>
              ${itemsTable}
              ${installationFeeInfo}
              ${additionalInfo}
              ${bankAccountSection}
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View & Pay Invoice</a>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">${brand.brandName} - Your trusted internet provider</p>
              <p style="color: #666; font-size: 12px;">Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></p>
              <p style="color: #666; font-size: 12px;">This is a computer-generated invoice. No signature required.</p>
              <p style="color: #666; font-size: 12px;">Collection email: <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></p>
              <p style="color: #666; font-size: 12px;">Sent from: ${senderName} (${senderEmailAddress})</p>
          </div>
      </body>
      </html>
    `;
  }

  generatePaymentReminderHTML(
    user: any,
    billing: any,
    amount: number,
    dueDate: string,
    location?: string,
    collectionEmail?: string,
    isInstallationBill: boolean = false,
    isProRated: boolean = false,
    buildingName?: string,
    buildingInstallationFee?: number,
  ): string {
    const brand = getBrandForBuilding(buildingName);
    const resolvedCollectionEmail = getResolvedCollectionEmail(
      buildingName,
      location,
    );
    const bankAccount = getBankAccountForBuilding(
      buildingName,
      location,
      undefined,
    );

    const locationBadge = location
      ? `
      <div style="display: inline-block; background: ${location.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
        📍 ${location.toUpperCase()}
      </div>
    `
      : "";

    const buildingInfo = buildingName
      ? `
      <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-bottom: 10px;">
        🏢 ${buildingName}
      </div>
    `
      : "";

    let reminderMessage = "";
    if (isInstallationBill) {
      reminderMessage = `<p><strong>Note:</strong> This is your installation fee for ${buildingName || "your building"}. Once paid, our team will schedule your installation.</p>`;
    } else if (isProRated) {
      reminderMessage = `<p><strong>Note:</strong> This is your pro-rated first bill. Once paid, your service will be fully activated.</p>`;
    }

    const installationFeeInfo =
      isInstallationBill && buildingInstallationFee
        ? `
      <div style="background: #fff3e0; padding: 10px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #ff9800;">
        <p style="margin: 0; font-size: 12px; color: #e65100;">
          <strong>🔧 Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()} (One-time charge)
        </p>
      </div>
      `
        : "";

    let senderNote = "";
    if (isWilconnectBuildingName(buildingName)) {
      senderNote = `
        <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> ${ADDITIONAL_SENDER_NAMES.workselpueblo} (${ADDITIONAL_SENDER_EMAILS.workselpueblo})
        </div>
      `;
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Payment Reminder</title>
        <style>
            .sender-info { background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center; }
        </style>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #f39c12;">⚠️ Payment Reminder</h2>
            <p>Hello ${user.firstName || user.email},</p>
            <p>This is a friendly reminder that your ${brand.brandName} payment is due soon.</p>
            ${locationBadge}
            ${buildingInfo}
            ${senderNote}
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                <p><strong>Due Date:</strong> ${dueDate}</p>
                ${reminderMessage}
                ${installationFeeInfo}
                ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                ${resolvedCollectionEmail ? `<p><strong>Collection Email:</strong> ${resolvedCollectionEmail}</p>` : ""}
                ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
            </div>

            <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #1a56db;">
                <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
                <p style="margin: 5px 0;"><strong>BANK:</strong> ${bankAccount.bankName}</p>
                <p style="margin: 5px 0;"><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${bankAccount.accountNumber}</span></p>
                <p style="margin: 5px 0;"><strong>ACCOUNT NAME:</strong> ${bankAccount.accountName}</p>
            </div>

            <p>Please pay before the due date to avoid service interruption.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">This is an automated reminder from ${brand.brandName}.</p>
            ${resolvedCollectionEmail ? `<p style="color: #666; font-size: 12px;">Collection Email: <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></p>` : ""}
        </div>
    </body>
    </html>
    `;
  }

  generateDueDateReminderHTML(
    user: any,
    billing: any,
    amount: number,
    dueDate: string,
    location?: string,
    collectionEmail?: string,
    isInstallationBill: boolean = false,
    isProRated: boolean = false,
    buildingName?: string,
    buildingInstallationFee?: number,
  ): string {
    const brand = getBrandForBuilding(buildingName);
    const resolvedCollectionEmail = getResolvedCollectionEmail(
      buildingName,
      location,
    );
    const bankAccount = getBankAccountForBuilding(
      buildingName,
      location,
      undefined,
    );

    const locationBadge = location
      ? `
      <div style="display: inline-block; background: ${location.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
        📍 ${location.toUpperCase()}
      </div>
    `
      : "";

    const buildingInfo = buildingName
      ? `
      <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-bottom: 10px;">
        🏢 ${buildingName}
      </div>
    `
      : "";

    let reminderMessage = "";
    if (isInstallationBill) {
      reminderMessage = `<p><strong>⚠️ IMPORTANT:</strong> This is your installation fee for ${buildingName || "your building"}. Payment is due TODAY. Once paid, our team will schedule your installation.</p>`;
    } else if (isProRated) {
      reminderMessage = `<p><strong>⚠️ IMPORTANT:</strong> This is your pro-rated first bill. Payment is due TODAY. Once paid, your service will be fully activated.</p>`;
    } else {
      reminderMessage = `<p><strong>⚠️ IMPORTANT:</strong> Your monthly subscription payment is due TODAY. Please pay immediately to avoid service interruption.</p>`;
    }

    const installationFeeInfo =
      isInstallationBill && buildingInstallationFee
        ? `
      <div style="background: #fff3e0; padding: 10px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #ff9800;">
        <p style="margin: 0; font-size: 12px; color: #e65100;">
          <strong>🔧 Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()} (One-time charge for ${buildingName || "your building"})
        </p>
      </div>
      `
        : "";

    let senderNote = "";
    if (isWilconnectBuildingName(buildingName)) {
      senderNote = `
        <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> ${ADDITIONAL_SENDER_NAMES.workselpueblo} (${ADDITIONAL_SENDER_EMAILS.workselpueblo})
        </div>
      `;
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>⚠️ PAYMENT DUE TODAY - ${brand.brandName}</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
            .header { text-align: center; border-bottom: 2px solid padding-bottom: 20px; }
            .header h1 {  margin: 0; }
            .content { padding: 20px 0; }
            .bill-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; background-color: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚠️ PAYMENT DUE TODAY</h1>
            </div>
            <div class="content">
                <p>Hello ${user.firstName || user.email},</p>
                <p><strong>Your ${brand.brandName} payment is due TODAY.</strong> Please settle your bill immediately to avoid service interruption.</p>
                ${locationBadge}
                ${buildingInfo}
                ${senderNote}
                <div class="bill-details">
                    <h3 style="margin-top: 0;">📋 Invoice Details</h3>
                    <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                    <p><strong>Amount Due:</strong> <span style="color: #dc3545; font-size: 18px;">₱${safeToFixed(amount)}</span></p>
                    <p><strong>Due Date:</strong> <span style="color: #dc3545; font-weight: bold;">${dueDate} (TODAY)</span></p>
                    ${isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
                    ${isInstallationBill ? `<p><strong>Bill Type:</strong> Installation Fee</p>` : ""}
                    ${installationFeeInfo}
                    ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                    ${resolvedCollectionEmail ? `<p><strong>Collection Email:</strong> ${resolvedCollectionEmail}</p>` : ""}
                    ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                </div>

                <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #1a56db;">
                    <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
                    <p style="margin: 5px 0;"><strong>BANK:</strong> ${bankAccount.bankName}</p>
                    <p style="margin: 5px 0;"><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${bankAccount.accountNumber}</span></p>
                    <p style="margin: 5px 0;"><strong>ACCOUNT NAME:</strong> ${bankAccount.accountName}</p>
                </div>

                ${reminderMessage}
                <div class="warning">
                    <strong>📌 After Today:</strong> If payment is not received, your account will enter a grace period. After the grace period, your service will be suspended.
                </div>
              
                <p><strong>Payment Methods Accepted:</strong> GCash, Maya, Bank Transfer, Over-the-Counter</p>
                <p>If you have already made the payment, please disregard this notice.</p>
            </div>
            <div class="footer">
                <p>${brand.brandName} - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></small></p>
                ${resolvedCollectionEmail ? `<p><small>Collection Email: <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></small></p>` : ""}
                <p><small>Late payments may incur service interruption after grace period.</small></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  generateBillWithoutAccountHTML(
    application: any,
    bill: any,
    plan: any,
    amount: number,
    dueDate: string,
    location?: string,
    collectionEmail?: string,
    buildingName?: string,
    buildingInstallationFee?: number,
  ): string {
    const brand = getBrandForBuilding(
      buildingName || application?.buildingName,
    );
    const resolvedBuilding = buildingName || application?.buildingName;
    const resolvedCollectionEmail = getResolvedCollectionEmail(
      resolvedBuilding,
      location,
    );
    const bankAccount = getBankAccountForBuilding(
      resolvedBuilding,
      location,
      application?.customerAddress,
    );
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;

    const locationBadge = location
      ? `
      <div style="display: inline-block; background: ${location.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
        📍 ${location.toUpperCase()}
      </div>
    `
      : "";

    const buildingInfo = resolvedBuilding
      ? `
      <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-bottom: 10px;">
        🏢 ${resolvedBuilding}
      </div>
    `
      : "";

    const installationFeeInfo =
      bill.isInstallationBill && buildingInstallationFee
        ? `
      <div style="margin-top: 15px; padding: 10px; background-color: #fff3e0; border-radius: 5px; border-left: 4px solid #ff9800;">
        <p style="margin: 0; font-size: 12px; color: #e65100;">
          <strong>🔧 Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()} (One-time charge for ${resolvedBuilding || "your building"})
        </p>
      </div>
      `
        : "";

    let senderNote = "";
    if (isWilconnectBuildingName(resolvedBuilding)) {
      senderNote = `
        <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> ${ADDITIONAL_SENDER_NAMES.workselpueblo} (${ADDITIONAL_SENDER_EMAILS.workselpueblo})
        </div>
      `;
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Your ${brand.brandName} Bill is Ready</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
            .header { text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 20px; }
            .header h1 { color: #007bff; margin: 0; }
            .content { padding: 20px 0; }
            .bill-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
            .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🧾 Your Bill is Ready</h1>
            </div>
            <div class="content">
                <p>Hello ${application.firstName} ${application.lastName},</p>
                <p>Your ${brand.brandName} bill is now ready. Since you haven't created your account yet, please register first using your Application ID.</p>
                ${locationBadge}
                ${buildingInfo}
                ${senderNote}
                <div class="bill-details">
                    <h3 style="margin-top: 0;">📋 Bill Details</h3>
                    <p><strong>Invoice Number:</strong> ${bill.invoiceNumber}</p>
                    <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Due Date:</strong> ${dueDate}</p>
                    <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
                    ${bill.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
                    ${bill.isInstallationBill ? `<p><strong>Bill Type:</strong> Installation Fee</p>` : ""}
                    ${!bill.isProRated && !bill.isInstallationBill ? `<p><strong>Bill Type:</strong> Monthly Subscription</p>` : ""}
                    ${resolvedBuilding ? `<p><strong>Building:</strong> ${resolvedBuilding}</p>` : ""}
                    ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                    ${resolvedCollectionEmail ? `<p><strong>Collection Email:</strong> ${resolvedCollectionEmail}</p>` : ""}
                </div>
                ${installationFeeInfo}

                <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #1a56db;">
                    <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
                    <p style="margin: 5px 0;"><strong>BANK:</strong> ${bankAccount.bankName}</p>
                    <p style="margin: 5px 0;"><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${bankAccount.accountNumber}</span></p>
                    <p style="margin: 5px 0;"><strong>ACCOUNT NAME:</strong> ${bankAccount.accountName}</p>
                </div>

                <div class="warning">
                    <strong>📌 Important:</strong> You need to create your account before you can pay your bill.
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${registerUrl}" class="button">🎯 Create Your Account First</a>
                </div>
                <p><strong>Your Application ID:</strong> ${application.applicationId}</p>
                <p>Once you create your account, you will be able to view and pay this bill.</p>
            </div>
            <div class="footer">
                <p>${brand.brandName} - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></small></p>
                ${resolvedCollectionEmail ? `<p><small>Collection Email: <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></small></p>` : ""}
            </div>
        </div>
    </body>
    </html>
    `;
  }

  generateTestLocationEmailHTML(
    location: string,
    collectionEmail: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Email - ${location}</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a56db;">🧪 Test Email</h1>
        <p>This is a test email sent to the collection team for location: <strong>${location}</strong></p>
        <div style="background: #f3f4f6; padding: 15px; border-radius: 6px; margin: 15px 0;">
          <p><strong>Location:</strong> ${location}</p>
          <p><strong>Collection Email:</strong> ${collectionEmail}</p>
          <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Status:</strong> ✅ Test successful</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This is an automated test email from the billing system.</p>
      </body>
      </html>
    `;
  }

  generateServiceStatusHTML(
    firstName: string,
    lastName: string,
    status: string,
    message: string,
  ): string {
    const statusColors: Record<string, string> = {
      paused: "#dc3545",
      resumed: "#28a745",
      active: "#28a745",
      suspended: "#dc3545",
    };

    const color = statusColors[status] || "#007bff";

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: ${color}; text-align: center;">Service ${status.charAt(0).toUpperCase() + status.slice(1)}</h2>
        <p>Dear ${firstName} ${lastName},</p>
        <p>${message}</p>
        <p>If you have any questions, please contact our support team.</p>
        <hr>
        <p style="color: #666; font-size: 12px;">Your trusted internet provider</p>
      </div>
    `;
  }

  isConfigured(): boolean {
    const configured =
      this.initialized && !!this.apiKey && this.apiKey.length > 10;
    console.log(
      `📧 isConfigured() called: ${configured} (initialized: ${this.initialized}, apiKey: ${!!this.apiKey}, length: ${this.apiKey?.length || 0})`,
    );
    return configured;
  }

  private formatDateForDisplay(date: any): string {
    if (!date) return "N/A";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "N/A";
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  }

  private getSenderEmail(): string {
    let senderEmail = "admin@misterfyber.com";
    if (this.emailFrom) {
      const match = this.emailFrom.match(/<(.+)>/);
      if (match) {
        senderEmail = match[1];
      } else if (this.emailFrom.includes("@")) {
        senderEmail = this.emailFrom;
      }
    }
    return senderEmail;
  }

  getSenderOptions(location?: string): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];

    if (location) {
      const collectionEmail = getCollectionEmailByLocation(location);
      if (collectionEmail && collectionEmail !== DEFAULT_COLLECTION_EMAIL) {
        let locationName = location.charAt(0).toUpperCase() + location.slice(1);
        options.push({
          value: "collection",
          label: `${locationName} Collection (${collectionEmail})`,
        });
      }
    }

    options.push({
      value: "admin",
      label: "Admin (admin@misterfyber.com)",
    });
    options.push({
      value: "workselpueblo",
      label: `Workselpueblo (${ADDITIONAL_SENDER_EMAILS.workselpueblo})`,
    });
    options.push({
      value: "fbsilkresidence",
      label: `FB Silk Residence (${ADDITIONAL_SENDER_EMAILS.fbsilkresidence})`,
    });

    return options;
  }

  async sendEmail(
    to: string | string[],
    subject: string,
    htmlContent: string,
    isCustomerEmail: boolean = true,
    location?: string,
    options?: {
      cc?: string | string[];
      bcc?: string | string[];
      replyTo?: string;
      attachments?: any[];
      useAdminSender?: boolean;
      senderType?: SenderType;
      forceSend?: boolean;
      isWilconnect?: boolean;
      buildingName?: string;
      adminId?: string;
    },
  ): Promise<boolean> {
    try {
      console.log(`📧 sendEmail called: to=${to}, subject=${subject}`);
      console.log(
        `   isCustomerEmail: ${isCustomerEmail}, location: ${location || "none"}`,
      );
      console.log(
        `   senderType: ${options?.senderType || (options?.useAdminSender ? "admin" : "collection")}`,
      );
      console.log(`   forceSend: ${options?.forceSend === true}`);
      console.log(
        `   isWilconnect (options): ${options?.isWilconnect === true}`,
      );
      console.log(
        `   buildingName (options): ${options?.buildingName || "N/A"}`,
      );
      console.log(`   adminId (options): ${options?.adminId || "N/A"}`);

      // ⚠️ forceSend is ONLY used by password reset / account credentials (security-critical).
      //    For ALL other email types, areCustomerEmailsEnabled() decides based on
      //    the toggle. No forceSend bypass for customer or admin notification emails.
      if (!options?.forceSend) {
        const customerEmailsEnabled = await this.areCustomerEmailsEnabled(
          options?.adminId,
        );
        if (!customerEmailsEnabled) {
          console.log(`⚠️ ========================================`);
          console.log(
            `⚠️ EMAIL NOTIFICATIONS ARE DISABLED (OFF). SKIPPING EMAIL!`,
          );
          console.log(`⚠️ Admin ID: ${options?.adminId || "not provided"}`);
          console.log(`⚠️ To: ${to}`);
          console.log(`⚠️ Subject: ${subject}`);
          console.log(`⚠️ isCustomerEmail: ${isCustomerEmail}`);
          console.log(`⚠️ This email was NOT sent because the toggle is OFF.`);
          console.log(`⚠️ ========================================`);
          return true;
        }
        console.log(
          `✅ Email notifications are ENABLED. Sending email to: ${to}`,
        );
      } else {
        console.log(`📧 [SECURITY-CRITICAL] Sending email to: ${to}`);
      }

      if (process.env.NODE_ENV === "development" && !this.apiKey) {
        console.log(`📧 [DEV MODE] Would send email to: ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   Content preview: ${htmlContent.substring(0, 200)}...`);
        console.log(
          `   Sender Type: ${options?.senderType || (options?.useAdminSender ? "admin" : "collection")}`,
        );
        return true;
      }

      if (!this.isConfigured()) {
        console.error(
          `❌ Email service not configured - skipping email to ${to}`,
        );
        console.error(`   Please check BREVO_API_KEY in your .env file`);
        return false;
      }

      let senderEmail = "admin@misterfyber.com";
      if (this.emailFrom) {
        const match = this.emailFrom.match(/<(.+)>/);
        if (match) {
          senderEmail = match[1];
        } else if (this.emailFrom.includes("@")) {
          senderEmail = this.emailFrom;
        }
      }

      const toArray = Array.isArray(to) ? to : [to];
      const validToArray = toArray.filter(
        (email) => email && email.trim().length > 0,
      );
      if (validToArray.length === 0) {
        console.error("❌ No valid recipient emails provided");
        return false;
      }

      const buildingName =
        options?.buildingName || (options?.isWilconnect ? location : undefined);
      const isWilconnectLocation =
        options?.isWilconnect === true ||
        isWilconnectBuildingName(buildingName);

      let collectionEmail = DEFAULT_COLLECTION_EMAIL;
      if (isWilconnectLocation) {
        collectionEmail = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        console.log(
          `🏢 [WILCONNECT] Collection email overridden to: ${collectionEmail}`,
        );
      } else if (location) {
        collectionEmail = getCollectionEmailByLocation(location);
        console.log(
          `📍 Collection email for location "${location}": ${collectionEmail}`,
        );
      } else {
        console.log(
          `⚠️ No location provided, using default collection email: ${collectionEmail}`,
        );
      }

      if (isWilconnectLocation) {
        console.log(
          `🏢 WILCONNECT DETECTED: building="${buildingName || "N/A"}" → using workselpueblo@fyberblizz.com`,
        );
      }

      console.log(`🏢 isWilconnectLocation (final): ${isWilconnectLocation}`);

      let senderName = isWilconnectLocation ? "Wilconnect" : "Mister Fyber";
      let senderEmailAddress = senderEmail;

      const effectiveSenderType: SenderType =
        options?.senderType ||
        (options?.useAdminSender ? "admin" : "collection");

      if (isWilconnectLocation) {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
        console.log(
          `🏢 [WILCONNECT OVERRIDE] Using workselpueblo as sender: ${senderName} <${senderEmailAddress}>`,
        );
      } else if (effectiveSenderType === "admin") {
        senderEmailAddress = "admin@misterfyber.com";
        senderName = "Mister Fyber Admin";
        console.log(
          `📧 Using admin email as sender: ${senderName} <${senderEmailAddress}>`,
        );
      } else if (effectiveSenderType === "workselpueblo") {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
        console.log(
          `📧 Using workselpueblo email as sender: ${senderEmailAddress}`,
        );
      } else if (effectiveSenderType === "fbsilkresidence") {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.fbsilkresidence;
        senderName = ADDITIONAL_SENDER_NAMES.fbsilkresidence;
        console.log(
          `📧 Using fbsilkresidence email as sender: ${senderEmailAddress}`,
        );
      } else if (isCustomerEmail && location) {
        const collectionEmailForLocation =
          getCollectionEmailByLocation(location);
        if (collectionEmailForLocation) {
          senderEmailAddress = collectionEmailForLocation;
          if (collectionEmailForLocation.includes("breeze")) {
            senderName = "Mister Fyber Breeze Collection";
          } else if (
            collectionEmailForLocation.includes("sil") ||
            collectionEmailForLocation.includes("silk")
          ) {
            senderName = "Mister Fyber SIL Collection";
          } else {
            senderName = "Mister Fyber Collection";
          }
          console.log(
            `📧 Using collection email as sender: ${senderEmailAddress} (${senderName})`,
          );
        }
      } else {
        console.log(`📧 Using default sender: ${senderEmailAddress}`);
      }

      let bccEmails: string[] = [];
      if (options?.bcc) {
        bccEmails = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
      }

      if (isCustomerEmail && collectionEmail) {
        const collectionEmailToAdd = collectionEmail;
        if (!bccEmails.includes(collectionEmailToAdd)) {
          bccEmails.push(collectionEmailToAdd);
          console.log(
            `📧 Added collection email to BCC: ${collectionEmailToAdd}`,
          );
        }
      }

      console.log(
        `📧 Sending email via Brevo API to ${validToArray.join(", ")}...`,
      );
      console.log(`   Subject: ${subject}`);
      console.log(`   Sender: ${senderName} <${senderEmailAddress}>`);
      console.log(`   Location: ${location || "Not specified"}`);
      console.log(`   Building: ${buildingName || "N/A"}`);
      console.log(`   Collection Email: ${collectionEmail}`);
      console.log(`   BCC: ${bccEmails.join(", ")}`);

      const requestBody: any = {
        sender: {
          name: senderName,
          email: senderEmailAddress,
        },
        to: validToArray.map((email) => ({ email: email.trim() })),
        subject: subject,
        htmlContent: htmlContent,
      };

      if (options?.cc && options.cc.length > 0) {
        const ccArray = Array.isArray(options.cc) ? options.cc : [options.cc];
        const validCc = ccArray.filter(
          (email) => email && email.trim().length > 0,
        );
        if (validCc.length > 0) {
          requestBody.cc = validCc.map((email) => ({ email: email.trim() }));
        }
      }

      if (bccEmails.length > 0) {
        const validBcc = bccEmails.filter(
          (email) => email && email.trim().length > 0,
        );
        if (validBcc.length > 0) {
          requestBody.bcc = validBcc.map((email) => ({ email: email.trim() }));
        }
      }

      if (options?.replyTo) {
        requestBody.replyTo = { email: options.replyTo.trim() };
      } else if (isCustomerEmail && collectionEmail) {
        requestBody.replyTo = { email: collectionEmail };
      }

      if (options?.attachments && options.attachments.length > 0) {
        console.log(
          `📎 Processing ${options.attachments.length} attachment(s) for Brevo API`,
        );
        requestBody.attachment = options.attachments.map((att: any) => {
          let content = att.content;
          if (Buffer.isBuffer(content)) {
            console.log(`📎 Converting Buffer to base64 for: ${att.filename}`);
            content = content.toString("base64");
          } else if (typeof content === "string") {
            if (content.startsWith("data:")) {
              const parts = content.split(",");
              if (parts.length > 1) {
                content = parts[1];
                console.log(
                  `📎 Removed data URI prefix from attachment: ${att.filename}`,
                );
              }
            } else if (content.startsWith("/") || content.includes(".pdf")) {
              try {
                const filePath = path.isAbsolute(content)
                  ? content
                  : path.join(process.cwd(), content);
                if (fs.existsSync(filePath)) {
                  const fileBuffer = fs.readFileSync(filePath);
                  content = fileBuffer.toString("base64");
                  console.log(
                    `📎 Read file from path and converted to base64: ${att.filename}`,
                  );
                }
              } catch (fileError) {
                console.error(
                  `📎 Failed to read file for attachment: ${att.filename}`,
                  fileError,
                );
              }
            }
          }
          const contentLength =
            typeof content === "string" ? content.length : 0;
          console.log(
            `📎 Attachment: ${att.filename}, base64 length: ${contentLength} chars`,
          );
          if (typeof content === "string" && content.includes(" ")) {
            console.warn(
              `⚠️ Attachment content contains spaces - removing them: ${att.filename}`,
            );
            content = content.replace(/\s/g, "");
          }
          return {
            name: att.filename || "attachment.pdf",
            content: content,
          };
        });
        console.log(
          `📎 Attachments added to request: ${requestBody.attachment.length} file(s)`,
        );
      } else {
        console.log(`⚠️ No attachments to send`);
      }

      console.log("📧 Request body prepared successfully");
      console.log("📧 Sender:", requestBody.sender);
      console.log("📧 To:", requestBody.to);
      console.log("📧 BCC:", requestBody.bcc || "None");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(this.brevoApiUrl, {
          method: "POST",
          headers: {
            accept: "application/json",
            "api-key": this.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: any = await response.json();
          console.log(
            `✅ Email sent successfully to ${validToArray.join(", ")}`,
          );
          console.log(`   Message ID: ${data.messageId || "N/A"}`);
          console.log(`   Sender: ${senderName} <${senderEmailAddress}>`);
          console.log(`   Collection Email (BCC): ${collectionEmail}`);
          if (options?.attachments && options.attachments.length > 0) {
            console.log(
              `   ✅ Attachments: ${options.attachments.length} file(s) sent`,
            );
          }
          return true;
        } else {
          const errorText = await response.text();
          console.error(
            `❌ Brevo API error: ${response.status} - ${errorText}`,
          );
          try {
            const errorJson = JSON.parse(errorText);
            console.error(
              "   Error details:",
              JSON.stringify(errorJson, null, 2),
            );
          } catch {}
          if (response.status === 401) {
            console.error(
              "   ⚠️ Authentication failed - Please check your BREVO_API_KEY",
            );
            console.error(
              `   API Key (first 20 chars): ${this.apiKey.substring(0, 20)}...`,
            );
          } else if (response.status === 400) {
            console.error("   ⚠️ Bad request - Check email format or content");
          } else if (response.status === 429) {
            console.error(
              "   ⚠️ Rate limit exceeded - Please wait and try again",
            );
          }
          return false;
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === "AbortError") {
          console.error("❌ Email request timed out after 30 seconds");
        } else {
          console.error(`❌ Fetch error: ${fetchError.message}`);
        }
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to send email:`, error);
      return false;
    }
  }

  async sendInvoiceWithPDF(
    invoiceData: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<boolean> {
    try {
      const customerEmailsEnabled =
        await this.areCustomerEmailsEnabled(adminId);
      if (!customerEmailsEnabled) {
        console.log(`⚠️ ========================================`);
        console.log(
          `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). SKIPPING INVOICE EMAIL!`,
        );
        console.log(`⚠️ Invoice: ${invoiceData.invoiceNumber}`);
        console.log(`⚠️ This email was NOT sent because the toggle is OFF.`);
        console.log(`⚠️ ========================================`);
        return true;
      }
      console.log(
        `✅ Customer emails are ENABLED. Sending invoice to: ${invoiceData.customerEmail}`,
      );

      if (!this.isConfigured()) {
        console.log(
          `⚠️ Email service not initialized - skipping invoice to ${invoiceData.customerEmail}`,
        );
        if (process.env.NODE_ENV === "development") {
          console.log(
            `📧 [DEV MODE] Would send invoice to: ${invoiceData.customerEmail}`,
          );
          console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
          return true;
        }
        return false;
      }

      const userLocation = location || invoiceData.location || "";

      let buildingName = invoiceData.buildingName || "";
      let buildingInstallationFee = invoiceData.buildingInstallationFee || 0;

      if (!buildingName && invoiceData.applicationId) {
        try {
          const application = await Application.findOne({
            applicationId: invoiceData.applicationId,
          });
          if (application) {
            buildingName = application.buildingName || "";
            if (application.buildingId) {
              const building = await Building.findById(application.buildingId);
              if (building) {
                buildingInstallationFee = building.installationFee || 0;
                if (!buildingName) buildingName = building.buildingName;
              }
            }
          }
        } catch (error) {
          console.error("Error getting building info for email:", error);
        }
      }

      const isWilconnect = isWilconnectBuildingName(buildingName);
      const collectionEmail = isWilconnect
        ? ADDITIONAL_SENDER_EMAILS.workselpueblo
        : getCollectionEmailByLocation(userLocation);

      const bankAccount = getBankAccountForBuilding(
        buildingName,
        userLocation,
        invoiceData.customerAddress,
      );

      const brand = getBrandForBuilding(buildingName);

      let senderName = isWilconnect ? "Wilconnect" : "Mister Fyber";
      let senderEmailAddress = brand.adminEmail;

      const effectiveSenderType: SenderType =
        senderType || (useAdminSender ? "admin" : "collection");

      if (isWilconnect) {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
        console.log(
          `🏢 [WILCONNECT] sendInvoiceWithPDF building="${buildingName}" → workselpueblo@fyberblizz.com`,
        );
      } else if (effectiveSenderType === "admin") {
        senderEmailAddress = brand.adminEmail;
        senderName = "Mister Fyber Admin";
        console.log(
          `📧 Using admin email as sender: ${senderName} <${senderEmailAddress}>`,
        );
      } else if (effectiveSenderType === "workselpueblo") {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
        console.log(
          `📧 Using workselpueblo email as sender: ${senderEmailAddress}`,
        );
      } else if (effectiveSenderType === "fbsilkresidence") {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.fbsilkresidence;
        senderName = ADDITIONAL_SENDER_NAMES.fbsilkresidence;
        console.log(
          `📧 Using fbsilkresidence email as sender: ${senderEmailAddress}`,
        );
      } else if (userLocation) {
        const collectionEmailForLocation =
          getCollectionEmailByLocation(userLocation);
        if (
          collectionEmailForLocation &&
          collectionEmailForLocation !== DEFAULT_COLLECTION_EMAIL
        ) {
          senderEmailAddress = collectionEmailForLocation;
          if (collectionEmailForLocation.includes("breeze")) {
            senderName = "Mister Fyber Breeze Collection";
          } else if (
            collectionEmailForLocation.includes("sil") ||
            collectionEmailForLocation.includes("silk")
          ) {
            senderName = "Mister Fyber SIL Collection";
          } else {
            senderName = "Mister Fyber Collection";
          }
          console.log(
            `📧 Using collection email as sender: ${senderEmailAddress} (${senderName})`,
          );
        }
      }

      const pdfBase64 = pdfBuffer.toString("base64");
      const cleanBase64 = pdfBase64.replace(/\s/g, "");

      const dueDate = invoiceData.dueDate
        ? new Date(invoiceData.dueDate).toLocaleDateString()
        : "N/A";
      const amount = invoiceData.total || 0;
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";

      const isInstallationFee =
        invoiceData.isInstallationFee ||
        invoiceData.invoiceType === "installation";
      const isProRated =
        invoiceData.isProRated || invoiceData.invoiceType === "pro-rated";

      let itemsHtml = "";
      if (invoiceData.items && invoiceData.items.length > 0) {
        itemsHtml = `<table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px;">
          <thead>
            <tr style="background-color: #1a237e; color: white;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">Qty</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Rate</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Amount</th>
            </tr>
          </thead>
          <tbody>`;

        for (const item of invoiceData.items) {
          itemsHtml += `<tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${item.description}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.quantity || 1}</td>
            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">₱${safeToFixed(item.rate)}</td>
            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">₱${safeToFixed(item.amount)}</td>
          </tr>`;
        }

        itemsHtml += `<tr style="font-weight: bold; background-color: #f8f9fa;">
          <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Subtotal:</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">₱${safeToFixed(invoiceData.subtotal)}</td>
        </tr>`;

        if (invoiceData.discountAmount > 0) {
          itemsHtml += `<tr style="background-color: #f8f9fa;">
            <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Discount:</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">-₱${safeToFixed(invoiceData.discountAmount)}</td>
          </tr>`;
        }

        if (invoiceData.taxAmount > 0) {
          itemsHtml += `<tr style="background-color: #f8f9fa;">
            <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Tax (${invoiceData.taxRate}%):</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">₱${safeToFixed(invoiceData.taxAmount)}</td>
          </tr>`;
        }

        itemsHtml += `<tr style="font-weight: bold; background-color: #1a237e; color: white;">
          <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid #1a237e;">TOTAL:</td>
          <td style="padding: 12px; text-align: right; border: 1px solid #1a237e;">₱${safeToFixed(amount)}</td>
        </tr>`;

        itemsHtml += `</tbody></table>`;
      }

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-top: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const buildingInfo = buildingName
        ? `
        <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-top: 5px;">
          🏢 ${buildingName}
        </div>
      `
        : "";

      const installationFeeInfo =
        isInstallationFee && buildingInstallationFee
          ? `
        <div style="background: #fff3e0; padding: 12px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ff9800;">
          <p style="margin: 0; font-size: 13px; color: #e65100;">
            <strong>🔧 Installation Fee Details:</strong><br>
            Building: ${buildingName || "N/A"}<br>
            Installation Fee: ₱${buildingInstallationFee.toFixed(2)}<br>
            This is a one-time charge for installation at your building.
          </p>
        </div>
        `
          : "";

      const senderBadge = `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> ${senderName} (${senderEmailAddress})
        </div>
      `;

      const collectionBCCNote = `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db;">
          <strong>📧 Collection Email (BCC):</strong> ${collectionEmail}
        </div>
      `;

      let paymentInstructions = "";
      if (
        invoiceData.bankName &&
        invoiceData.accountName &&
        invoiceData.accountNumber
      ) {
        paymentInstructions = `
          <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a56db;">
            <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
            <p><strong>BANK:</strong> ${invoiceData.bankName}</p>
            <p><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${invoiceData.accountNumber}</span></p>
            <p><strong>ACCOUNT NAME:</strong> ${invoiceData.accountName}</p>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">
              Kindly send your proof of payment via Viber ${brand.companyContact} or at ${collectionEmail} after completing the transaction.
            </p>
          </div>
        `;
      } else if (
        !invoiceData.paidAt &&
        invoiceData.status !== "paid" &&
        invoiceData.status !== "free" &&
        !invoiceData.isFree
      ) {
        paymentInstructions = `
          <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a56db;">
            <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
            <p><strong>BANK:</strong> ${bankAccount.bankName}</p>
            <p><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${bankAccount.accountNumber}</span></p>
            <p><strong>ACCOUNT NAME:</strong> ${bankAccount.accountName}</p>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">
              Kindly send your proof of payment via Viber ${brand.companyContact} or at ${collectionEmail} after completing the transaction.
            </p>
          </div>
        `;
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Your ${brand.brandName} Invoice</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
                .header { text-align: center; border-bottom: 2px solid #1a237e; padding-bottom: 20px; }
                .header h1 { color: #1a237e; margin: 0; font-size: 24px; }
                .header p { color: #666; margin: 5px 0; }
                .content { padding: 20px 0; }
                .bill-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .button { display: inline-block; background-color: #1a237e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
                .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
                .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
                .company-info { text-align: center; font-size: 12px; color: #666; margin: 10px 0; }
                .invoice-type { display: inline-block; background: #1a237e; color: white; padding: 3px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; }
                .sender-info { background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center; }
                .attachments-note { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #1a56db; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>${brand.companyName}</h1>
                    <p>${brand.companyAddress}</p>
                    <p>VAT-REG.: ${brand.companyVat} | CONTACT NO.: ${brand.companyContact}</p>
                    <h2 style="color: #1a237e; margin-top: 15px;">${brand.brandName.toUpperCase()}</h2>
                    <h3 style="color: #1a237e; margin: 5px 0;">INVOICE</h3>
                    <p><span class="invoice-type">${invoiceData.invoiceType || "Monthly"}</span></p>
                    ${locationBadge}
                    ${buildingInfo}
                    ${senderBadge}
                </div>
                <div class="content">
                    <p><strong>Subscriber's Name:</strong> ${invoiceData.customerName}</p>
                    <p><strong>Address:</strong> ${invoiceData.customerAddress}</p>
                    ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                    ${invoiceData.planName ? `<p><strong>Plan Rate:</strong> ${invoiceData.planName}</p>` : ""}
                    
                    <div class="bill-details">
                        <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                        <p><strong>Billing Period:</strong> ${this.formatDateForDisplay(invoiceData.billingPeriod?.start)} - ${this.formatDateForDisplay(invoiceData.billingPeriod?.end)}</p>
                        <p><strong>Issue Date:</strong> ${this.formatDateForDisplay(invoiceData.issuedDate)}</p>
                        <p><strong>Due Date:</strong> ${dueDate}</p>
                        ${isProRated ? `<p><strong>Pro-rated Days:</strong> ${invoiceData.proRatedDays || 0} days</p>` : ""}
                        ${isInstallationFee ? `<p><strong>Invoice Type:</strong> Installation Fee</p>` : ""}
                        ${buildingInstallationFee ? `<p><strong>Installation Fee:</strong> ₱${buildingInstallationFee.toFixed(2)}</p>` : ""}
                    </div>

                    ${collectionBCCNote}
                    ${installationFeeInfo}
                    ${itemsHtml}
                    ${paymentInstructions}

                    <div class="attachments-note">
                        <p style="margin: 0; color: #1a56db;">
                            <strong>📎 Invoice PDF Attached:</strong> A copy of your invoice (${invoiceData.invoiceNumber}) is attached to this email for your records.
                        </p>
                    </div>

                    ${invoiceData.notes ? `<div style="background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0;"><p><strong>Notes:</strong><br>${invoiceData.notes}</p></div>` : ""}
                    
                    <div class="warning">
                        <strong>IMPORTANT NOTICE:</strong> Please be advised that failure to settle your account on or before the due date may result in temporary service interruption.
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/invoices" class="button">📄 View All Invoices</a>
                    </div>
                    
                    <p>Should you have any questions or need clarification, feel free to reach out.</p>
                    <p><strong>Thank you for choosing our service!</strong></p>
                    <p><strong>Best regards,</strong><br>${brand.brandName} Admin</p>
                </div>
                <div class="footer">
                    <p>${brand.brandName} - Your trusted internet provider</p>
                    <p><small>Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></small></p>
                    <p><small>This is a computer-generated invoice. No signature required.</small></p>
                    <p><small>Collection email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>
                    <p><small>Sent from: ${senderName} (${senderEmailAddress})</small></p>
                </div>
            </div>
        </body>
        </html>
      `;

      const requestBody = {
        sender: {
          name: senderName,
          email: senderEmailAddress,
        },
        to: [{ email: invoiceData.customerEmail.trim() }],
        subject: `🧾 Invoice #${invoiceData.invoiceNumber} - ${brand.brandName}`,
        htmlContent: html,
        bcc: [{ email: collectionEmail.trim() }],
        replyTo: { email: collectionEmail },
        attachment: [
          {
            name: pdfFileName,
            content: cleanBase64,
          },
        ],
      };

      console.log(`📧 Sending invoice with PDF via Brevo API...`);
      console.log(`📧 To: ${invoiceData.customerEmail}`);
      console.log(
        `📧 Subject: 🧾 Invoice #${invoiceData.invoiceNumber} - ${brand.brandName}`,
      );
      console.log(`📧 Sender: ${senderName} <${senderEmailAddress}>`);
      console.log(`📧 BCC: ${collectionEmail}`);
      console.log(
        `📧 PDF Attachment: ${pdfFileName} (${pdfBuffer.length} bytes)`,
      );
      if (isInstallationFee) {
        console.log(
          `📧 Installation Fee: ₱${buildingInstallationFee} for ${buildingName || "N/A"}`,
        );
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(this.brevoApiUrl, {
          method: "POST",
          headers: {
            accept: "application/json",
            "api-key": this.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: any = await response.json();
          console.log(
            `✅ Invoice sent with PDF to ${invoiceData.customerEmail}`,
          );
          console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
          console.log(`   Location: ${userLocation || "Not specified"}`);
          console.log(`   Building: ${buildingName || "N/A"}`);
          console.log(`   Sender: ${senderName} <${senderEmailAddress}>`);
          console.log(`   Collection Email (BCC): ${collectionEmail}`);
          console.log(`   Message ID: ${data.messageId || "N/A"}`);
          console.log(`   ✅ PDF Attachment: ${pdfFileName} sent`);
          console.log(`   ✅ PDF Size: ${pdfBuffer.length} bytes`);
          return true;
        } else {
          const errorText = await response.text();
          console.error(
            `❌ Failed to send invoice with PDF: ${response.status} - ${errorText}`,
          );
          return false;
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        console.error(`❌ Error sending invoice with PDF:`, fetchError.message);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error sending invoice with PDF:`, error);
      return false;
    }
  }

  async sendPaymentConfirmationEmail(
    invoice: any,
    payment: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    location?: string,
    useAdminSender?: boolean,
    notes?: string,
    adminName?: string,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<boolean> {
    console.log(`📧 sendPaymentConfirmationEmail called`);

    try {
      const customerEmailsEnabled =
        await this.areCustomerEmailsEnabled(adminId);
      if (!customerEmailsEnabled) {
        console.log(`⚠️ ========================================`);
        console.log(
          `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). SKIPPING PAYMENT CONFIRMATION!`,
        );
        console.log(`⚠️ Invoice: ${invoice.invoiceNumber}`);
        console.log(`⚠️ This email was NOT sent because the toggle is OFF.`);
        console.log(`⚠️ ========================================`);
        return true;
      }
      console.log(
        `✅ Customer emails are ENABLED. Sending payment confirmation to: ${invoice.customerEmail}`,
      );

      let finalPdfBuffer = pdfBuffer;
      let finalPdfFileName = pdfFileName;

      if (!pdfBuffer || pdfBuffer.length === 0) {
        console.log(`📧 Generating PDF for invoice: ${invoice.invoiceNumber}`);
        if (invoice.pdfUrl) {
          try {
            const pdfPath = path.join(__dirname, "../..", invoice.pdfUrl);
            if (fs.existsSync(pdfPath)) {
              finalPdfBuffer = fs.readFileSync(pdfPath);
              finalPdfFileName = `${invoice.invoiceNumber}.pdf`;
              console.log(
                `📧 Using existing PDF from: ${pdfPath} (${finalPdfBuffer.length} bytes)`,
              );
            }
          } catch (readError) {
            console.log(`📧 Could not read existing PDF, generating new one`);
          }
        }
        if (!finalPdfBuffer || finalPdfBuffer.length === 0) {
          finalPdfBuffer = await generateInvoicePDF(invoice);
          finalPdfFileName = `${invoice.invoiceNumber}.pdf`;
          console.log(
            `📧 PDF generated: ${finalPdfFileName} (${finalPdfBuffer.length} bytes)`,
          );
          try {
            const pdfDir = path.join(__dirname, "../../uploads/invoices");
            if (!fs.existsSync(pdfDir)) {
              fs.mkdirSync(pdfDir, { recursive: true });
            }
            const pdfPath = path.join(pdfDir, finalPdfFileName);
            fs.writeFileSync(pdfPath, finalPdfBuffer);
            await Invoice.findByIdAndUpdate(invoice._id, {
              pdfUrl: `/uploads/invoices/${finalPdfFileName}`,
              pdfGeneratedAt: new Date(),
            });
            console.log(`📧 PDF saved to: ${pdfPath}`);
          } catch (saveError) {
            console.error(`📧 Failed to save PDF:`, saveError);
          }
        }
      }

      let buildingName = invoice.buildingName || "";
      let buildingInstallationFee = invoice.buildingInstallationFee || 0;

      if (!buildingName && invoice.applicationId) {
        try {
          const application = await Application.findOne({
            applicationId: invoice.applicationId,
          });
          if (application) {
            buildingName = application.buildingName || "";
            if (application.buildingId) {
              const building = await Building.findById(application.buildingId);
              if (building) {
                buildingInstallationFee = building.installationFee || 0;
                if (!buildingName) buildingName = building.buildingName;
              }
            }
          }
        } catch (error) {
          console.error(
            "Error getting building info for payment confirmation:",
            error,
          );
        }
      }

      const invoiceData = {
        _id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        customerAddress: invoice.customerAddress,
        total: invoice.total,
        subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount || 0,
        taxAmount: invoice.taxAmount || 0,
        taxRate: invoice.taxRate || 0,
        items: invoice.items || [],
        invoiceType: invoice.invoiceType || "Monthly",
        isInstallationFee: invoice.isInstallationFee || false,
        isProRated: invoice.isProRated || false,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt || payment?.paidAt,
        referenceNumber: payment?.referenceNumber,
        location: location || invoice.location,
        notes: invoice.notes || notes,
        billingPeriod: invoice.billingPeriod,
        issuedDate: invoice.issuedDate,
        proRatedDays: invoice.proRatedDays || 0,
        planName: invoice.planName,
        buildingName: buildingName,
        buildingInstallationFee: buildingInstallationFee,
        applicationId: invoice.applicationId,
      };

      console.log(
        `📧 Sending paid invoice email with PDF (${finalPdfBuffer ? finalPdfBuffer.length : 0} bytes)`,
      );
      console.log(
        `📧 Building: ${buildingName}, Installation Fee: ${buildingInstallationFee}`,
      );

      return await this.sendPaidInvoiceEmail(
        invoiceData,
        finalPdfBuffer,
        finalPdfFileName,
        payment,
        location,
        useAdminSender,
        senderType,
        false,
        false,
        adminId,
      );
    } catch (error) {
      console.error(`❌ Error in sendPaymentConfirmationEmail:`, error);

      try {
        const htmlContent = this.generatePaymentConfirmationHTML(
          invoice,
          payment,
          invoice.total || 0,
          new Date().toLocaleString(),
          location,
          getCollectionEmailByLocation(location || ""),
          invoice.isInstallationFee || false,
          invoice.buildingName || "",
          invoice.buildingInstallationFee || 0,
        );

        await this.sendEmail(
          invoice.customerEmail,
          `✅ Payment Confirmed - ${invoice.invoiceNumber}`,
          htmlContent,
          true,
          location,
          {
            bcc: [getCollectionEmailByLocation(location || "")],
            replyTo: getCollectionEmailByLocation(location || ""),
            senderType,
            buildingName: invoice.buildingName,
            adminId,
          },
        );
        console.log(
          `✅ Fallback email sent without PDF to ${invoice.customerEmail}`,
        );
        return true;
      } catch (fallbackError) {
        console.error(`❌ Fallback email also failed:`, fallbackError);
        return false;
      }
    }
  }

  async sendPaidInvoiceEmail(
    invoiceData: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    paymentData?: any,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    forceSend: boolean = false,
    isFree: boolean = false,
    adminId?: string,
  ): Promise<boolean> {
    try {
      const free =
        isFree === true ||
        invoiceData?.isFree === true ||
        (invoiceData?.paymentMethod &&
          String(invoiceData.paymentMethod).toLowerCase() === "free") ||
        (invoiceData?.status &&
          String(invoiceData.status).toLowerCase() === "free");

      console.log(`📧 sendPaidInvoiceEmail called`);
      console.log(`📧 Invoice: ${invoiceData.invoiceNumber}`);
      console.log(`📧 Customer: ${invoiceData.customerEmail}`);
      console.log(`📧 Location: ${location || "Not specified"}`);
      console.log(`📧 Building: ${invoiceData.buildingName || "N/A"}`);
      console.log(
        `📧 Installation Fee: ${invoiceData.buildingInstallationFee || 0}`,
      );
      console.log(`📧 PDF size: ${pdfBuffer ? pdfBuffer.length : 0} bytes`);
      console.log(`📧 forceSend: ${forceSend}`);
      console.log(`📧 isFree: ${free}`);
      console.log(`📧 adminId: ${adminId || "N/A"}`);

      if (!forceSend) {
        const customerEmailsEnabled =
          await this.areCustomerEmailsEnabled(adminId);
        if (!customerEmailsEnabled) {
          console.log(`⚠️ ========================================`);
          console.log(
            `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). SKIPPING RECEIPT EMAIL!`,
          );
          console.log(`⚠️ Invoice: ${invoiceData.invoiceNumber}`);
          console.log(`⚠️ This email was NOT sent because the toggle is OFF.`);
          console.log(`⚠️ ========================================`);
          return true;
        }
      } else {
        console.log(
          `📧 [SECURITY-CRITICAL] Sending receipt to: ${invoiceData.customerEmail}`,
        );
      }

      let finalPdfBuffer = pdfBuffer;
      let finalPdfFileName = pdfFileName;

      if (!finalPdfBuffer || finalPdfBuffer.length === 0) {
        console.log(
          `📧 PDF buffer is empty, generating PDF for invoice: ${invoiceData.invoiceNumber}`,
        );
        try {
          finalPdfBuffer = await generateInvoicePDF({
            ...invoiceData,
            isFree: free,
            status: free ? "free" : invoiceData.status,
          } as any);
          finalPdfFileName = `${invoiceData.invoiceNumber}.pdf`;
          console.log(
            `📧 PDF generated successfully: ${finalPdfBuffer.length} bytes`,
          );
          try {
            const pdfDir = path.join(__dirname, "../../uploads/invoices");
            if (!fs.existsSync(pdfDir)) {
              fs.mkdirSync(pdfDir, { recursive: true });
            }
            const pdfPath = path.join(pdfDir, finalPdfFileName);
            fs.writeFileSync(pdfPath, finalPdfBuffer);
            console.log(`📧 PDF saved to: ${pdfPath}`);
          } catch (saveError) {
            console.error(`📧 Failed to save PDF:`, saveError);
          }
        } catch (genError) {
          console.error(`❌ Failed to generate PDF:`, genError);
          if (invoiceData._id) {
            try {
              const invoice = await Invoice.findById(invoiceData._id);
              if (invoice && invoice.pdfUrl) {
                const pdfPath = path.join(__dirname, "../..", invoice.pdfUrl);
                if (fs.existsSync(pdfPath)) {
                  finalPdfBuffer = fs.readFileSync(pdfPath);
                  finalPdfFileName = `${invoiceData.invoiceNumber}.pdf`;
                  console.log(
                    `📧 Using existing PDF from: ${pdfPath} (${finalPdfBuffer.length} bytes)`,
                  );
                }
              }
            } catch (readError) {
              console.error(`📧 Failed to read existing PDF:`, readError);
            }
          }
        }
      }

      if (!finalPdfBuffer || finalPdfBuffer.length === 0) {
        console.log(`📧 Trying to find PDF from Invoice model...`);
        try {
          const invoice = await Invoice.findOne({
            invoiceNumber: invoiceData.invoiceNumber,
          });
          if (invoice && invoice.pdfUrl) {
            const pdfPath = path.join(__dirname, "../..", invoice.pdfUrl);
            if (fs.existsSync(pdfPath)) {
              finalPdfBuffer = fs.readFileSync(pdfPath);
              finalPdfFileName = `${invoiceData.invoiceNumber}.pdf`;
              console.log(
                `📧 Found existing PDF: ${pdfPath} (${finalPdfBuffer.length} bytes)`,
              );
            }
          }
        } catch (findError) {
          console.error(`📧 Failed to find invoice:`, findError);
        }
      }

      if (!finalPdfBuffer || finalPdfBuffer.length === 0) {
        console.error(
          `❌ CRITICAL: No PDF available for invoice ${invoiceData.invoiceNumber}`,
        );
        const htmlContent = this.generatePaymentConfirmationHTML(
          invoiceData,
          paymentData,
          invoiceData.total || 0,
          new Date().toLocaleString(),
          location,
          getCollectionEmailByLocation(location || ""),
          invoiceData.isInstallationFee || false,
          invoiceData.buildingName || "",
          invoiceData.buildingInstallationFee || 0,
        );
        return await this.sendEmail(
          invoiceData.customerEmail,
          `${free ? "🎁 FREE Receipt" : "✅ Payment Confirmed"} - ${invoiceData.invoiceNumber}`,
          htmlContent,
          true,
          location,
          {
            bcc: [getCollectionEmailByLocation(location || "")],
            replyTo: getCollectionEmailByLocation(location || ""),
            senderType,
            forceSend,
            buildingName: invoiceData.buildingName,
            adminId,
          },
        );
      }

      const pdfBase64 = finalPdfBuffer.toString("base64");
      console.log(
        `📧 PDF converted to base64, length: ${pdfBase64.length} chars`,
      );
      const cleanBase64 = pdfBase64.replace(/\s/g, "");
      if (cleanBase64.length !== pdfBase64.length) {
        console.log(`📧 Removed spaces from base64 string`);
      }

      if (!this.isConfigured()) {
        console.log(
          `⚠️ Email service not initialized - skipping receipt to ${invoiceData.customerEmail}`,
        );
        if (process.env.NODE_ENV === "development") {
          console.log(
            `📧 [DEV MODE] Would send ${free ? "FREE" : "paid"} invoice to: ${invoiceData.customerEmail}`,
          );
          console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
          return true;
        }
        return false;
      }

      const userLocation = location || invoiceData.location || "";

      const isWilconnect = isWilconnectBuildingName(invoiceData.buildingName);
      const collectionEmail = isWilconnect
        ? ADDITIONAL_SENDER_EMAILS.workselpueblo
        : getCollectionEmailByLocation(userLocation);

      const brand = getBrandForBuilding(invoiceData.buildingName);

      let senderName = isWilconnect ? "Wilconnect" : "Mister Fyber";
      let senderEmailAddress = brand.adminEmail;

      const effectiveSenderType: SenderType =
        senderType || (useAdminSender ? "admin" : "collection");

      if (isWilconnect) {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
        console.log(
          `🏢 [WILCONNECT] sendPaidInvoiceEmail building="${invoiceData.buildingName}" → workselpueblo@fyberblizz.com`,
        );
      } else if (effectiveSenderType === "admin") {
        senderEmailAddress = brand.adminEmail;
        senderName = "Mister Fyber Admin";
        console.log(
          `📧 Using admin email as sender: ${senderName} <${senderEmailAddress}>`,
        );
      } else if (effectiveSenderType === "workselpueblo") {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.workselpueblo;
        senderName = ADDITIONAL_SENDER_NAMES.workselpueblo;
        console.log(
          `📧 Using workselpueblo email as sender: ${senderEmailAddress}`,
        );
      } else if (effectiveSenderType === "fbsilkresidence") {
        senderEmailAddress = ADDITIONAL_SENDER_EMAILS.fbsilkresidence;
        senderName = ADDITIONAL_SENDER_NAMES.fbsilkresidence;
        console.log(
          `📧 Using fbsilkresidence email as sender: ${senderEmailAddress}`,
        );
      } else if (userLocation) {
        const collectionEmailForLocation =
          getCollectionEmailByLocation(userLocation);
        if (
          collectionEmailForLocation &&
          collectionEmailForLocation !== DEFAULT_COLLECTION_EMAIL
        ) {
          senderEmailAddress = collectionEmailForLocation;
          if (collectionEmailForLocation.includes("breeze")) {
            senderName = "Mister Fyber Breeze Collection";
          } else if (
            collectionEmailForLocation.includes("sil") ||
            collectionEmailForLocation.includes("silk")
          ) {
            senderName = "Mister Fyber SIL Collection";
          } else {
            senderName = "Mister Fyber Collection";
          }
          console.log(
            `📧 Using collection email as sender: ${senderEmailAddress} (${senderName})`,
          );
        }
      }

      const dueDate = invoiceData.dueDate
        ? new Date(invoiceData.dueDate).toLocaleDateString()
        : "N/A";
      const amount = free ? 0 : invoiceData.total || 0;
      const paidAt = invoiceData.paidAt
        ? new Date(invoiceData.paidAt).toLocaleString()
        : paymentData?.paidAt
          ? new Date(paymentData.paidAt).toLocaleString()
          : new Date().toLocaleString();
      const referenceNumber =
        paymentData?.referenceNumber || invoiceData.referenceNumber || "N/A";
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";

      const isInstallationFee =
        invoiceData.isInstallationFee ||
        invoiceData.invoiceType === "installation";
      const isProRated =
        invoiceData.isProRated || invoiceData.invoiceType === "pro-rated";
      const buildingName = invoiceData.buildingName || "";
      const buildingInstallationFee = invoiceData.buildingInstallationFee || 0;

      let itemsHtml = "";
      if (invoiceData.items && invoiceData.items.length > 0) {
        const headerColor = free ? "#0ea5e9" : "#28a745";
        itemsHtml = `<table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px;">
          <thead>
            <tr style="background-color: ${headerColor}; color: white;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
              <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">Qty</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Rate</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Amount</th>
            </tr>
          </thead>
          <tbody>`;

        for (const item of invoiceData.items) {
          const itemAmount = free ? "0.00" : safeToFixed(item.amount);
          const itemRate = free ? "Php 0.00" : `₱${safeToFixed(item.rate)}`;
          itemsHtml += `<tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${item.description}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.quantity || 1}</td>
            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${itemRate}</td>
            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">₱${itemAmount}</td>
          </tr>`;
        }

        const totalLabel = free ? "TOTAL — FREE:" : "TOTAL PAID:";
        itemsHtml += `<tr style="font-weight: bold; background-color: ${headerColor}; color: white;">
          <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid ${headerColor};">${totalLabel}</td>
          <td style="padding: 12px; text-align: right; border: 1px solid ${headerColor};">₱${safeToFixed(amount)}</td>
        </tr>`;

        itemsHtml += `</tbody></table>`;
      }

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-top: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const buildingInfo = buildingName
        ? `
        <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-top: 5px;">
          🏢 ${buildingName}
        </div>
      `
        : "";

      const installationFeeInfo =
        isInstallationFee && buildingInstallationFee
          ? `
        <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ff9800;">
          <p style="margin: 0; color: #e65100;">
            <strong>🔧 Installation Fee Details:</strong><br>
            Building: ${buildingName || "N/A"}<br>
            Installation Fee: ₱${buildingInstallationFee.toFixed(2)}<br>
            This is a one-time charge for installation at your building.
          </p>
        </div>
        `
          : "";

      const senderBadge = `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> ${senderName} (${senderEmailAddress})
        </div>
      `;

      const collectionBCCNote = `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db;">
          <strong>📧 Collection Email (BCC):</strong> ${collectionEmail}
        </div>
      `;

      let additionalInfo = "";
      if (free) {
        additionalInfo = `
          <div style="background: #e0f2fe; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 0; color: #0369a1;">
              <strong>🎁 FREE OF CHARGE:</strong> This invoice has been marked as <strong>FREE (waived)</strong>. No payment is required. This email serves as your official receipt.
            </p>
          </div>
        `;
      } else if (isInstallationFee) {
        additionalInfo = `
          <div style="background: #d1ecf1; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 0; color: #0c5460;">
              <strong>🔧 Installation Fee Paid:</strong> Your installation fee of ₱${safeToFixed(amount)} for ${buildingName || "your building"} has been paid. Our technical team will contact you within 24-48 hours to schedule your installation.
            </p>
          </div>
        `;
      } else if (isProRated) {
        additionalInfo = `
          <div style="background: #d1ecf1; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 0; color: #0c5460;">
              <strong>📌 Pro-rated First Bill Paid:</strong> Your pro-rated first bill of ₱${safeToFixed(amount)} has been paid. Your service is now active!
            </p>
          </div>
        `;
      } else {
        additionalInfo = `
          <div style="background: #d1ecf1; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 0; color: #0c5460;">
              <strong>📌 Monthly Subscription Paid:</strong> Your monthly subscription payment of ₱${safeToFixed(amount)} has been confirmed. Your service will continue without interruption.
            </p>
          </div>
        `;
      }

      const headerTitle = free ? "🎁 FREE OF CHARGE" : "✅ PAYMENT CONFIRMED!";
      const headerBorder = free ? "#0ea5e9" : "#28a745";
      const headerTextColor = free ? "#0369a1" : "#28a745";
      const badgeText = free ? "🎁 FREE" : "✅ PAID";
      const emailSubject = free
        ? `🎁 FREE Receipt - ${invoiceData.invoiceNumber} - ${brand.brandName}`
        : `✅ Payment Confirmed - ${invoiceData.invoiceNumber} - ${brand.brandName}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${headerTitle} - ${invoiceData.invoiceNumber}</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid ${headerBorder}; border-radius: 10px; }
                .header { text-align: center; border-bottom: 2px solid ${headerBorder}; padding-bottom: 20px; }
                .header h1 { color: ${headerTextColor}; margin: 0; font-size: 28px; }
                .header p { color: #666; margin: 5px 0; }
                .content { padding: 20px 0; }
                .paid-badge { display: inline-block; background: ${headerBorder}; color: white; padding: 6px 20px; border-radius: 20px; font-weight: bold; font-size: 14px; }
                .bill-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .button { display: inline-block; background-color: ${headerBorder}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
                .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
                .company-info { text-align: center; font-size: 12px; color: #666; margin: 10px 0; }
                .invoice-type { display: inline-block; background: ${headerBorder}; color: white; padding: 3px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; }
                .sender-info { background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center; }
                .payment-details { background: ${free ? "#e0f2fe" : "#e8f5e9"}; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid ${headerBorder}; }
                .attachments-note { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #1a56db; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>${headerTitle}</h1>
                    <p>${brand.brandName.toUpperCase()}</p>
                    <p>${brand.companyName}</p>
                    <p>${brand.companyAddress}</p>
                    <p>VAT-REG.: ${brand.companyVat} | CONTACT NO.: ${brand.companyContact}</p>
                    <div style="margin: 15px 0;">
                        <span class="paid-badge">${badgeText}</span>
                    </div>
                    <p><span class="invoice-type">${invoiceData.invoiceType || "Monthly"} - ${free ? "FREE" : "PAID"}</span></p>
                    ${locationBadge}
                    ${buildingInfo}
                    ${senderBadge}
                </div>
                <div class="content">
                    <p><strong>Dear ${invoiceData.customerName || "Customer"},</strong></p>
                    <p>${free ? "This is your FREE receipt for the waived invoice below." : "We are pleased to confirm that your payment has been received and processed successfully."}</p>
                    
                    <div class="payment-details">
                        <h4 style="margin-top: 0; color: ${headerTextColor};">${free ? "🎁 Receipt Details" : "₱ Payment Details"}</h4>
                        <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                        <p><strong>Amount ${free ? "(Waived)" : "Paid"}:</strong> <span style="color: ${headerTextColor}; font-size: 20px; font-weight: bold;">₱${safeToFixed(amount)}</span></p>
                        <p><strong>${free ? "Marked Free On" : "Payment Date"}:</strong> ${paidAt}</p>
                        <p><strong>Reference Number:</strong> ${referenceNumber}</p>
                        <p><strong>Invoice Type:</strong> ${invoiceData.invoiceType || "Monthly"}${free ? " (FREE)" : ""}</p>
                        ${isInstallationFee ? `<p><strong>Note:</strong> Installation Fee ${free ? "Waived" : "Payment"} for ${buildingName || "your building"}</p>` : ""}
                        ${isProRated ? `<p><strong>Note:</strong> Pro-rated First Bill</p>` : ""}
                        ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                        ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                        ${buildingInstallationFee ? `<p><strong>Installation Fee:</strong> ₱${buildingInstallationFee.toFixed(2)}</p>` : ""}
                    </div>

                    ${collectionBCCNote}
                    ${itemsHtml}
                    ${additionalInfo}

                    <div class="attachments-note">
                        <p style="margin: 0; color: #1a56db;">
                            <strong>📎 Receipt PDF Attached:</strong> A copy of your ${free ? "FREE receipt" : "paid invoice"} (${invoiceData.invoiceNumber}) is attached to this email for your records.
                        </p>
                    </div>

                    ${invoiceData.notes ? `<div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;"><p><strong>Notes:</strong><br>${invoiceData.notes}</p></div>` : ""}
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/invoices" class="button">📄 View All Invoices</a>
                    </div>
                    
                    <p>Thank you for choosing ${brand.brandName} as your trusted internet provider.</p>
                    <p><strong>Best regards,</strong><br>${brand.brandName} Team</p>
                </div>
                <div class="footer">
                    <p>${brand.brandName} - Your trusted internet provider</p>
                    <p><small>Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></small></p>
                    <p><small>This is a computer-generated receipt. No signature required.</small></p>
                    <p><small>Collection email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>
                    <p><small>Sent from: ${senderName} (${senderEmailAddress})</small></p>
                    <p><small>${free ? "Marked Free On" : "Payment Date"}: ${paidAt}</small></p>
                </div>
            </div>
        </body>
        </html>
      `;

      const requestBody = {
        sender: {
          name: senderName,
          email: senderEmailAddress,
        },
        to: [{ email: invoiceData.customerEmail.trim() }],
        subject: emailSubject,
        htmlContent: html,
        bcc: [{ email: collectionEmail.trim() }],
        replyTo: { email: collectionEmail },
        attachment: [
          {
            name: finalPdfFileName,
            content: cleanBase64,
          },
        ],
      };

      console.log(
        `📧 Sending ${free ? "FREE" : "paid"} invoice email via Brevo API...`,
      );
      console.log(`📧 To: ${invoiceData.customerEmail}`);
      console.log(`📧 Subject: ${emailSubject}`);
      console.log(`📧 Sender: ${senderName} <${senderEmailAddress}>`);
      console.log(`📧 BCC: ${collectionEmail}`);
      console.log(
        `📧 PDF Attachment: ${finalPdfFileName} (${finalPdfBuffer.length} bytes)`,
      );
      console.log(`📧 Building: ${buildingName || "N/A"}`);
      console.log(`📧 Installation Fee: ${buildingInstallationFee}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(this.brevoApiUrl, {
          method: "POST",
          headers: {
            accept: "application/json",
            "api-key": this.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: any = await response.json();
          console.log(
            `✅ ${free ? "FREE" : "Paid"} invoice email sent successfully to ${invoiceData.customerEmail}`,
          );
          console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
          console.log(`   Location: ${userLocation || "Not specified"}`);
          console.log(`   Building: ${buildingName || "N/A"}`);
          console.log(`   Sender: ${senderName} <${senderEmailAddress}>`);
          console.log(`   Collection Email (BCC): ${collectionEmail}`);
          console.log(`   Message ID: ${data.messageId || "N/A"}`);
          console.log(`   ✅ PDF Attachment: ${finalPdfFileName} sent`);
          console.log(`   ✅ PDF Size: ${finalPdfBuffer.length} bytes`);
          console.log(`✅ ========================================`);
          return true;
        } else {
          const errorText = await response.text();
          console.error(
            `❌ Failed to send ${free ? "FREE" : "paid"} invoice email: ${response.status} - ${errorText}`,
          );
          console.error(`❌ ========================================`);
          return false;
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        console.error(
          `❌ Error sending ${free ? "FREE" : "paid"} invoice email:`,
          fetchError.message,
        );
        console.error(`❌ ========================================`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error sending paid/free invoice email:`, error);
      console.error(`❌ ========================================`);
      return false;
    }
  }

  async sendBillingEmail(
    user: IUser | any,
    billing: any,
    location?: string,
    options?: {
      cc?: string | string[];
      attachments?: any[];
      replyTo?: string;
      useAdminSender?: boolean;
      senderType?: SenderType;
      adminId?: string;
    },
  ): Promise<boolean> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));

      let buildingName = "";
      let buildingInstallationFee = 0;
      if (billing.applicationId) {
        try {
          const application = await Application.findOne({
            applicationId: billing.applicationId,
          });
          if (application) {
            buildingName = application.buildingName || "";
            if (application.buildingId) {
              const building = await Building.findById(application.buildingId);
              if (building) {
                buildingInstallationFee = building.installationFee || 0;
                if (!buildingName) buildingName = building.buildingName;
              }
            }
          }
        } catch (error) {
          console.error(
            "Error getting building info for billing email:",
            error,
          );
        }
      }

      const resolvedCollectionEmail = getResolvedCollectionEmail(
        buildingName,
        userLocation,
      );

      const brand = getBrandForBuilding(buildingName);
      const subject = `🧾 Invoice #${billing.invoiceNumber || billing._id} - ${brand.brandName}`;
      const html = this.generateInvoiceHTML(
        user,
        billing,
        userLocation,
        buildingName,
        buildingInstallationFee,
      );

      return await this.sendEmail(
        user.email,
        subject,
        html,
        true,
        userLocation,
        {
          cc: options?.cc,
          attachments: options?.attachments,
          replyTo: options?.replyTo || resolvedCollectionEmail,
          bcc: [resolvedCollectionEmail],
          useAdminSender: options?.useAdminSender || false,
          senderType: options?.senderType,
          isWilconnect: brand.isWilconnect,
          buildingName: buildingName,
          adminId: options?.adminId,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending billing email:`, error);
      return false;
    }
  }

  async sendInvoice(
    user: IUser | any,
    billing: any,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      await this.sendBillingEmail(user, billing, userLocation, {
        useAdminSender,
        senderType,
        adminId,
      });
    } catch (error) {
      console.error(`❌ Error sending invoice:`, error);
    }
  }

  async sendPaymentReminder(
    user: IUser | any,
    billing: any,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));

      let buildingName = "";
      let buildingInstallationFee = 0;
      if (billing.applicationId) {
        try {
          const application = await Application.findOne({
            applicationId: billing.applicationId,
          });
          if (application) {
            buildingName = application.buildingName || "";
            if (application.buildingId) {
              const building = await Building.findById(application.buildingId);
              if (building) {
                buildingInstallationFee = building.installationFee || 0;
                if (!buildingName) buildingName = building.buildingName;
              }
            }
          }
        } catch (error) {
          console.error(
            "Error getting building info for payment reminder:",
            error,
          );
        }
      }

      const resolvedCollectionEmail = getResolvedCollectionEmail(
        buildingName,
        userLocation,
      );

      const brand = getBrandForBuilding(buildingName);
      const dueDate = billing.dueDate
        ? new Date(billing.dueDate).toLocaleDateString()
        : "N/A";
      const amount = billing.total || billing.amount || 0;

      const html = this.generatePaymentReminderHTML(
        user,
        billing,
        amount,
        dueDate,
        userLocation,
        resolvedCollectionEmail,
        billing.isInstallationBill || false,
        billing.isProRated || false,
        buildingName,
        buildingInstallationFee,
      );

      await this.sendEmail(
        user.email,
        `⚠️ Payment Reminder - Due ${dueDate} - ${brand.brandName}`,
        html,
        true,
        userLocation,
        {
          bcc: [resolvedCollectionEmail],
          replyTo: resolvedCollectionEmail,
          useAdminSender: useAdminSender || false,
          senderType,
          isWilconnect: brand.isWilconnect,
          buildingName: buildingName,
          adminId,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending payment reminder:`, error);
    }
  }

  async sendDueDateReminder(
    user: IUser | any,
    billing: any,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));

      let buildingName = "";
      let buildingInstallationFee = 0;
      if (billing.applicationId) {
        try {
          const application = await Application.findOne({
            applicationId: billing.applicationId,
          });
          if (application) {
            buildingName = application.buildingName || "";
            if (application.buildingId) {
              const building = await Building.findById(application.buildingId);
              if (building) {
                buildingInstallationFee = building.installationFee || 0;
                if (!buildingName) buildingName = building.buildingName;
              }
            }
          }
        } catch (error) {
          console.error(
            "Error getting building info for due date reminder:",
            error,
          );
        }
      }

      const resolvedCollectionEmail = getResolvedCollectionEmail(
        buildingName,
        userLocation,
      );

      const brand = getBrandForBuilding(buildingName);
      const dueDate = billing.dueDate
        ? new Date(billing.dueDate).toLocaleDateString()
        : "N/A";
      const amount = billing.total || billing.amount || 0;

      const html = this.generateDueDateReminderHTML(
        user,
        billing,
        amount,
        dueDate,
        userLocation,
        resolvedCollectionEmail,
        billing.isInstallationBill || false,
        billing.isProRated || false,
        buildingName,
        buildingInstallationFee,
      );

      await this.sendEmail(
        user.email,
        `⚠️ PAYMENT DUE TODAY - ${billing.invoiceNumber || billing._id} - ${brand.brandName}`,
        html,
        true,
        userLocation,
        {
          bcc: [resolvedCollectionEmail],
          replyTo: resolvedCollectionEmail,
          useAdminSender: useAdminSender || false,
          senderType,
          isWilconnect: brand.isWilconnect,
          buildingName: buildingName,
          adminId,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending due date reminder:`, error);
    }
  }

  async sendBillWithoutAccount(
    application: any,
    bill: any,
    plan: any,
    buildingNameFromController?: string,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<void> {
    try {
      const userLocation =
        location || (await getLocationFromEntity(application));

      let buildingName =
        buildingNameFromController || application.buildingName || "";
      let buildingInstallationFee = 0;
      if (application.buildingId) {
        try {
          const building = await Building.findById(application.buildingId);
          if (building) {
            buildingInstallationFee = building.installationFee || 0;
            if (!buildingName) buildingName = building.buildingName;
          }
        } catch (error) {
          console.error(
            "Error getting building info for bill without account:",
            error,
          );
        }
      }

      const resolvedCollectionEmail = getResolvedCollectionEmail(
        buildingName,
        userLocation,
      );

      const brand = getBrandForBuilding(buildingName);
      const dueDate = bill.dueDate
        ? new Date(bill.dueDate).toLocaleDateString()
        : "N/A";
      const amount = bill.total || 0;

      const html = this.generateBillWithoutAccountHTML(
        application,
        bill,
        plan,
        amount,
        dueDate,
        userLocation,
        resolvedCollectionEmail,
        buildingName,
        buildingInstallationFee,
      );

      await this.sendEmail(
        application.email,
        `🧾 Your Bill is Ready - ${bill.invoiceNumber} - ${brand.brandName}`,
        html,
        true,
        userLocation,
        {
          bcc: [resolvedCollectionEmail],
          replyTo: resolvedCollectionEmail,
          useAdminSender: useAdminSender || false,
          senderType,
          isWilconnect: brand.isWilconnect,
          buildingName: buildingName,
          adminId,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending bill without account:`, error);
    }
  }

  async sendBillingReminder(
    user: IUser | any,
    billing: any,
    location?: string,
    useAdminSender?: boolean,
    senderType?: SenderType,
    adminId?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));

      let buildingName = "";
      let buildingInstallationFee = 0;
      if (billing.applicationId) {
        try {
          const application = await Application.findOne({
            applicationId: billing.applicationId,
          });
          if (application) {
            buildingName = application.buildingName || "";
            if (application.buildingId) {
              const building = await Building.findById(application.buildingId);
              if (building) {
                buildingInstallationFee = building.installationFee || 0;
                if (!buildingName) buildingName = building.buildingName;
              }
            }
          }
        } catch (error) {
          console.error(
            "Error getting building info for billing reminder:",
            error,
          );
        }
      }

      const resolvedCollectionEmail = getResolvedCollectionEmail(
        buildingName,
        userLocation,
      );
      const bankAccount = getBankAccountForBuilding(
        buildingName,
        userLocation,
        undefined,
      );
      const brand = getBrandForBuilding(buildingName);
      const dueDate = billing.dueDate
        ? new Date(billing.dueDate).toLocaleDateString()
        : "N/A";
      const amount = billing.total || billing.amount || 0;
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const buildingInfo = buildingName
        ? `
        <div style="display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 12px; font-size: 11px; margin-bottom: 10px;">
          🏢 ${buildingName}
        </div>
      `
        : "";

      const installationFeeInfo =
        billing.isInstallationBill && buildingInstallationFee
          ? `
        <div style="margin-top: 10px; padding: 8px; background-color: #fff3e0; border-radius: 5px; border-left: 4px solid #ff9800;">
          <p style="margin: 0; font-size: 12px; color: #e65100;">
            <strong>🔧 Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()} (One-time charge)
          </p>
        </div>
        `
          : "";

      let senderNote = "";
      if (isWilconnectBuildingName(buildingName)) {
        senderNote = `
          <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
            <strong>📧 Sent from:</strong> ${ADDITIONAL_SENDER_NAMES.workselpueblo} (${ADDITIONAL_SENDER_EMAILS.workselpueblo})
          </div>
        `;
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Billing Reminder</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #f39c12;">📅 Billing Reminder</h2>
                <p>Hello ${user.firstName || user.email},</p>
                <p>Your ${brand.brandName} bill is due on ${dueDate}.</p>
                ${locationBadge}
                ${buildingInfo}
                ${senderNote}
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Due Date:</strong> ${dueDate}</p>
                    ${installationFeeInfo}
                    ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                    ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                </div>

                <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #1a56db;">
                    <h4 style="margin-top: 0; color: #1a56db;">💳 NEW ACCOUNT FOR PAYMENT</h4>
                    <p style="margin: 5px 0;"><strong>BANK:</strong> ${bankAccount.bankName}</p>
                    <p style="margin: 5px 0;"><strong>ACCOUNT NUMBER:</strong> <span style="font-family: monospace; font-size: 15px; font-weight: bold; color: #1a237e;">${bankAccount.accountNumber}</span></p>
                    <p style="margin: 5px 0;"><strong>ACCOUNT NAME:</strong> ${bankAccount.accountName}</p>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Bill</a>
                </div>
                <hr>
                <p style="color: #666; font-size: 12px;">This is an automated reminder from ${brand.brandName}.</p>
                ${resolvedCollectionEmail ? `<p style="color: #666; font-size: 12px;">Collection Email: <a href="mailto:${resolvedCollectionEmail}">${resolvedCollectionEmail}</a></p>` : ""}
            </div>
        </body>
        </html>
      `;

      await this.sendEmail(
        user.email,
        `📅 Billing Reminder - Due ${dueDate} - ${brand.brandName}`,
        html,
        true,
        userLocation,
        {
          bcc: [resolvedCollectionEmail],
          replyTo: resolvedCollectionEmail,
          useAdminSender: useAdminSender || false,
          senderType,
          isWilconnect: brand.isWilconnect,
          buildingName: buildingName,
          adminId,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending billing reminder:`, error);
    }
  }

  async sendWelcomeEmail(user: IUser, adminId?: string): Promise<void> {
    // Toggle check will happen inside sendEmail → areCustomerEmailsEnabled.
    // If no adminId is passed, areCustomerEmailsEnabled uses primary admin.
    console.log(`📧 Sending welcome email to: ${user.email} (checking toggle)`);

    const html = this.generateWelcomeHTML(user);
    const sent = await this.sendEmail(
      user.email,
      `🎉 Welcome to Mister Fyber, ${user.firstName || user.email}!`,
      html,
      true,
      undefined,
      { adminId },
    );

    if (sent) {
      console.log(`✅ Welcome email processed for ${user.email}`);
    } else {
      console.warn(`⚠️ Welcome email failed for ${user.email}`);
    }
  }

  async sendPasswordReset(user: IUser, resetToken: string): Promise<void> {
    // Security-critical: always send.
    const html = this.generatePasswordResetHTML(user, resetToken);
    await this.sendEmail(
      user.email,
      "Password Reset Request",
      html,
      true,
      undefined,
      { forceSend: true },
    );
  }

  async sendAccountCredentials(
    user: IUser,
    username: string,
    password: string,
    applicationId: string,
  ): Promise<void> {
    // Security-critical: always send.
    const html = this.generateAccountCredentialsHTML(
      user,
      username,
      password,
      applicationId,
    );
    await this.sendEmail(
      user.email,
      `🔐 Your Mister Fyber Account Credentials`,
      html,
      true,
      undefined,
      { forceSend: true },
    );
  }

  async sendApplicationReceived(
    application: any,
    plan: any,
    buildingNameFromController?: string,
    adminId?: string,
  ): Promise<void> {
    console.log(`📧 ========================================`);
    console.log(`📧 sendApplicationReceived called`);
    console.log(`   Application ID: ${application?.applicationId}`);
    console.log(
      `   Application planId: ${application?.planId ? String(application.planId) : "NULL"}`,
    );
    console.log(
      `   Passed plan: ${JSON.stringify(plan || {}).substring(0, 200)}`,
    );
    console.log(`   Passed plan is valid? ${isValidPlan(plan)}`);
    console.log(
      `   buildingNameFromController: "${buildingNameFromController || "N/A"}"`,
    );
    console.log(
      `   adminId: ${adminId || "N/A (will use primary admin's toggle)"}`,
    );

    let resolvedPlan: any = null;

    if (isValidPlan(plan)) {
      console.log(`✅ Using passed plan (it's valid)`);
      resolvedPlan = plan;
    } else {
      console.log(
        `⚠️ Passed plan is INVALID - fetching from DB using application.planId`,
      );
      resolvedPlan = await resolvePlanForApplication(application);
    }

    let buildingName =
      buildingNameFromController || application.buildingName || "";
    if (!buildingName && application.buildingId) {
      try {
        const building = await Building.findById(application.buildingId);
        if (building) buildingName = building.buildingName || "";
      } catch (e) {
        console.error("Error fetching building for email:", e);
      }
    }

    const brand = await getBrandForApplication({
      ...application,
      buildingName,
    });

    console.log(`📧 FINAL resolved plan:`);
    console.log(`   Name: ${resolvedPlan?.name || "N/A"}`);
    console.log(`   Price: ₱${resolvedPlan?.price ?? 0}`);
    console.log(`   Brand: ${brand.brandName}`);
    console.log(`   isWilconnect: ${brand.isWilconnect}`);
    console.log(`   buildingName: "${buildingName}"`);
    console.log(`📧 ========================================`);

    const html = this.generateApplicationReceivedHTML(
      application,
      resolvedPlan,
      brand,
    );

    // Customer confirmation email — sendEmail will check the toggle internally.
    await this.sendEmail(
      application.email,
      `Application Received - ${application.applicationId}`,
      html,
      true,
      buildingName,
      {
        senderType: "admin",
        isWilconnect: brand.isWilconnect,
        buildingName: buildingName,
        adminId,
      },
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #f39c12;">📋 New Application</h2>
          <p><strong>Application ID:</strong> ${application.applicationId}</p>
          <p><strong>Name:</strong> ${application.firstName} ${application.lastName}</p>
          <p><strong>Email:</strong> ${application.email}</p>
          <p><strong>Phone:</strong> ${application.phoneNumber}</p>
          <p><strong>Plan:</strong> ${resolvedPlan?.name || "N/A"}</p>
          <p><strong>Monthly Price:</strong> ₱${safeToFixed(resolvedPlan?.price ?? 0)}</p>
          <p><strong>Brand:</strong> ${brand.brandName}</p>
          <p><strong>Building:</strong> ${buildingName || "N/A"}</p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
      </div>
    `;
    await this.sendToAdmin(
      `New Application: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      adminHtml,
      undefined,
      adminId,
    );
  }

  async sendApplicationApproved(
    application: any,
    plan: any,
    buildingNameFromController?: string,
    adminId?: string,
  ): Promise<void> {
    let resolvedPlan: any = null;

    if (isValidPlan(plan)) {
      resolvedPlan = plan;
    } else {
      console.log(
        `⚠️ sendApplicationApproved: Passed plan is INVALID - fetching from DB`,
      );
      resolvedPlan = await resolvePlanForApplication(application);
    }

    let buildingName =
      buildingNameFromController || application.buildingName || "";
    if (!buildingName && application.buildingId) {
      try {
        const building = await Building.findById(application.buildingId);
        if (building) buildingName = building.buildingName || "";
      } catch (e) {
        console.error("Error fetching building for email:", e);
      }
    }

    const brand = await getBrandForApplication({
      ...application,
      buildingName,
    });

    console.log(`📧 sendApplicationApproved - Plan resolved:`);
    console.log(`   Plan name: ${resolvedPlan?.name || "N/A"}`);
    console.log(`   Plan price: ${resolvedPlan?.price ?? 0}`);
    console.log(`   Brand: ${brand.brandName}`);
    console.log(`   isWilconnect: ${brand.isWilconnect}`);
    console.log(`   buildingName: "${buildingName}"`);
    console.log(
      `   adminId: ${adminId || "N/A (will use primary admin's toggle)"}`,
    );

    const html = this.generateApplicationApprovedHTML(
      application,
      resolvedPlan,
      brand,
    );

    await this.sendEmail(
      application.email,
      `✅ Application Approved - Create Your Account`,
      html,
      true,
      buildingName,
      {
        senderType: "admin",
        isWilconnect: brand.isWilconnect,
        buildingName: buildingName,
        adminId,
      },
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #28a745;">✅ Application Approved</h2>
          <p>You have approved application #${application.applicationId} for ${brand.brandName}.</p>
          <p><strong>Applicant:</strong> ${application.firstName} ${application.lastName}</p>
          <p><strong>Email:</strong> ${application.email}</p>
          <p><strong>Plan:</strong> ${resolvedPlan?.name || "N/A"}</p>
          <p>An email has been sent to the applicant with instructions to create their account.</p>
      </div>
    `;
    await this.sendToAdmin(
      `Application Approved: ${application.applicationId}`,
      adminHtml,
      undefined,
      adminId,
    );
  }

  async sendApplicationRejected(
    application: any,
    reason: string,
    buildingNameFromController?: string,
    adminId?: string,
  ): Promise<void> {
    let buildingName =
      buildingNameFromController || application.buildingName || "";
    if (!buildingName && application.buildingId) {
      try {
        const building = await Building.findById(application.buildingId);
        if (building) buildingName = building.buildingName || "";
      } catch (e) {
        console.error("Error fetching building for email:", e);
      }
    }

    const brand = await getBrandForApplication({
      ...application,
      buildingName,
    });

    const html = this.generateApplicationRejectedHTML(
      application,
      reason,
      brand,
    );

    await this.sendEmail(
      application.email,
      `Application Status Update`,
      html,
      true,
      buildingName,
      {
        senderType: "admin",
        isWilconnect: brand.isWilconnect,
        buildingName: buildingName,
        adminId,
      },
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #dc3545;">Application Rejected</h2>
          <p>Application #${application.applicationId} for ${brand.brandName} has been rejected.</p>
          <p><strong>Applicant:</strong> ${application.firstName} ${application.lastName}</p>
          <p><strong>Email:</strong> ${application.email}</p>
          <p><strong>Reason:</strong> ${reason || "Not specified"}</p>
      </div>
    `;
    await this.sendToAdmin(
      `Application Rejected: ${application.applicationId}`,
      adminHtml,
      undefined,
      adminId,
    );
  }

  async sendNewApplicationNotification(
    application: any,
    plan: any,
    adminId?: string,
  ): Promise<void> {
    let resolvedPlan: any = null;
    if (isValidPlan(plan)) {
      resolvedPlan = plan;
    } else {
      resolvedPlan = await resolvePlanForApplication(application);
    }

    const brand = await getBrandForApplication(application);

    const html = this.generateNewApplicationNotificationHTML(
      application,
      resolvedPlan,
      brand,
    );
    await this.sendToAdmin(
      `🆕 NEW APPLICATION: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      html,
      undefined,
      adminId,
    );
  }

  async sendPasswordChangeNotification(user: IUser): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Password Changed</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
              .header { text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; }
              .header h1 { color: #28a745; margin: 0; }
              .content { padding: 20px 0; }
              .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🔐 Password Changed</h1>
              </div>
              <div class="content">
                  <p>Dear ${user.firstName || user.email},</p>
                  <p>Your password has been changed successfully.</p>
                  <p>If you did not perform this action, please contact support immediately.</p>
              </div>
              <div class="footer">
                  <p>Mister Fyber - Your trusted internet provider</p>
                  <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
              </div>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      "Password Changed Successfully",
      html,
      true,
      undefined,
      { forceSend: true },
    );
  }

  async sendServiceStatusEmail(
    user: any,
    status: string,
    message: string,
    location?: string,
    adminId?: string,
  ): Promise<void> {
    const html = this.generateServiceStatusHTML(
      user.firstName || "",
      user.lastName || "",
      status,
      message,
    );
    await this.sendEmail(
      user.email,
      `Service ${status.charAt(0).toUpperCase() + status.slice(1)} - Mister Fyber`,
      html,
      true,
      location,
      { adminId },
    );
  }

  async sendServiceInterruption(
    user: any,
    reason: string,
    estimatedDuration?: Date,
    location?: string,
    adminId?: string,
  ): Promise<void> {
    const duration = estimatedDuration
      ? new Date(estimatedDuration).toLocaleString()
      : "Unknown";
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Service Interruption</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
              <h2 style="color: #dc3545;">⚠️ Service Interruption</h2>
              <p>Dear ${user.firstName || user.email},</p>
              <p>We want to inform you about a service interruption with Mister Fyber.</p>
              <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #dc3545;">
                  <p><strong>Reason:</strong> ${reason}</p>
                  <p><strong>Estimated Duration:</strong> ${duration}</p>
              </div>
              <p>We apologize for any inconvenience. Our team is working to restore service as soon as possible.</p>
              <hr>
              <p style="color: #666; font-size: 12px;">This is an automated notification from Mister Fyber.</p>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      "Service Interruption Notice",
      html,
      true,
      location,
      { adminId },
    );
  }

  async sendAccountStatusUpdate(
    user: any,
    location?: string,
    adminId?: string,
  ): Promise<void> {
    const statusMessages: Record<string, string> = {
      active:
        "Your Mister Fyber account has been activated! You can now log in and enjoy our services.",
      suspended:
        "Your Mister Fyber account has been suspended. Please contact support for assistance.",
      inactive:
        "Your Mister Fyber account is currently inactive. Please contact support for more information.",
      pending:
        "Your Mister Fyber account is still pending approval. We will notify you once verified.",
    };
    const message =
      statusMessages[user.status || "pending"] ||
      `Your Mister Fyber account status has been updated to: ${user.status}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Account Status Update</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
              <h2 style="color: #333;">🔄 Account Status Update</h2>
              <p>Hello ${user.firstName || user.email},</p>
              <div style="padding: 20px; background-color: #f8f9fa; border-left: 4px solid #007bff;">
                  <p>${message}</p>
              </div>
              <p>If you have any questions, please contact our support team.</p>
              <hr>
              <p style="color: #666; font-size: 12px;">Mister Fyber</p>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      `🔄 Account Status Update: ${user.status || "pending"}`,
      html,
      true,
      location,
      { adminId },
    );
  }

  async sendPlanChangeNotification(
    user: any,
    oldPlan: any,
    newPlan: any,
    location?: string,
    adminId?: string,
  ): Promise<void> {
    const html = this.generatePlanChangeNotificationHTML(
      user,
      oldPlan,
      newPlan,
    );
    await this.sendEmail(
      user.email,
      `📡 Plan Changed to ${newPlan?.name || "N/A"}`,
      html,
      true,
      location,
      { adminId },
    );
  }

  async sendServiceReminder(
    user: any,
    location?: string,
    adminId?: string,
  ): Promise<void> {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Weekly Service Update</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
              <h2 style="color: #333;">📊 Weekly Service Update</h2>
              <p>Hello ${user.firstName || user.email},</p>
              <p>Thank you for being a valued customer. Check your usage and billing status in your dashboard.</p>
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/dashboard" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Dashboard</a>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">Stay updated with your internet usage and billing.</p>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      "Weekly Service Update",
      html,
      true,
      location,
      { adminId },
    );
  }

  private generateWelcomeHTML(user: IUser): string {
    const loginUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/login`;
    const dashboardUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/dashboard`;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Mister Fyber</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; padding: 20px 0; border-bottom: 3px solid #28a745; background-color: #f8f9fa; border-radius: 10px 10px 0 0; }
            .header h1 { color: #28a745; margin: 0; font-size: 28px; }
            .content { padding: 30px 20px; }
            .details-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
            .button-container { text-align: center; margin: 30px 0; }
            .btn { display: inline-block; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 0 10px; }
            .btn-primary { background-color: #007bff; color: white; }
            .btn-success { background-color: #28a745; color: white; }
            .footer { text-align: center; padding: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; background-color: #f8f9fa; border-radius: 0 0 10px 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎉 Welcome Aboard!</h1>
                <p>Mister Fyber</p>
            </div>
            <div class="content">
                <p>Hello <strong>${user.firstName || user.email}</strong>!</p>
                <p>Thank you for choosing <strong>Mister Fyber</strong>. We're excited to have you on board!</p>
                <p>Your account has been successfully created and is now ready to use.</p>
                <div class="details-box">
                    <h3 style="margin-top: 0;">📋 Account Details</h3>
                    <p><strong>Username:</strong> ${user.username || user.email}</p>
                    <p><strong>Email:</strong> ${user.email}</p>
                    <p><strong>Full Name:</strong> ${user.firstName || ""} ${user.lastName || ""}</p>
                    <p><strong>Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
                    <p><strong>Status:</strong> ${(user.status || "pending").toUpperCase()}</p>
                </div>
                <div class="button-container">
                    <a href="${loginUrl}" class="btn btn-primary">🔐 Login to Account</a>
                    <a href="${dashboardUrl}" class="btn btn-success">📊 Go to Dashboard</a>
                </div>
                <p><strong>Note:</strong> Your billing will be started by our admin team. You will receive another email with your first invoice.</p>
            </div>
            <div class="footer">
                <p>This is an automated message from Mister Fyber.</p>
                <p>© ${new Date().getFullYear()} Mister Fyber. All rights reserved.</p>
                <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  private generatePasswordResetHTML(user: IUser, resetToken: string): string {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Password Reset Request</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>Hello ${user.firstName || user.email},</p>
            <p>You requested a password reset for your Mister Fyber account. Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
            </div>
            <p>Or copy and paste this link: ${resetUrl}</p>
            <p>This link will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Mister Fyber</p>
        </div>
    </body>
    </html>
    `;
  }

  private generateAccountCredentialsHTML(
    user: IUser,
    username: string,
    password: string,
    applicationId: string,
  ): string {
    const loginUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/login`;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Your Mister Fyber Account Credentials</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
            .header { text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 20px; }
            .header h1 { color: #007bff; margin: 0; }
            .content { padding: 20px 0; }
            .credentials { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔐 Your Account Credentials</h1>
            </div>
            <div class="content">
                <p>Hello ${user.firstName},</p>
                <p>Your Mister Fyber account has been set up by our admin team. Here are your login credentials:</p>
                <div class="credentials">
                    <h3 style="margin-top: 0;">📋 Login Information</h3>
                    <p><strong>Username:</strong> ${username}</p>
                    <p><strong>Password:</strong> ${password}</p>
                    <p><strong>Application ID:</strong> ${applicationId}</p>
                </div>
                <div class="warning">
                    <strong>⚠️ Important:</strong> Please change your password after your first login for security purposes.
                </div>
                <div style="text-align: center;">
                    <a href="${loginUrl}" class="button">🔑 Login to Your Account</a>
                </div>
            </div>
            <div class="footer">
                <p>Mister Fyber - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  private generateApplicationReceivedHTML(
    application: any,
    plan: any,
    brand: BrandInfo = getBrandForBuilding(),
  ): string {
    const planPrice = plan?.price ?? 0;
    const planName = plan?.name || "N/A";

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Application Received</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #28a745; text-align: center;">✅ Application Received!</h2>
            <p>Hello ${application.firstName},</p>
            <p>Thank you for applying for internet service with ${brand.brandName}. We have received your application and it is currently being reviewed.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Application Details:</h3>
                <p><strong>Application ID:</strong> ${application.applicationId}</p>
                <p><strong>Plan:</strong> ${planName}</p>
                <p><strong>Monthly Price:</strong> ₱${safeToFixed(planPrice)}</p>
                <p><strong>Status:</strong> <span style="color: #f39c12;">Pending Review</span></p>
            </div>
            <p>You will receive another email once your application has been reviewed.</p>
            <p>Please keep your Application ID for future reference.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">${brand.brandName}</p>
        </div>
    </body>
    </html>
    `;
  }

  private generateApplicationApprovedHTML(
    application: any,
    plan: any,
    brand: BrandInfo = getBrandForBuilding(),
  ): string {
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;
    const planPrice = plan?.price ?? 0;
    const planName = plan?.name || "N/A";

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Application Approved - Create Your Account</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
            .header { text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; }
            .header h1 { color: #28a745; margin: 0; }
            .content { padding: 20px 0; }
            .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✅ Application Approved!</h1>
            </div>
            <div class="content">
                <p>Hello ${application.firstName},</p>
                <p>Great news! Your application has been approved.</p>
                <div class="details">
                    <h3 style="margin-top: 0;">📋 Application Details</h3>
                    <p><strong>Application ID:</strong> ${application.applicationId}</p>
                    <p><strong>Plan:</strong> ${planName}</p>
                    <p><strong>Monthly Price:</strong> ₱${safeToFixed(planPrice)}</p>
                </div>
                <div style="text-align: center;">
                    <a href="${registerUrl}" class="button">🎯 Create Your Account Now</a>
                </div>
                <p><strong>What's next?</strong></p>
                <ol>
                    <li>Click the button above to create your account</li>
                    <li>Use your email address and create a password</li>
                    <li>Once registered, the admin will start your billing</li>
                    <li>You'll receive an invoice via email</li>
                </ol>
                ${application.adminNotes ? `<div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-left: 4px solid #007bff;"><p><strong>📝 Admin Notes:</strong><br>${application.adminNotes}</p></div>` : ""}
            </div>
            <div class="footer">
                <p>${brand.brandName} - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a></small></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  private generateApplicationRejectedHTML(
    application: any,
    reason: string,
    brand: BrandInfo = getBrandForBuilding(),
  ): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Application Update</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #dc3545;">Application Update</h2>
            <p>Hello ${application.firstName},</p>
            <p>Thank you for your interest in ${brand.brandName}. Unfortunately, your application has not been approved at this time.</p>
            <div style="margin-top: 20px; padding: 15px; background-color: #fff3f3; border-left: 4px solid #dc3545;">
                <p><strong>Reason:</strong></p>
                <p>${reason || "No specific reason provided"}</p>
            </div>
            <p>If you have any questions, please contact our support team.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">${brand.brandName}</p>
        </div>
    </body>
    </html>
    `;
  }

  private generateNewApplicationNotificationHTML(
    application: any,
    plan: any,
    brand: BrandInfo = getBrandForBuilding(),
  ): string {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
    const planPrice = plan?.price ?? 0;
    const planName = plan?.name || "N/A";

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #333;">🆕 NEW APPLICATION ALERT!</h2>
        <p>A new application has been submitted to ${brand.brandName} and requires your review.</p>
        <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
            <h3>Application Details:</h3>
            <p><strong>Application ID:</strong> ${application.applicationId}</p>
            <p><strong>Name:</strong> ${application.firstName} ${application.lastName}</p>
            <p><strong>Email:</strong> ${application.email}</p>
            <p><strong>Phone:</strong> ${application.phoneNumber}</p>
            <p><strong>Plan:</strong> ${planName} (₱${safeToFixed(planPrice)})</p>
            <p><strong>ID Type:</strong> ${application.idType}</p>
            <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 5px;">
            <h3>Address:</h3>
            <p>${application.buildingName || "N/A"}<br>
            ${application.floor ? `Floor: ${application.floor}` : ""} ${application.unitNumber ? `Unit: ${application.unitNumber}` : ""}<br>
            ${application.buildingId?.streetAddress || "N/A"}</p>
        </div>
        <div style="text-align: center; margin-top: 30px;">
            <a href="${frontendUrl}/admin/applications" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Review Application Now</a>
        </div>
    </div>
    `;
  }

  private generatePlanChangeNotificationHTML(
    user: any,
    oldPlan: any,
    newPlan: any,
  ): string {
    const newPlanPrice = newPlan?.price ?? 0;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Plan Updated</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #333;">📡 Plan Updated</h2>
            <p>Hello ${user.firstName || user.email},</p>
            <p>Your Mister Fyber plan has been changed successfully.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Old Plan:</strong> ${oldPlan?.name || "N/A"}</p>
                <p><strong>New Plan:</strong> ${newPlan?.name || "N/A"}</p>
                <p><strong>New Price:</strong> ₱${safeToFixed(newPlanPrice)}</p>
                <p><strong>New Speed:</strong> ${newPlan?.speed?.download || "N/A"} Mbps / ${newPlan?.speed?.upload || "N/A"} Mbps</p>
            </div>
            <p>The changes will take effect immediately.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Mister Fyber</p>
        </div>
    </body>
    </html>
    `;
  }

  private async sendToAdmin(
    subject: string,
    html: string,
    location?: string,
    adminId?: string,
  ): Promise<boolean> {
    if (!this.adminEmail) {
      console.error("❌ Admin email not configured");
      return false;
    }

    const customerEmailsEnabled = await this.areCustomerEmailsEnabled(adminId);
    if (!customerEmailsEnabled) {
      console.log(`⚠️ ========================================`);
      console.log(
        `⚠️ EMAIL NOTIFICATIONS ARE DISABLED (OFF). SKIPPING ADMIN EMAIL!`,
      );
      console.log(`⚠️ Admin ID: ${adminId || "using primary admin"}`);
      console.log(`⚠️ To: ${this.adminEmail}`);
      console.log(`⚠️ Subject: [ADMIN] ${subject}`);
      console.log(
        `⚠️ This admin email was NOT sent because the toggle is OFF.`,
      );
      console.log(`⚠️ ========================================`);
      return true;
    }

    return await this.sendEmail(
      this.adminEmail,
      `[ADMIN] ${subject}`,
      html,
      false,
      location,
      { adminId },
    );
  }

  async testEmailConfiguration(
    testEmail?: string,
  ): Promise<{ success: boolean; message: string; details?: any }> {
    const emailTo = testEmail || this.adminEmail;

    if (!emailTo) {
      return {
        success: false,
        message: "No test email address provided",
      };
    }

    if (!this.isConfigured()) {
      return {
        success: false,
        message: "Email service is not configured. Please check BREVO_API_KEY.",
        details: {
          apiKeyPresent: !!this.apiKey,
          apiKeyLength: this.apiKey?.length || 0,
          initialized: this.initialized,
        },
      };
    }

    const locationTestResults = {
      breeze: getCollectionEmailByLocation("breeze"),
      sil: getCollectionEmailByLocation("sil"),
      unknown: getCollectionEmailByLocation("unknown"),
      default: DEFAULT_COLLECTION_EMAIL,
    };

    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Email</title>
      </head>
      <body>
        <h1>✅ Test Email</h1>
        <p>If you're reading this, your email configuration is working correctly!</p>
        <p>Sent at: ${new Date().toLocaleString()}</p>
        <hr>
        <h3>Wilconnect Buildings (use Wilconnect branding):</h3>
        <ul>
          <li><strong>El Pueblo</strong> → BDO 013448003711 / RANDY D MANZANARES AND ANGELA C TAPEL</li>
          <li><strong>Vitalez</strong> → BDO 013448003703 / RANDY MANZANARES AND ANGELA TAPEL</li>
          <li><strong>Newport</strong> → BDO 013448003703 / RANDY MANZANARES AND ANGELA TAPEL</li>
        </ul>
        <p><strong>✅ IMPORTANT: All Wilconnect buildings use <code>${ADDITIONAL_SENDER_EMAILS.workselpueblo}</code> as sender email AND as support/collection email in the footer.</strong></p>
        <hr>
        <h3>Location Email Configuration:</h3>
        <ul>
          <li><strong>Breeze:</strong> ${locationTestResults.breeze}</li>
          <li><strong>Sil:</strong> ${locationTestResults.sil}</li>
          <li><strong>Unknown:</strong> ${locationTestResults.unknown}</li>
          <li><strong>Default:</strong> ${locationTestResults.default}</li>
        </ul>
        <p><small>Collection emails will be BCC'd to the appropriate location email.</small></p>
        <hr>
        <h3>Additional Sender Emails:</h3>
        <ul>
          <li><strong>Workselpueblo (Wilconnect buildings):</strong> ${ADDITIONAL_SENDER_EMAILS.workselpueblo}</li>
          <li><strong>FB Silk Residence:</strong> ${ADDITIONAL_SENDER_EMAILS.fbsilkresidence}</li>
        </ul>
        <hr>
        <h3>Configuration Details:</h3>
        <ul>
          <li><strong>API Key Present:</strong> ${!!this.apiKey}</li>
          <li><strong>API Key Length:</strong> ${this.apiKey?.length || 0}</li>
          <li><strong>Environment:</strong> ${process.env.NODE_ENV}</li>
          <li><strong>Admin Email:</strong> ${this.adminEmail}</li>
        </ul>
      </body>
      </html>
    `;

    try {
      const result = await this.sendEmail(
        emailTo,
        "Test Email - Mister Fyber",
        testHtml,
        false,
        undefined,
        { forceSend: true },
      );
      return {
        success: result,
        message: result
          ? "Test email sent successfully"
          : "Failed to send test email",
        details: {
          locationEmails: locationTestResults,
          additionalSenders: ADDITIONAL_SENDER_EMAILS,
          isConfigured: this.isConfigured(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Error: ${error.message}`,
        details: error,
      };
    }
  }
}

export const getLocationEmailMap = () => LOCATION_EMAIL_MAP;
export const getDefaultCollectionEmail = () => DEFAULT_COLLECTION_EMAIL;
export const getWilconnectBuildings = () => WILCONNECT_BUILDINGS;

const emailServiceInstance = new EmailService();

export default emailServiceInstance;
