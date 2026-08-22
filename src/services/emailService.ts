// backend/src/services/emailService.ts - COMPLETE FIXED VERSION WITH NO FORCE ENABLING
// REMOVED ADMIN NOTIFICATIONS FOR NEW CUSTOMER REGISTRATION AND WELCOME EMAILS

import { IUser } from "../models/User";
import Admin from "../models/Admin";
import Building from "../models/Building";
import Application from "../models/Application";
import Invoice from "../models/Invoice";
import Payment from "../models/Payment";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { generateInvoicePDF } from "./pdfService";

// Load environment variables
const envPath = path.resolve(process.cwd(), ".env");
console.log("📁 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error("❌ Failed to load .env file:", result.error);
} else {
  console.log("✅ .env file loaded successfully");
}

// Log environment variables status
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

const safeToFixed = (value: any, decimals: number = 2): string => {
  if (value === undefined || value === null || isNaN(Number(value))) {
    return "0.00";
  }
  return Number(value).toFixed(decimals);
};

// ==================== LOCATION EMAIL MAPPING ====================
const LOCATION_EMAIL_MAP: { [key: string]: string } = {
  breeze:
    process.env.COLLECTION_EMAIL_BREEZE || "collection.breeze@misterfyber.com",
  sil: process.env.COLLECTION_EMAIL_SIL || "collection.silk@misterfyber.com",
};

const DEFAULT_COLLECTION_EMAIL =
  process.env.COLLECTION_EMAIL_DEFAULT || "admin@misterfyber.com";

/**
 * Get collection email based on location
 */
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

/**
 * Get location from entity
 */
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

/**
 * Get building installation fee
 */
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

/**
 * Get building name from application
 */
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

/**
 * Get collection email for a user
 */
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

/**
 * Get collection email for an application
 */
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

class EmailService {
  private apiKey: string;
  private initialized: boolean = false;
  private adminEmail: string;
  private supportEmail: string;
  private emailFrom: string;
  private brevoApiUrl: string = "https://api.brevo.com/v3/smtp/email";

