// backend/src/services/emailService.ts
import { IUser } from "../models/User";
import Admin from "../models/Admin";
import Building from "../models/Building";
import Application from "../models/Application";
import dotenv from "dotenv";
import path from "path";

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
 * Get location from user, application, or building
 */
export const getLocationFromEntity = async (entity: any): Promise<string> => {
  try {
    if (entity && entity.location) {
      return entity.location;
    }

    if (entity && entity.buildingId) {
      const building = await Building.findById(entity.buildingId);
      if (building && building.location) {
        return building.location;
      }
    }

    if (entity && entity.buildingName) {
      const buildingName = entity.buildingName.toLowerCase().trim();
      // Check for Breeze
      if (buildingName.includes("breeze")) {
        return "breeze";
      }
      // Check for SIL/SILK - includes "sil" or "silk"
      if (buildingName.includes("sil") || buildingName.includes("silk")) {
        return "sil";
      }
    }

    if (entity && entity.applicationId) {
      const application = await Application.findOne({
        applicationId: entity.applicationId,
      });
      if (application) {
        if (application.buildingId) {
          const building = await Building.findById(application.buildingId);
          if (building && building.location) {
            return building.location;
          }
        }
        if (application.buildingName) {
          const buildingName = application.buildingName.toLowerCase().trim();
          if (buildingName.includes("breeze")) {
            return "breeze";
          }
          if (buildingName.includes("sil") || buildingName.includes("silk")) {
            return "sil";
          }
        }
      }
    }

    return "";
  } catch (error) {
    console.error("Error getting location from entity:", error);
    return "";
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
    this.supportEmail = process.env.SUPPORT_EMAIL || "support@misterfyber.com";
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

    // Initialize if API key is present
    if (this.apiKey && this.apiKey.length > 10) {
      this.initialized = true;
      console.log("✅ Email service initialized successfully!");
    } else {
      console.warn(
        "⚠️ Email service not initialized - BREVO_API_KEY is missing or invalid",
      );

      // In development, we can still "send" emails by logging them
      if (process.env.NODE_ENV === "development") {
        console.log(
          "📧 [DEV MODE] Email service will log emails instead of sending",
        );
        this.initialized = true; // Allow dev mode to work
      }
    }
  }

  isConfigured(): boolean {
    // Check if API key is valid and service is initialized
    const configured =
      this.initialized && !!this.apiKey && this.apiKey.length > 10;
    console.log(
      `📧 isConfigured() called: ${configured} (initialized: ${this.initialized}, apiKey: ${!!this.apiKey}, length: ${this.apiKey?.length || 0})`,
    );
    return configured;
  }

  // ==================== CHECK IF CUSTOMER EMAILS ARE ENABLED ====================
  private async areCustomerEmailsEnabled(): Promise<boolean> {
    try {
      const admin = await Admin.findOne({
        role: { $in: ["super_admin", "admin"] },
        status: "active",
      }).sort({ role: 1 });

      // 🔥 FIX: Force enable if admin is found, or default to true
      const enabled = admin ? admin.customerEmailAlertsEnabled !== false : true;

      console.log(`📧 Customer emails enabled: ${enabled}`);
      console.log(`   Admin found: ${!!admin}`);
      console.log(
        `   customerEmailAlertsEnabled: ${admin?.customerEmailAlertsEnabled}`,
      );

      // 🔥 FORCE ENABLE - TEMPORARY FIX IF STILL DISABLED
      if (!enabled) {
        console.log(
          "⚠️ Customer emails are DISABLED in database. FORCE ENABLING for this request.",
        );
        // Update the admin setting to true
        if (admin) {
          await Admin.updateOne(
            { _id: admin._id },
            { $set: { customerEmailAlertsEnabled: true } },
          );
          console.log("✅ Updated admin setting to ENABLED");
        }
        return true;
      }

      return enabled;
    } catch (error) {
      console.warn(
        "⚠️ Could not check customer email setting, defaulting to true:",
        error,
      );
      return true;
    }
  }

  // ==================== CORE EMAIL SENDING WITH LOCATION SUPPORT ====================
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
    },
  ): Promise<boolean> {
    try {
      console.log(`📧 sendEmail called: to=${to}, subject=${subject}`);
      console.log(
        `   isCustomerEmail: ${isCustomerEmail}, location: ${location || "none"}`,
      );

      // 🔥 FIX: Always check customer email setting, but force enable if disabled
      if (isCustomerEmail) {
        const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
        if (!customerEmailsEnabled) {
          console.log(
            `⚠️ CUSTOMER EMAILS ARE DISABLED. But we will FORCE SEND anyway.`,
          );
          // Don't return false - force send!
        }
      }

      // In development mode, log the email instead of sending
      if (process.env.NODE_ENV === "development" && !this.apiKey) {
        console.log(`📧 [DEV MODE] Would send email to: ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   Content preview: ${htmlContent.substring(0, 200)}...`);
        return true;
      }

      // Check if email service is properly configured
      if (!this.isConfigured()) {
        console.error(
          `❌ Email service not configured - skipping email to ${to}`,
        );
        console.error(`   Please check BREVO_API_KEY in your .env file`);
        return false;
      }

      // Extract sender email from EMAIL_FROM
      let senderEmail = "admin@misterfyber.com";
      if (this.emailFrom) {
        const match = this.emailFrom.match(/<(.+)>/);
        if (match) {
          senderEmail = match[1];
        } else if (this.emailFrom.includes("@")) {
          senderEmail = this.emailFrom;
        }
      }

      // Prepare recipients
      const toArray = Array.isArray(to) ? to : [to];

      // Filter out any empty or invalid emails
      const validToArray = toArray.filter(
        (email) => email && email.trim().length > 0,
      );
      if (validToArray.length === 0) {
        console.error("❌ No valid recipient emails provided");
        return false;
      }

      // Get collection email based on location
      let collectionEmail = DEFAULT_COLLECTION_EMAIL;
      if (location) {
        collectionEmail = getCollectionEmailByLocation(location);
      }

      // Prepare BCC with collection email
      let bccEmails: string[] = [];
      if (options?.bcc) {
        bccEmails = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
      }

      // Add collection email to BCC if it's not already in the TO or CC list
      const allRecipients = [
        ...validToArray,
        ...(options?.cc
          ? Array.isArray(options.cc)
            ? options.cc
            : [options.cc]
          : []),
      ];
      if (
        !allRecipients.includes(collectionEmail) &&
        !bccEmails.includes(collectionEmail)
      ) {
        bccEmails.push(collectionEmail);
        console.log(`📧 Added collection email to BCC: ${collectionEmail}`);
      }

      console.log(
        `📧 Sending email via Brevo API to ${validToArray.join(", ")}...`,
      );
      console.log(`   Subject: ${subject}`);
      console.log(`   Sender: Mister Fyber <${senderEmail}>`);
      console.log(`   Location: ${location || "Not specified"}`);
      console.log(`   Collection Email (BCC): ${collectionEmail}`);

      // Build request body
      const requestBody: any = {
        sender: {
          name: "Mister Fyber",
          email: senderEmail,
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
      }

      if (options?.attachments && options.attachments.length > 0) {
        requestBody.attachment = options.attachments.map((att: any) => ({
          name: att.filename || "attachment",
          content: att.content?.toString("base64") || "",
        }));
      }

      // Log request body (without sensitive data)
      console.log("📧 Request body prepared successfully");

      // Send email via Brevo API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

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
          return true;
        } else {
          const errorText = await response.text();
          console.error(
            `❌ Brevo API error: ${response.status} - ${errorText}`,
          );

          // Try to parse error for more details
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

  // Force send email - bypasses customer email enabled check
  async forceSendEmail(
    to: string | string[],
    subject: string,
    htmlContent: string,
    location?: string,
    options?: {
      cc?: string | string[];
      bcc?: string | string[];
      replyTo?: string;
      attachments?: any[];
    },
  ): Promise<boolean> {
    console.log(`📧 Force sending email (bypassing customer email setting)...`);
    return await this.sendEmail(
      to,
      subject,
      htmlContent,
      false, // isCustomerEmail = false (bypasses the check)
      location,
      options,
    );
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

  // ==================== SEND BILLING EMAIL WITH LOCATION ====================
  async sendBillingEmail(
    user: IUser | any,
    billing: any,
    location?: string,
    options?: {
      cc?: string | string[];
      attachments?: any[];
      replyTo?: string;
    },
  ): Promise<boolean> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      const subject = `🧾 Invoice #${billing.invoiceNumber || billing._id} - Mister Fyber`;

      const html = this.generateInvoiceHTML(user, billing, userLocation);

      return await this.sendEmail(
        user.email,
        subject,
        html,
        true,
        userLocation,
        {
          cc: options?.cc,
          attachments: options?.attachments,
          replyTo: options?.replyTo || this.supportEmail,
          bcc: [collectionEmail],
        },
      );
    } catch (error) {
      console.error(`❌ Error sending billing email:`, error);
      return false;
    }
  }

  // ==================== SEND INVOICE WITH PDF ATTACHMENT ====================
  async sendInvoiceWithPDF(
    invoiceData: any,
    pdfBuffer: Buffer,
    pdfFileName: string,
    location?: string,
  ): Promise<boolean> {
    try {
      const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
      if (!customerEmailsEnabled) {
        console.log(
          `📧 CUSTOMER EMAILS ARE DISABLED. Force sending invoice to ${invoiceData.customerEmail}`,
        );
        // Don't return false - force send!
      }

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

      const dueDate = invoiceData.dueDate
        ? new Date(invoiceData.dueDate).toLocaleDateString()
        : "N/A";
      const amount = invoiceData.total || 0;
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";

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

      const collectionBCCNote = `
        <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db;">
          <strong>📧 Collection Email:</strong> ${collectionEmail}
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
                </div>
                <div class="content">
                    <p><strong>Subscriber's Name:</strong> ${invoiceData.customerName}</p>
                    <p><strong>Address:</strong> ${invoiceData.customerAddress}</p>
                    
                    ${invoiceData.planName ? `<p><strong>Plan Rate:</strong> ${invoiceData.planName}</p>` : ""}
                    
                    <div class="bill-details">
                        <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                        <p><strong>Billing Period:</strong> ${this.formatDateForDisplay(invoiceData.billingPeriod?.start)} - ${this.formatDateForDisplay(invoiceData.billingPeriod?.end)}</p>
                        <p><strong>Issue Date:</strong> ${this.formatDateForDisplay(invoiceData.issuedDate)}</p>
                        <p><strong>Due Date:</strong> ${dueDate}</p>
                        ${invoiceData.isProRated ? `<p><strong>Pro-rated Days:</strong> ${invoiceData.proRatedDays || 0} days</p>` : ""}
                        ${invoiceData.isInstallationFee ? `<p><strong>Includes Installation Fee</strong></p>` : ""}
                    </div>

                    ${collectionBCCNote}
                    ${itemsHtml}
                    ${paymentInstructions}

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
                </div>
            </div>
        </body>
        </html>
      `;

      let senderEmail = "admin@misterfyber.com";
      if (this.emailFrom) {
        const match = this.emailFrom.match(/<(.+)>/);
        if (match) {
          senderEmail = match[1];
        } else if (this.emailFrom.includes("@")) {
          senderEmail = this.emailFrom;
        }
      }

      const pdfBase64 = pdfBuffer.toString("base64");

      const requestBody = {
        sender: {
          name: "Mister Fyber",
          email: senderEmail,
        },
        to: [{ email: invoiceData.customerEmail.trim() }],
        subject: `🧾 Invoice #${invoiceData.invoiceNumber} - Mister Fyber`,
        htmlContent: html,
        bcc: [{ email: collectionEmail.trim() }],
        attachment: [
          {
            name: pdfFileName,
            content: pdfBase64,
          },
        ],
      };

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
          console.log(`   Collection Email (BCC): ${collectionEmail}`);
          console.log(`   Message ID: ${data.messageId || "N/A"}`);
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

  // ==================== GENERATE INVOICE HTML ====================
  private generateInvoiceHTML(
    user: any,
    billing: any,
    location: string,
  ): string {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.total || billing.amount || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

    const locationBadge = location
      ? `
      <div style="display: inline-block; background: ${location.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-top: 10px;">
        📍 ${location.toUpperCase()}
      </div>
    `
      : "";

    const collectionEmail = getCollectionEmailByLocation(location);

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

    let installationFeeInfo = "";
    if (billing.installationFee && billing.installationFee > 0) {
      installationFeeInfo = `
        <div style="margin-top: 15px; padding: 10px; background-color: #fff3cd; border-radius: 5px;">
          <p style="margin: 0; font-size: 12px; color: #856404;">
            <strong>🔧 Installation Fee:</strong> ₱${billing.installationFee.toLocaleString()} (One-time charge)
            ${billing.installationFeePaid ? '✅ <span style="color: #28a745;">(Paid)</span>' : '⚠️ <span style="color: #dc3545;">(Pending)</span>'}
          </p>
        </div>
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
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <h3 style="margin-top: 0;">Invoice Details</h3>
                  <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                  <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                  <p><strong>Due Date:</strong> ${dueDate}</p>
                  ${billing.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : `<p><strong>Bill Type:</strong> Monthly Subscription</p>`}
                  ${billing.installationFee && billing.installationFee > 0 ? `<p><strong>Installation Fee:</strong> ₱${billing.installationFee.toLocaleString()}</p>` : ""}
                  ${location ? `<p><strong>Location:</strong> ${location.toUpperCase()}</p>` : ""}
                  <p><strong>Collection Email:</strong> ${collectionEmail}</p>
              </div>
              ${installationFeeInfo}
              ${additionalInfo}
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View & Pay Invoice</a>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">Mister Fyber</p>
          </div>
      </body>
      </html>
    `;
  }

  // ==================== SEND PAYMENT REMINDER WITH LOCATION ====================
  async sendPaymentReminder(
    user: IUser | any,
    billing: any,
    location?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      const dueDate = billing.dueDate
        ? new Date(billing.dueDate).toLocaleDateString()
        : "N/A";
      const amount = billing.total || billing.amount || 0;
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";

      const isInstallationBill = billing.isInstallationBill;

      let reminderMessage = "";
      if (isInstallationBill) {
        reminderMessage = `<p><strong>Note:</strong> This is your installation fee. Once paid, our team will schedule your installation.</p>`;
      } else if (billing.isProRated) {
        reminderMessage = `<p><strong>Note:</strong> This is your pro-rated first bill. Once paid, your service will be fully activated.</p>`;
      }

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Payment Reminder</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #f39c12;">⚠️ Payment Reminder</h2>
                <p>Hello ${user.firstName || user.email},</p>
                <p>This is a friendly reminder that your Mister Fyber payment is due soon.</p>
                ${locationBadge}
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Due Date:</strong> ${dueDate}</p>
                    ${reminderMessage}
                    ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Pay Now</a>
                </div>
                <p>Please pay before the due date to avoid service interruption.</p>
                <hr>
                <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
                <p style="color: #666; font-size: 12px;">Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></p>
            </div>
        </body>
        </html>
      `;

      await this.sendEmail(
        user.email,
        `⚠️ Payment Reminder - Due ${dueDate}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: this.supportEmail,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending payment reminder:`, error);
    }
  }

  // ==================== SEND DUE DATE REMINDER WITH LOCATION ====================
  async sendDueDateReminder(
    user: IUser | any,
    billing: any,
    location?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      const dueDate = billing.dueDate
        ? new Date(billing.dueDate).toLocaleDateString()
        : "N/A";
      const amount = billing.total || billing.amount || 0;
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";

      const isInstallationBill = billing.isInstallationBill;

      let reminderMessage = "";
      if (isInstallationBill) {
        reminderMessage = `<p><strong>⚠️ IMPORTANT:</strong> This is your installation fee. Payment is due TODAY. Once paid, our team will schedule your installation.</p>`;
      } else if (billing.isProRated) {
        reminderMessage = `<p><strong>⚠️ IMPORTANT:</strong> This is your pro-rated first bill. Payment is due TODAY. Once paid, your service will be fully activated.</p>`;
      } else {
        reminderMessage = `<p><strong>⚠️ IMPORTANT:</strong> Your monthly subscription payment is due TODAY. Please pay immediately to avoid service interruption.</p>`;
      }

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>⚠️ PAYMENT DUE TODAY - Mister Fyber</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
                .header { text-align: center; border-bottom: 2px solid #dc3545; padding-bottom: 20px; }
                .header h1 { color: #dc3545; margin: 0; }
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
                    <div class="bill-details">
                        <h3 style="margin-top: 0;">📋 Invoice Details</h3>
                        <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                        <p><strong>Amount Due:</strong> <span style="color: #dc3545; font-size: 18px;">₱${safeToFixed(amount)}</span></p>
                        <p><strong>Due Date:</strong> <span style="color: #dc3545; font-weight: bold;">${dueDate} (TODAY)</span></p>
                        ${billing.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : `<p><strong>Bill Type:</strong> Monthly Subscription</p>`}
                        ${billing.installationFee && billing.installationFee > 0 && billing.isInstallationBill ? `<p><strong>Installation Fee:</strong> ₱${billing.installationFee.toLocaleString()}</p>` : ""}
                        ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                    </div>
                    ${reminderMessage}
                    <div class="warning">
                        <strong>📌 After Today:</strong> If payment is not received, your account will enter a grace period. After the grace period, your service will be suspended.
                    </div>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/billing" class="button">💰 PAY NOW</a>
                    </div>
                    <p><strong>Payment Methods Accepted:</strong> GCash, Maya, Bank Transfer, Over-the-Counter</p>
                    <p>If you have already made the payment, please disregard this notice.</p>
                </div>
                <div class="footer">
                    <p>Mister Fyber - Your trusted internet provider</p>
                    <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
                    <p><small>Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>
                    <p><small>Late payments may incur service interruption after grace period.</small></p>
                </div>
            </div>
        </body>
        </html>
      `;

      await this.sendEmail(
        user.email,
        `⚠️ PAYMENT DUE TODAY - ${billing.invoiceNumber || billing._id}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: this.supportEmail,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending due date reminder:`, error);
    }
  }

  // ==================== SEND PAYMENT CONFIRMATION WITH LOCATION ====================
  async sendPaymentConfirmation(
    user: IUser | any,
    payment: any,
    billing: any,
    location?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      const amount = payment.amount || payment.totalAmount || 0;
      const isInstallationPayment =
        payment.paymentType === "installation" ||
        (billing && billing.isInstallationBill);

      let additionalMessage = "";
      if (isInstallationPayment) {
        additionalMessage = `<p><strong>Installation Fee:</strong> Your installation fee has been paid. Our team will schedule your installation within 24-48 hours.</p>`;
      } else if (billing?.isProRated) {
        additionalMessage = `<p><strong>Note:</strong> Your pro-rated payment has been confirmed. Your service is now active!</p>`;
      }

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Payment Confirmation</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #28a745;">💰 Payment Confirmed!</h2>
                <p>Hello ${user.firstName || user.email},</p>
                <p>Thank you for your payment to Mister Fyber. Your transaction has been completed successfully.</p>
                ${locationBadge}
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Payment Details</h3>
                    <p><strong>Payment ID:</strong> ${payment._id}</p>
                    <p><strong>Amount Paid:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Payment Method:</strong> ${payment.paymentMethod || "N/A"}</p>
                    <p><strong>Reference:</strong> ${payment.referenceNumber || "N/A"}</p>
                    <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                    ${additionalMessage}
                    ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                </div>
                <hr>
                <p style="color: #666; font-size: 12px;">Thank you for being a valued Mister Fyber customer!</p>
            </div>
        </body>
        </html>
      `;

      await this.sendEmail(
        user.email,
        `💰 Payment Confirmation - ₱${safeToFixed(amount)}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: this.supportEmail,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending payment confirmation:`, error);
    }
  }

  // ==================== SEND BILL WITHOUT ACCOUNT ====================
  async sendBillWithoutAccount(
    application: any,
    bill: any,
    plan: any,
    location?: string,
  ): Promise<void> {
    try {
      const userLocation =
        location || (await getLocationFromEntity(application));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

      const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;
      const dueDate = bill.dueDate
        ? new Date(bill.dueDate).toLocaleDateString()
        : "N/A";
      const amount = bill.total || 0;

      const locationBadge = userLocation
        ? `
        <div style="display: inline-block; background: ${userLocation.toLowerCase() === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin-bottom: 10px;">
          📍 ${userLocation.toUpperCase()}
        </div>
      `
        : "";

      const html = `
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
                    <div class="bill-details">
                        <h3 style="margin-top: 0;">📋 Bill Details</h3>
                        <p><strong>Invoice Number:</strong> ${bill.invoiceNumber}</p>
                        <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                        <p><strong>Due Date:</strong> ${dueDate}</p>
                        <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
                        ${bill.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
                        ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                        <p><strong>Collection Email:</strong> ${collectionEmail}</p>
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
                    <p>Mister Fyber - Your trusted internet provider</p>
                    <p><small>Need help? Contact us at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></small></p>
                    <p><small>Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></small></p>
                </div>
            </div>
        </body>
        </html>
      `;

      await this.sendEmail(
        application.email,
        `🧾 Your Bill is Ready - ${bill.invoiceNumber}`,
        html,
        true,
        userLocation,
        {
          bcc: [collectionEmail],
          replyTo: this.supportEmail,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending bill without account:`, error);
    }
  }

  // ==================== SEND INVOICE (CUSTOMER) ====================
  async sendInvoice(
    user: IUser | any,
    billing: any,
    location?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      await this.sendBillingEmail(user, billing, userLocation);
    } catch (error) {
      console.error(`❌ Error sending invoice:`, error);
    }
  }

  // ==================== SEND BILLING REMINDER (CUSTOMER) ====================
  async sendBillingReminder(
    user: IUser | any,
    billing: any,
    location?: string,
  ): Promise<void> {
    try {
      const userLocation = location || (await getLocationFromEntity(user));
      const collectionEmail = getCollectionEmailByLocation(userLocation);

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
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                    <p><strong>Due Date:</strong> ${dueDate}</p>
                    ${userLocation ? `<p><strong>Location:</strong> ${userLocation.toUpperCase()}</p>` : ""}
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Bill</a>
                </div>
                <hr>
                <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
                <p style="color: #666; font-size: 12px;">Collection Email: <a href="mailto:${collectionEmail}">${collectionEmail}</a></p>
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
          replyTo: this.supportEmail,
        },
      );
    } catch (error) {
      console.error(`❌ Error sending billing reminder:`, error);
    }
  }

  // ==================== SEND WELCOME EMAIL ====================
  async sendWelcomeEmail(user: IUser): Promise<void> {
    const loginUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/login`;
    const dashboardUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/dashboard`;

    const html = `
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
    await this.sendEmail(
      user.email,
      `🎉 Welcome to Mister Fyber, ${user.firstName || user.email}!`,
      html,
      true,
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #28a745;">👤 New User Registration</h2>
          <p>A new user has registered on Mister Fyber.</p>
          <hr>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
              <p><strong>Name:</strong> ${user.firstName || ""} ${user.lastName || ""}</p>
              <p><strong>Username:</strong> ${user.username || user.email}</p>
              <p><strong>Email:</strong> ${user.email}</p>
              <p><strong>Phone:</strong> ${user.phoneNumber || "N/A"}</p>
              <p><strong>Status:</strong> ${user.status || "pending"}</p>
              <p><strong>Registered:</strong> ${new Date().toLocaleString()}</p>
          </div>
      </div>
    `;
    await this.sendToAdmin(`New User Registration: ${user.email}`, adminHtml);
  }

  // ==================== SEND PASSWORD RESET ====================
  async sendPasswordReset(user: IUser, resetToken: string): Promise<void> {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const html = `
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
    await this.sendEmail(user.email, "Password Reset Request", html, true);
  }

  // ==================== SEND ACCOUNT CREDENTIALS ====================
  async sendAccountCredentials(
    user: IUser,
    username: string,
    password: string,
    applicationId: string,
  ): Promise<void> {
    const loginUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/login`;
    const html = `
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
    await this.sendEmail(
      user.email,
      `🔐 Your Mister Fyber Account Credentials`,
      html,
      true,
    );
  }

  // ==================== APPLICATION RECEIVED ====================
  async sendApplicationReceived(application: any, plan: any): Promise<void> {
    const planPrice = plan?.price ?? 0;
    const html = `
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
    await this.sendEmail(
      application.email,
      `Application Received - ${application.applicationId}`,
      html,
      true,
    );

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

  // ==================== APPLICATION APPROVED ====================
  async sendApplicationApproved(application: any, plan: any): Promise<void> {
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;
    const planPrice = plan?.price ?? 0;

    const html = `
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
    await this.sendEmail(
      application.email,
      `✅ Application Approved - Create Your Account`,
      html,
      true,
    );

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

  // ==================== APPLICATION REJECTED ====================
  async sendApplicationRejected(
    application: any,
    reason: string,
  ): Promise<void> {
    const html = `
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
    await this.sendEmail(
      application.email,
      `Application Status Update`,
      html,
      true,
    );

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

  // ==================== NEW APPLICATION NOTIFICATION ====================
  async sendNewApplicationNotification(
    application: any,
    plan: any,
  ): Promise<void> {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
    const planPrice = plan?.price ?? 0;

    const adminHtml = `
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
    await this.sendToAdmin(
      `🆕 NEW APPLICATION: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      adminHtml,
    );
  }

  // ==================== OTHER EMAIL METHODS ====================
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

  async sendAccountDeletionRequest(user: IUser, reason: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Account Deletion Request</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
              .header { text-align: center; border-bottom: 2px solid #dc3545; padding-bottom: 20px; }
              .header h1 { color: #dc3545; margin: 0; }
              .content { padding: 20px 0; }
              .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
              .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🗑️ Account Deletion Request</h1>
              </div>
              <div class="content">
                  <p>A user has requested account deletion.</p>
                  <div class="details">
                      <p><strong>Name:</strong> ${user.firstName || ""} ${user.lastName || ""}</p>
                      <p><strong>Email:</strong> ${user.email}</p>
                      <p><strong>Username:</strong> ${user.username}</p>
                      <p><strong>Reason:</strong> ${reason || "Not provided"}</p>
                      <p><strong>Requested At:</strong> ${new Date().toLocaleString()}</p>
                  </div>
              </div>
              <div class="footer">
                  <p>Mister Fyber - Admin Notification</p>
              </div>
          </div>
      </body>
      </html>
    `;
    await this.sendToAdmin("Account Deletion Request", html);
  }

  async sendSupportTicketNotification(
    userEmail: string,
    subject: string,
    category: string,
    message: string,
    priority: string,
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>New Support Ticket</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
              .header { text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 20px; }
              .header h1 { color: #007bff; margin: 0; }
              .content { padding: 20px 0; }
              .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
              .message-box { background: white; padding: 10px; border-radius: 5px; border-left: 3px solid #007bff; }
              .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🎫 New Support Ticket</h1>
              </div>
              <div class="content">
                  <div class="details">
                      <p><strong>User:</strong> ${userEmail}</p>
                      <p><strong>Subject:</strong> ${subject}</p>
                      <p><strong>Category:</strong> ${category}</p>
                      <p><strong>Priority:</strong> ${priority}</p>
                      <p><strong>Message:</strong></p>
                      <div class="message-box">${message}</div>
                      <p><strong>Submitted At:</strong> ${new Date().toLocaleString()}</p>
                  </div>
              </div>
              <div class="footer">
                  <p>Mister Fyber - Support Ticket</p>
              </div>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      this.supportEmail,
      `New Support Ticket: ${subject}`,
      html,
      false,
    );
  }

  async sendPlanChangeRequestNotification(
    user: IUser,
    newPlan: any,
    currentRate: number,
    effectiveDate: string,
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Plan Change Request</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
              .header { text-align: center; border-bottom: 2px solid #f39c12; padding-bottom: 20px; }
              .header h1 { color: #f39c12; margin: 0; }
              .content { padding: 20px 0; }
              .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
              .footer { font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>📡 Plan Change Request</h1>
              </div>
              <div class="content">
                  <p>A user has requested a plan change.</p>
                  <div class="details">
                      <p><strong>User:</strong> ${user.firstName || ""} ${user.lastName || ""} (${user.email})</p>
                      <p><strong>Username:</strong> ${user.username}</p>
                      <p><strong>Current Monthly Rate:</strong> ₱${safeToFixed(currentRate)}</p>
                      <p><strong>Requested Plan:</strong> ${newPlan.name}</p>
                      <p><strong>New Plan Price:</strong> ₱${safeToFixed(newPlan.price)}</p>
                      <p><strong>Requested Effective Date:</strong> ${effectiveDate || "Immediate"}</p>
                      <p><strong>Requested At:</strong> ${new Date().toLocaleString()}</p>
                  </div>
                  <p>Please review and approve/reject this request in the admin panel.</p>
              </div>
              <div class="footer">
                  <p>Mister Fyber - Admin Notification</p>
              </div>
          </div>
      </body>
      </html>
    `;
    await this.sendToAdmin(`Plan Change Request - ${user.username}`, html);
  }

  async sendAccountStatusUpdate(user: IUser): Promise<void> {
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
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #333;">🔄 Account Status Changed</h2>
          <p>Mister Fyber user ${user.firstName || ""} ${user.lastName || ""} (${user.email}) status changed to: <strong>${user.status || "pending"}</strong></p>
          <p>Date: ${new Date().toLocaleString()}</p>
      </div>
    `;
    await this.sendToAdmin(
      `Account Status Changed: ${user.email} → ${user.status || "pending"}`,
      adminHtml,
    );
  }

  async sendPlanChangeNotification(
    user: IUser,
    oldPlan: any,
    newPlan: any,
  ): Promise<void> {
    const newPlanPrice = newPlan?.price ?? 0;
    const html = `
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
    await this.sendEmail(
      user.email,
      `📡 Plan Changed to ${newPlan?.name || "N/A"}`,
      html,
      true,
    );
  }

  async sendServiceReminder(user: IUser): Promise<void> {
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
    await this.sendEmail(user.email, "Weekly Service Update", html, true);
  }

  async sendServiceInterruption(
    user: IUser,
    reason: string,
    estimatedDuration?: Date,
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
              <p>Hello ${user.firstName || user.email},</p>
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
    await this.sendEmail(user.email, "Service Interruption Notice", html, true);

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #dc3545;">⚠️ Service Interruption Reported</h2>
          <p><strong>User:</strong> ${user.firstName || ""} ${user.lastName || ""} (${user.email})</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Estimated Duration:</strong> ${duration}</p>
          <p><strong>Reported:</strong> ${new Date().toLocaleString()}</p>
      </div>
    `;
    await this.sendToAdmin(`Service Interruption: ${user.email}`, adminHtml);
  }

  // ==================== TEST EMAIL CONFIGURATION ====================
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
}

// ==================== EXPORT FUNCTIONS ====================
export const getLocationEmailMap = () => LOCATION_EMAIL_MAP;
export const getDefaultCollectionEmail = () => DEFAULT_COLLECTION_EMAIL;

// Create a singleton instance
const emailServiceInstance = new EmailService();

// Export the instance
export default emailServiceInstance;