  constructor() {
    this.adminEmail = process.env.ADMIN_EMAIL || "admin@misterfyber.com";
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

  // ==================== HTML EMAIL TEMPLATE GENERATORS ====================

  /**
   * Generate payment confirmation HTML with full invoice details and PDF attachment note
   * INCLUDES BUILDING INSTALLATION FEE INFORMATION
   */
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
            <p>Mister Fyber</p>
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
                ${collectionEmail ? `<p><strong>Collection Email:</strong> <a href="mailto:${collectionEmail}">${collectionEmail}</a></p>` : ""}
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

            <p>Thank you for choosing Mister Fyber as your trusted internet provider.</p>
            <p><strong>Best regards,</strong><br>Mister Fyber Team</p>
        </div>
        <div class="footer">
            <p>Mister Fyber - Your trusted internet provider</p>
            <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
            ${collectionEmail ? `<p><small>Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>` : ""}
            <p><small>This is a computer-generated receipt. No signature required.</small></p>
        </div>
    </div>
</body>
</html>
    `;
  }

  /**
   * Generate invoice HTML with installation fee information
   */
  generateInvoiceHTML(
    user: any,
    billing: any,
    location: string,
    buildingName?: string,
    buildingInstallationFee?: number,
  ): string {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.total || billing.amount || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

    const collectionEmail = getCollectionEmailByLocation(location);

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

    let senderName = "Mister Fyber";
    let senderEmailAddress = "admin@misterfyber.com";
    if (location) {
      const collectionEmailForLocation = getCollectionEmailByLocation(location);
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
      }
    }

    // Build items table
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
              <p>Your Mister Fyber invoice is now ready for payment.</p>
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
                  <p><strong>Collection Email:</strong> ${collectionEmail}</p>
              </div>
              ${itemsTable}
              ${installationFeeInfo}
              ${additionalInfo}
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View & Pay Invoice</a>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">Mister Fyber</p>
              <p style="color: #666; font-size: 12px;">Sent from: ${senderName} (${senderEmailAddress})</p>
          </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate payment reminder HTML with installation fee info
   */
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
            <p>This is a friendly reminder that your Mister Fyber payment is due soon.</p>
            ${locationBadge}
            ${buildingInfo}
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                <p><strong>Due Date:</strong> ${dueDate}</p>
                ${reminderMessage}
                ${installationFeeInfo}
                ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                ${collectionEmail ? `<p><strong>Collection Email:</strong> ${collectionEmail}</p>` : ""}
                ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
            </div>
     
            <p>Please pay before the due date to avoid service interruption.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
            ${collectionEmail ? `<p style="color: #666; font-size: 12px;">Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></p>` : ""}
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Generate due date reminder HTML with installation fee info
   */
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

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>⚠️ PAYMENT DUE TODAY - Mister Fyber</title>
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
                <p><strong>Your Mister Fyber payment is due TODAY.</strong> Please settle your bill immediately to avoid service interruption.</p>
                ${locationBadge}
                ${buildingInfo}
                <div class="bill-details">
                    <h3 style="margin-top: 0;">📋 Invoice Details</h3>
                    <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                    <p><strong>Amount Due:</strong> <span style="color: #dc3545; font-size: 18px;">₱${safeToFixed(amount)}</span></p>
                    <p><strong>Due Date:</strong> <span style="color: #dc3545; font-weight: bold;">${dueDate} (TODAY)</span></p>
                    ${isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
                    ${isInstallationBill ? `<p><strong>Bill Type:</strong> Installation Fee</p>` : ""}
                    ${installationFeeInfo}
                    ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                    ${collectionEmail ? `<p><strong>Collection Email:</strong> ${collectionEmail}</p>` : ""}
                    ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                </div>
                ${reminderMessage}
                <div class="warning">
                    <strong>📌 After Today:</strong> If payment is not received, your account will enter a grace period. After the grace period, your service will be suspended.
                </div>
              
                <p><strong>Payment Methods Accepted:</strong> GCash, Maya, Bank Transfer, Over-the-Counter</p>
                <p>If you have already made the payment, please disregard this notice.</p>
            </div>
            <div class="footer">
                <p>Mister Fyber - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
                ${collectionEmail ? `<p><small>Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>` : ""}
                <p><small>Late payments may incur service interruption after grace period.</small></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Generate bill without account HTML with installation fee info
   */
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
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;
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

    const installationFeeInfo =
      bill.isInstallationBill && buildingInstallationFee
        ? `
      <div style="margin-top: 15px; padding: 10px; background-color: #fff3e0; border-radius: 5px; border-left: 4px solid #ff9800;">
        <p style="margin: 0; font-size: 12px; color: #e65100;">
          <strong>🔧 Installation Fee:</strong> ₱${buildingInstallationFee.toLocaleString()} (One-time charge for ${buildingName || "your building"})
        </p>
      </div>
      `
        : "";

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Your Mister Fyber Bill is Ready</title>
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
                <p>Your Mister Fyber bill is now ready. Since you haven't created your account yet, please register first using your Application ID.</p>
                ${locationBadge}
                ${buildingInfo}
                <div class="bill-details">
                    <h3 style="margin-top: 0;">📋 Bill Details</h3>
                    <p><strong>Invoice Number:</strong> ${bill.invoiceNumber}</p>
                    <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Due Date:</strong> ${dueDate}</p>
                    <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
                    ${bill.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
                    ${bill.isInstallationBill ? `<p><strong>Bill Type:</strong> Installation Fee</p>` : ""}
                    ${!bill.isProRated && !bill.isInstallationBill ? `<p><strong>Bill Type:</strong> Monthly Subscription</p>` : ""}
                    ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                    ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                    ${collectionEmail ? `<p><strong>Collection Email:</strong> ${collectionEmail}</p>` : ""}
                </div>
                ${installationFeeInfo}
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
                <p>Mister Fyber - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
                ${collectionEmail ? `<p><small>Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>` : ""}
            </div>
        </div>
    </body>
    </html>
    `;
  }

  // ==================== TEST EMAIL ====================
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
        <p style="color: #6b7280; font-size: 14px;">This is an automated test email from Mister Fyber billing system.</p>
      </body>
      </html>
    `;
  }

  /**
   * Generate service status HTML (for pause/resume notifications)
   */
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
        <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
      </div>
    `;
  }

  // ==================== CONFIGURATION CHECK ====================
  isConfigured(): boolean {
    const configured =
      this.initialized && !!this.apiKey && this.apiKey.length > 10;
    console.log(
      `📧 isConfigured() called: ${configured} (initialized: ${this.initialized}, apiKey: ${!!this.apiKey}, length: ${this.apiKey?.length || 0})`,
    );
    return configured;
  }

  // ==================== FIXED: CUSTOMER EMAIL ENABLED CHECK ====================
  /**
   * FIXED: Check if customer emails are enabled
   * Returns TRUE if enabled, FALSE if disabled (OFF)
   * NO FORCE ENABLING - respects the database value
   */
  private async areCustomerEmailsEnabled(): Promise<boolean> {
    try {
      // Find the admin (super_admin has highest priority)
      const admin = await Admin.findOne({
        role: { $in: ["super_admin", "admin"] },
        status: "active",
      }).sort({ role: 1 });

      // CRITICAL FIX: If admin found, use their EXACT value
      // If customerEmailAlertsEnabled is undefined, default to true (enabled)
      // If it's false, respect it as DISABLED
      if (admin) {
        const enabled = admin.customerEmailAlertsEnabled !== false;
        console.log(`📧 Customer emails enabled: ${enabled}`);
        console.log(
          `   customerEmailAlertsEnabled value: ${admin.customerEmailAlertsEnabled}`,
        );
        return enabled;
      }

      // If no admin found, default to true
      console.log("📧 No admin found, defaulting to enabled");
      return true;
    } catch (error) {
      console.warn(
        "⚠️ Could not check customer email setting, defaulting to true:",
        error,
      );
      return true;
    }
  }

  // ==================== HELPER: FORMAT DATE ====================
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

  /**
   * Get available sender options for a specific location
   */
  getSenderOptions(location?: string): { value: string; label: string }[] {
    const options = [];
    options.push({
      value: "admin",
      label: "Admin (admin@misterfyber.com)",
    });
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
    return options;
  }

  // ==================== CORE EMAIL SENDING ====================
  /**
   * FIXED: sendEmail now properly checks customer email toggle
   * and respects the OFF setting
   */
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
    },
  ): Promise<boolean> {
    try {
      console.log(`📧 sendEmail called: to=${to}, subject=${subject}`);
      console.log(
        `   isCustomerEmail: ${isCustomerEmail}, location: ${location || "none"}`,
      );
      console.log(
        `   useAdminSender: ${options?.useAdminSender ? "YES" : "NO"}`,
      );

      // ============================================================
      // FIXED: Check if customer emails are enabled
      // If this is a customer email and emails are disabled, SKIP sending
      // ============================================================
      if (isCustomerEmail) {
        const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
        if (!customerEmailsEnabled) {
          console.log(
            `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). Skipping email to: ${to}`,
          );
          console.log(`   Subject: ${subject}`);
          console.log(`   This email was NOT sent because the toggle is OFF.`);
          // Return true to indicate "success" so the caller doesn't retry
          return true;
        }
        console.log(`✅ Customer emails are ENABLED. Sending email to: ${to}`);
      }

      if (process.env.NODE_ENV === "development" && !this.apiKey) {
        console.log(`📧 [DEV MODE] Would send email to: ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   Content preview: ${htmlContent.substring(0, 200)}...`);
        console.log(
          `   Use Admin Sender: ${options?.useAdminSender ? "YES" : "NO"}`,
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

      let collectionEmail = DEFAULT_COLLECTION_EMAIL;
      if (location) {
        collectionEmail = getCollectionEmailByLocation(location);
        console.log(
          `📍 Collection email for location "${location}": ${collectionEmail}`,
        );
      } else {
        console.log(
          `⚠️ No location provided, using default collection email: ${collectionEmail}`,
        );
      }

      let senderName = "Mister Fyber";
      let senderEmailAddress = senderEmail;

      if (options?.useAdminSender) {
        senderEmailAddress = "admin@misterfyber.com";
        senderName = "Mister Fyber Admin";
        console.log(`📧 Using admin email as sender: ${senderEmailAddress}`);
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

      // NOTE: Admin email BCC is intentionally removed for customer welcome emails
      // Admin will still receive notifications for other important emails

      console.log(
        `📧 Sending email via Brevo API to ${validToArray.join(", ")}...`,
      );
      console.log(`   Subject: ${subject}`);
      console.log(`   Sender: ${senderName} <${senderEmailAddress}>`);
      console.log(`   Location: ${location || "Not specified"}`);
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
      console.log(
        "📧 Attachments:",
        requestBody.attachment
          ? `${requestBody.attachment.length} file(s)`
          : "None",
      );

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
          } catch {
            // Ignore parse error
          }
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

  // ==================== EMAIL SENDING METHODS ====================

  /**
   * Send invoice with PDF attachment - INCLUDES BUILDING INSTALLATION FEE
   * FIXED: Respects customer email toggle
   */
  async sendInvoiceWithPDF(
    invoiceData: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    location?: string,
    useAdminSender?: boolean,
  ): Promise<boolean> {
    try {
      // ============================================================
      // FIXED: Check if customer emails are enabled
      // If emails are disabled, SKIP sending
      // ============================================================
      const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
      if (!customerEmailsEnabled) {
        console.log(
          `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). Skipping invoice email to: ${invoiceData.customerEmail}`,
        );
        console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
        console.log(`   This email was NOT sent because the toggle is OFF.`);
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
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      // Get building information if available
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

      let senderName = "Mister Fyber";
      let senderEmailAddress = "admin@misterfyber.com";

      if (useAdminSender) {
        senderEmailAddress = "admin@misterfyber.com";
        senderName = "Mister Fyber Admin";
        console.log(`📧 Using admin email as sender: ${senderEmailAddress}`);
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

      // Convert PDF to base64
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

      const senderBadge = useAdminSender
        ? `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> Admin (admin@misterfyber.com)
        </div>
      `
        : `
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
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #1a237e;">Payment Method (Bank Transfer):</h4>
            <p><strong>Bank Name:</strong> ${invoiceData.bankName}</p>
            <p><strong>Account Name:</strong> ${invoiceData.accountName}</p>
            <p><strong>Account Number:</strong> ${invoiceData.accountNumber}</p>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">
              Kindly send your proof of payment via Viber ${invoiceData.companyContact || "0969-341-4876"} or at ${collectionEmail} after completing the transaction.
            </p>
          </div>
        `;
      }

      // Build HTML with installation fee info
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Your Mister Fyber Invoice</title>
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
                    <h1>FYBERBLIZZ NETWORK CORPORATION</h1>
                    <p>UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA</p>
                    <p>VAT-REG.: 697-461-165-00000 | CONTACT NO.: 0969-341-4876</p>
                    <h2 style="color: #1a237e; margin-top: 15px;">MISTER FYBER</h2>
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
                    <p><strong>Best regards,</strong><br>Mister Fyber Admin</p>
                </div>
                <div class="footer">
                    <p>Mister Fyber - Your trusted internet provider</p>
                    <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
                    <p><small>This is a computer-generated invoice. No signature required.</small></p>
                    <p><small>Collection email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>
                    <p><small>Sent from: ${senderName} (${senderEmailAddress})</small></p>
                </div>
            </div>
        </body>
        </html>
      `;

      // Build the request with PDF attachment
      const requestBody = {
        sender: {
          name: senderName,
          email: senderEmailAddress,
        },
        to: [{ email: invoiceData.customerEmail.trim() }],
        subject: `🧾 Invoice #${invoiceData.invoiceNumber} - Mister Fyber`,
        htmlContent: html,
        bcc: [
          { email: collectionEmail.trim() },
          // Admin email removed from BCC for customer emails - only collection email gets BCC
        ],
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
        `📧 Subject: 🧾 Invoice #${invoiceData.invoiceNumber} - Mister Fyber`,
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

  /**
   * Send payment confirmation email with paid invoice attachment
   * FIXED: Respects customer email toggle
   */
  async sendPaymentConfirmationEmail(
    invoice: any,
    payment: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    location?: string,
    useAdminSender?: boolean,
    notes?: string,
    adminName?: string,
  ): Promise<boolean> {
    console.log(`📧 sendPaymentConfirmationEmail called`);

    try {
      // ============================================================
      // FIXED: Check if customer emails are enabled
      // If emails are disabled, SKIP sending
      // ============================================================
      const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
      if (!customerEmailsEnabled) {
        console.log(
          `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). Skipping payment confirmation email to: ${invoice.customerEmail}`,
        );
        console.log(`   Invoice: ${invoice.invoiceNumber}`);
        console.log(`   This email was NOT sent because the toggle is OFF.`);
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

      // Get building information
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
            bcc: [
              getCollectionEmailByLocation(location || ""),
              // Admin email removed from BCC for customer emails - only collection email gets BCC
            ],
            replyTo: getCollectionEmailByLocation(location || ""),
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

  /**
   * Send paid invoice email with PDF attachment
   * FIXED: Respects customer email toggle
   */
  async sendPaidInvoiceEmail(
    invoiceData: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    paymentData?: any,
    location?: string,
    useAdminSender?: boolean,
  ): Promise<boolean> {
    try {
      console.log(`📧 sendPaidInvoiceEmail called`);
      console.log(`📧 Invoice: ${invoiceData.invoiceNumber}`);
      console.log(`📧 Customer: ${invoiceData.customerEmail}`);
      console.log(`📧 Location: ${location || "Not specified"}`);
      console.log(`📧 Building: ${invoiceData.buildingName || "N/A"}`);
      console.log(
        `📧 Installation Fee: ${invoiceData.buildingInstallationFee || 0}`,
      );
      console.log(`📧 PDF size: ${pdfBuffer ? pdfBuffer.length : 0} bytes`);

      // ============================================================
      // FIXED: Check if customer emails are enabled
      // If emails are disabled, SKIP sending
      // ============================================================
      const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
      if (!customerEmailsEnabled) {
        console.log(
          `⚠️ CUSTOMER EMAILS ARE DISABLED (OFF). Skipping paid invoice email to: ${invoiceData.customerEmail}`,
        );
        console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
        console.log(`   This email was NOT sent because the toggle is OFF.`);
        return true;
      }
      console.log(
        `✅ Customer emails are ENABLED. Sending paid invoice to: ${invoiceData.customerEmail}`,
      );

      let finalPdfBuffer = pdfBuffer;
      let finalPdfFileName = pdfFileName;

      if (!finalPdfBuffer || finalPdfBuffer.length === 0) {
        console.log(
          `📧 PDF buffer is empty, generating PDF for invoice: ${invoiceData.invoiceNumber}`,
        );
        try {
          finalPdfBuffer = await generateInvoicePDF(invoiceData);
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
          `✅ Payment Confirmed - ${invoiceData.invoiceNumber}`,
          htmlContent,
          true,
          location,
          {
            bcc: [
              getCollectionEmailByLocation(location || ""),
              // Admin email removed from BCC for customer emails - only collection email gets BCC
            ],
            replyTo: getCollectionEmailByLocation(location || ""),
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
          `⚠️ Email service not initialized - skipping paid invoice to ${invoiceData.customerEmail}`,
        );
        if (process.env.NODE_ENV === "development") {
          console.log(
            `📧 [DEV MODE] Would send paid invoice to: ${invoiceData.customerEmail}`,
          );
          console.log(`   Invoice: ${invoiceData.invoiceNumber}`);
          return true;
        }
        return false;
      }

      const userLocation = location || invoiceData.location || "";
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      let senderName = "Mister Fyber";
      let senderEmailAddress = "admin@misterfyber.com";

      if (useAdminSender) {
        senderEmailAddress = "admin@misterfyber.com";
        senderName = "Mister Fyber Admin";
        console.log(`📧 Using admin email as sender: ${senderEmailAddress}`);
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
      const amount = invoiceData.total || 0;
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

      // Build items table
      let itemsHtml = "";
      if (invoiceData.items && invoiceData.items.length > 0) {
        itemsHtml = `<table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px;">
          <thead>
            <tr style="background-color: #28a745; color: white;">
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

        itemsHtml += `<tr style="font-weight: bold; background-color: #28a745; color: white;">
          <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid #28a745;">TOTAL PAID:</td>
          <td style="padding: 12px; text-align: right; border: 1px solid #28a745;">₱${safeToFixed(amount)}</td>
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

      const senderBadge = useAdminSender
        ? `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
          <strong>📧 Sent from:</strong> Admin (admin@misterfyber.com)
        </div>
      `
        : `
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
      if (isInstallationFee) {
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

      // Build complete HTML with installation fee info
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Payment Confirmation - ${invoiceData.invoiceNumber}</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #28a745; border-radius: 10px; }
                .header { text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; }
                .header h1 { color: #28a745; margin: 0; font-size: 28px; }
                .header p { color: #666; margin: 5px 0; }
                .content { padding: 20px 0; }
                .paid-badge { display: inline-block; background: #28a745; color: white; padding: 6px 20px; border-radius: 20px; font-weight: bold; font-size: 14px; }
                .bill-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .button { display: inline-block; background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
                .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
                .company-info { text-align: center; font-size: 12px; color: #666; margin: 10px 0; }
                .invoice-type { display: inline-block; background: #28a745; color: white; padding: 3px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; }
                .sender-info { background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center; }
                .payment-details { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #28a745; }
                .attachments-note { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #1a56db; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>✅ PAYMENT CONFIRMED!</h1>
                    <p>MISTER FYBER</p>
                    <p>FYBERBLIZZ NETWORK CORPORATION</p>
                    <p>UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA</p>
                    <p>VAT-REG.: 697-461-165-00000 | CONTACT NO.: 0969-341-4876</p>
                    <div style="margin: 15px 0;">
                        <span class="paid-badge">✅ PAID</span>
                    </div>
                    <p><span class="invoice-type">${invoiceData.invoiceType || "Monthly"} - PAID</span></p>
                    ${locationBadge}
                    ${buildingInfo}
                    ${senderBadge}
                </div>
                <div class="content">
                    <p><strong>Dear ${invoiceData.customerName || "Customer"},</strong></p>
                    <p>We are pleased to confirm that your payment has been received and processed successfully.</p>
                    
                    <div class="payment-details">
                        <h4 style="margin-top: 0; color: #28a745;">💰 Payment Details</h4>
                        <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                        <p><strong>Amount Paid:</strong> <span style="color: #28a745; font-size: 20px; font-weight: bold;">₱${safeToFixed(amount)}</span></p>
                        <p><strong>Payment Date:</strong> ${paidAt}</p>
                        <p><strong>Reference Number:</strong> ${referenceNumber}</p>
                        <p><strong>Invoice Type:</strong> ${invoiceData.invoiceType || "Monthly"}</p>
                        ${isInstallationFee ? `<p><strong>Note:</strong> Installation Fee Payment for ${buildingName || "your building"}</p>` : ""}
                        ${isProRated ? `<p><strong>Note:</strong> Pro-rated First Bill</p>` : ""}
                        ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                        ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                        ${buildingInstallationFee ? `<p><strong>Installation Fee:</strong> ₱${buildingInstallationFee.toFixed(2)}</p>` : ""}
                    </div>

                    ${collectionBCCNote}
                    ${installationFeeInfo}
                    ${itemsHtml}
                    ${additionalInfo}

                    <div class="attachments-note">
                        <p style="margin: 0; color: #1a56db;">
                            <strong>📎 Invoice PDF Attached:</strong> A copy of your paid invoice (${invoiceData.invoiceNumber}) is attached to this email for your records.
                        </p>
                    </div>

                    ${invoiceData.notes ? `<div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;"><p><strong>Notes:</strong><br>${invoiceData.notes}</p></div>` : ""}
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/invoices" class="button">📄 View All Invoices</a>
                    </div>
                    
                    <p>Thank you for choosing Mister Fyber as your trusted internet provider.</p>
                    <p><strong>Best regards,</strong><br>Mister Fyber Team</p>
                </div>
                <div class="footer">
                    <p>Mister Fyber - Your trusted internet provider</p>
                    <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
                    <p><small>This is a computer-generated receipt. No signature required.</small></p>
                    <p><small>Collection email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>
                    <p><small>Sent from: ${senderName} (${senderEmailAddress})</small></p>
                    <p><small>Payment Date: ${paidAt}</small></p>
                </div>
            </div>
        </body>
        </html>
      `;

      const cleanBase64ForRequest = cleanBase64;

      const requestBody = {
        sender: {
          name: senderName,
          email: senderEmailAddress,
        },
        to: [{ email: invoiceData.customerEmail.trim() }],
        subject: `✅ Payment Confirmed - ${invoiceData.invoiceNumber}`,
        htmlContent: html,
        bcc: [
          { email: collectionEmail.trim() },
          // Admin email removed from BCC for customer emails - only collection email gets BCC
        ],
        replyTo: { email: collectionEmail },
        attachment: [
          {
            name: finalPdfFileName,
            content: cleanBase64ForRequest,
          },
        ],
      };

      console.log(`📧 Sending paid invoice email via Brevo API...`);
      console.log(`📧 To: ${invoiceData.customerEmail}`);
      console.log(
        `📧 Subject: ✅ Payment Confirmed - ${invoiceData.invoiceNumber}`,
      );
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
            `✅ Paid invoice email sent successfully to ${invoiceData.customerEmail}`,
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
            `❌ Failed to send paid invoice email: ${response.status} - ${errorText}`,
          );
          console.error(`❌ ========================================`);
          return false;
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        console.error(
          `❌ Error sending paid invoice email:`,
          fetchError.message,
        );
        console.error(`❌ ========================================`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error sending paid invoice email:`, error);
      console.error(`❌ ========================================`);
      return false;
    }
  }

  // ==================== SIMPLE EMAIL METHODS ====================

  async sendBillingEmail(
    user: IUser | any,
    billing: any,
    location?: string,
    options?: {
      cc?: string | string[];
      attachments?: any[];
      replyTo?: string;
      useAdminSender?: boolean;
    },
  ): Promise<boolean> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      // Get building info
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

      const subject = `🧾 Invoice #${billing.invoiceNumber || billing._id} - Mister Fyber`;
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
          replyTo: options?.replyTo || collectionEmail,
          bcc: [collectionEmail],
          useAdminSender: options?.useAdminSender || false,
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
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      await this.sendBillingEmail(user, billing, userLocation, {
        useAdminSender,
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
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      // Get building info
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
        collectionEmail,
        billing.isInstallationBill || false,
        billing.isProRated || false,
        buildingName,
        buildingInstallationFee,
      );

      await this.sendEmail(
        user.email,
        `⚠️ Payment Reminder - Due ${dueDate}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: collectionEmail,
          useAdminSender: useAdminSender || false,
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
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      // Get building info
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
        collectionEmail,
        billing.isInstallationBill || false,
        billing.isProRated || false,
        buildingName,
        buildingInstallationFee,
      );

      await this.sendEmail(
        user.email,
        `⚠️ PAYMENT DUE TODAY - ${billing.invoiceNumber || billing._id}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: collectionEmail,
          useAdminSender: useAdminSender || false,
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
    location?: string,
    useAdminSender?: boolean,
  ): Promise<void> {
    try {
      const userLocation =
        location || (await getLocationFromEntity(application));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      // Get building info
      let buildingName = application.buildingName || "";
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
        collectionEmail,
        buildingName,
        buildingInstallationFee,
      );

      await this.sendEmail(
        application.email,
        `🧾 Your Bill is Ready - ${bill.invoiceNumber}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: collectionEmail,
          useAdminSender: useAdminSender || false,
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
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      // Get building info
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
                <p>Your Mister Fyber bill is due on ${dueDate}.</p>
                ${locationBadge}
                ${buildingInfo}
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Due Date:</strong> ${dueDate}</p>
                    ${installationFeeInfo}
                    ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                    ${buildingName ? `<p><strong>Building:</strong> ${buildingName}</p>` : ""}
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Bill</a>
                </div>
                <hr>
                <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
                ${collectionEmail ? `<p style="color: #666; font-size: 12px;">Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></p>` : ""}
            </div>
        </body>
        </html>
      `;

      await this.sendEmail(
        user.email,
        `📅 Billing Reminder - Due ${dueDate}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: collectionEmail,
          useAdminSender: useAdminSender || false,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending billing reminder:`, error);
    }
  }

  // ==================== OTHER EMAIL METHODS ====================

  async sendWelcomeEmail(user: IUser): Promise<void> {
    const html = this.generateWelcomeHTML(user);
    await this.sendEmail(
      user.email,
      `🎉 Welcome to Mister Fyber, ${user.firstName || user.email}!`,
      html,
      true,
    );

    // REMOVED: Admin notification for welcome email - no longer sending admin email
    console.log(
      `📧 Welcome email sent to ${user.email} - Admin notification skipped`,
    );
  }

  async sendPasswordReset(user: IUser, resetToken: string): Promise<void> {
    const html = this.generatePasswordResetHTML(user, resetToken);
    await this.sendEmail(user.email, "Password Reset Request", html, true);
  }

  async sendAccountCredentials(
    user: IUser,
    username: string,
    password: string,
    applicationId: string,
  ): Promise<void> {
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
    );
  }

  async sendApplicationReceived(application: any, plan: any): Promise<void> {
    const html = this.generateApplicationReceivedHTML(application, plan);
    await this.sendEmail(
      application.email,
      `Application Received - ${application.applicationId}`,
      html,
      true,
    );

    // Keep admin notification for application received
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #f39c12;">📋 New Application</h2>
          <p><strong>Application ID:</strong> ${application.applicationId}</p>
          <p><strong>Name:</strong> ${application.firstName} ${application.lastName}</p>
          <p><strong>Email:</strong> ${application.email}</p>
          <p><strong>Phone:</strong> ${application.phoneNumber}</p>
          <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
      </div>
    `;
    await this.sendToAdmin(
      `New Application: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      adminHtml,
    );
  }

  async sendApplicationApproved(application: any, plan: any): Promise<void> {
    const html = this.generateApplicationApprovedHTML(application, plan);
    await this.sendEmail(
      application.email,
      `✅ Application Approved - Create Your Account`,
      html,
      true,
    );

    // Keep admin notification for application approved
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #28a745;">✅ Application Approved</h2>
          <p>You have approved application #${application.applicationId} for Mister Fyber.</p>
          <p><strong>Applicant:</strong> ${application.firstName} ${application.lastName}</p>
          <p><strong>Email:</strong> ${application.email}</p>
          <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
          <p>An email has been sent to the applicant with instructions to create their account.</p>
      </div>
    `;
    await this.sendToAdmin(
      `Application Approved: ${application.applicationId}`,
      adminHtml,
    );
  }

  async sendApplicationRejected(
    application: any,
    reason: string,
  ): Promise<void> {
    const html = this.generateApplicationRejectedHTML(application, reason);
    await this.sendEmail(
      application.email,
      `Application Status Update`,
      html,
      true,
    );

    // Keep admin notification for application rejected
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #dc3545;">Application Rejected</h2>
          <p>Application #${application.applicationId} for Mister Fyber has been rejected.</p>
          <p><strong>Applicant:</strong> ${application.firstName} ${application.lastName}</p>
          <p><strong>Email:</strong> ${application.email}</p>
          <p><strong>Reason:</strong> ${reason || "Not specified"}</p>
      </div>
    `;
    await this.sendToAdmin(
      `Application Rejected: ${application.applicationId}`,
      adminHtml,
    );
  }

  async sendNewApplicationNotification(
    application: any,
    plan: any,
  ): Promise<void> {
    const html = this.generateNewApplicationNotificationHTML(application, plan);
    await this.sendToAdmin(
      `🆕 NEW APPLICATION: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      html,
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
    );
  }

  // ==================== SERVICE STATUS EMAIL ====================
  async sendServiceStatusEmail(
    user: any,
    status: string,
    message: string,
    location?: string,
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
    );
  }

  // ==================== SERVICE INTERRUPTION ====================
  async sendServiceInterruption(
    user: any,
    reason: string,
    estimatedDuration?: Date,
    location?: string,
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
    );
  }

  // ==================== ACCOUNT STATUS UPDATE ====================
  async sendAccountStatusUpdate(user: any, location?: string): Promise<void> {
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
    );
  }

  // ==================== PLAN CHANGE NOTIFICATION ====================
  async sendPlanChangeNotification(
    user: any,
    oldPlan: any,
    newPlan: any,
    location?: string,
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
    );
  }

  // ==================== SERVICE REMINDER ====================
  async sendServiceReminder(user: any, location?: string): Promise<void> {
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
              <p>Thank you for being a valued Mister Fyber customer. Check your usage and billing status in your dashboard.</p>
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/dashboard" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Dashboard</a>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">Stay updated with your internet usage and billing with Mister Fyber.</p>
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
    );
  }

  // ==================== HELPER GENERATORS ====================
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

  private generateApplicationReceivedHTML(application: any, plan: any): string {
    const planPrice = plan?.price ?? 0;

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
            <p>Thank you for applying for internet service with Mister Fyber. We have received your application and it is currently being reviewed.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Application Details:</h3>
                <p><strong>Application ID:</strong> ${application.applicationId}</p>
                <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
                <p><strong>Monthly Price:</strong> ₱${safeToFixed(planPrice)}</p>
                <p><strong>Status:</strong> <span style="color: #f39c12;">Pending Review</span></p>
            </div>
            <p>You will receive another email once your application has been reviewed.</p>
            <p>Please keep your Application ID for future reference.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Mister Fyber</p>
        </div>
    </body>
    </html>
    `;
  }

  private generateApplicationApprovedHTML(application: any, plan: any): string {
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;
    const planPrice = plan?.price ?? 0;

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
                <p>Great news! Your application to Mister Fyber has been approved.</p>
                <div class="details">
                    <h3 style="margin-top: 0;">📋 Application Details</h3>
                    <p><strong>Application ID:</strong> ${application.applicationId}</p>
                    <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
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
                <p>Mister Fyber - Your trusted internet provider</p>
                <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  private generateApplicationRejectedHTML(
    application: any,
    reason: string,
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
            <p>Thank you for your interest in Mister Fyber. Unfortunately, your application has not been approved at this time.</p>
            <div style="margin-top: 20px; padding: 15px; background-color: #fff3f3; border-left: 4px solid #dc3545;">
                <p><strong>Reason:</strong></p>
                <p>${reason || "No specific reason provided"}</p>
            </div>
            <p>If you have any questions, please contact our support team.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Mister Fyber</p>
        </div>
    </body>
    </html>
    `;
  }

  private generateNewApplicationNotificationHTML(
    application: any,
    plan: any,
  ): string {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
    const planPrice = plan?.price ?? 0;

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #333;">🆕 NEW APPLICATION ALERT!</h2>
        <p>A new application has been submitted to Mister Fyber and requires your review.</p>
        <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
            <h3>Application Details:</h3>
            <p><strong>Application ID:</strong> ${application.applicationId}</p>
            <p><strong>Name:</strong> ${application.firstName} ${application.lastName}</p>
            <p><strong>Email:</strong> ${application.email}</p>
            <p><strong>Phone:</strong> ${application.phoneNumber}</p>
            <p><strong>Plan:</strong> ${plan?.name || "N/A"} (₱${safeToFixed(planPrice)})</p>
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
  ): Promise<boolean> {
    if (!this.adminEmail) {
      console.error("❌ Admin email not configured");
      return false;
    }
    return await this.sendEmail(
      this.adminEmail,
      `[ADMIN] ${subject}`,
      html,
      false,
      location,
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
        <title>Test Email - Mister Fyber</title>
      </head>
      <body>
        <h1>✅ Test Email from Mister Fyber</h1>
        <p>If you're reading this, your email configuration is working correctly!</p>
        <p>Sent at: ${new Date().toLocaleString()}</p>
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
      );
      return {
        success: result,
        message: result
          ? "Test email sent successfully"
          : "Failed to send test email",
        details: {
          locationEmails: locationTestResults,
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

// ==================== EXPORT FUNCTIONS ====================
export const getLocationEmailMap = () => LOCATION_EMAIL_MAP;
export const getDefaultCollectionEmail = () => DEFAULT_COLLECTION_EMAIL;

// Create a singleton instance
const emailServiceInstance = new EmailService();

// Export the instance
export default emailServiceInstance;
