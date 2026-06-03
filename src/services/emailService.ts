import { IUser } from "../models/User";
import Admin from "../models/Admin";
import dotenv from "dotenv";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");
console.log("📁 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error("❌ Failed to load .env file:", result.error);
} else {
  console.log("✅ .env file loaded successfully");
}

console.log("🔍 ENVIRONMENT VARIABLES CHECK:");
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
console.log("   FRONTEND_URL:", process.env.FRONTEND_URL || "❌ MISSING");

const safeToFixed = (value: any, decimals: number = 2): string => {
  if (value === undefined || value === null || isNaN(Number(value))) {
    return "0.00";
  }
  return Number(value).toFixed(decimals);
};

class EmailService {
  private apiKey: string;
  private initialized: boolean = false;
  private adminEmail: string;
  private supportEmail: string;
  private emailFrom: string;

  constructor() {
    this.adminEmail = process.env.ADMIN_EMAIL || "";
    this.supportEmail = process.env.SUPPORT_EMAIL || "";
    this.emailFrom = process.env.EMAIL_FROM || "";
    this.apiKey = process.env.BREVO_API_KEY || "";

    console.log("\n📧 EmailService Constructor Values:");
    console.log("   ADMIN_EMAIL:", this.adminEmail || "❌ MISSING");
    console.log("   SUPPORT_EMAIL:", this.supportEmail || "❌ MISSING");
    console.log("   EMAIL_FROM:", this.emailFrom || "❌ MISSING");
    console.log("   BREVO_API_KEY:", this.apiKey ? "✅ SET" : "❌ MISSING");

    if (!this.adminEmail || !this.supportEmail || !this.emailFrom) {
      console.error("\n❌ Email configuration missing!");
      console.error("   Please ensure these are in your .env file:");
      console.error("   ADMIN_EMAIL=your_email@example.com");
      console.error("   SUPPORT_EMAIL=support@example.com");
      console.error("   EMAIL_FROM=noreply@example.com");
    }

    if (!this.apiKey) {
      console.error("\n❌ BREVO_API_KEY is missing!");
      console.error("   Please add BREVO_API_KEY to your .env file");
    } else {
      this.initialized = true;
      console.log("✅ Brevo API email service ready!\n");
    }
  }

  isConfigured(): boolean {
    return this.initialized && !!this.apiKey;
  }

  // Check if customer emails are enabled globally
  private async areCustomerEmailsEnabled(): Promise<boolean> {
    try {
      const admin = await Admin.findOne({
        role: { $in: ["super_admin", "admin"] },
        status: "active",
      }).sort({ role: 1 });

      // Default to true if no admin found or setting is true
      return admin ? admin.customerEmailAlertsEnabled !== false : true;
    } catch (error) {
      console.error("Error checking customer email setting:", error);
      return true; // Default to enabled on error
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    htmlContent: string,
    isCustomerEmail: boolean = true,
  ): Promise<boolean> {
    try {
      // Check if this is a customer email and if customer emails are disabled
      if (isCustomerEmail) {
        const customerEmailsEnabled = await this.areCustomerEmailsEnabled();
        if (!customerEmailsEnabled) {
          console.log(
            `📧 CUSTOMER EMAILS ARE DISABLED. Skipping email to ${to}: ${subject}`,
          );
          return false;
        }
      }

      if (!this.initialized || !this.apiKey) {
        console.log(
          `⚠️ Email service not initialized - skipping email to ${to}`,
        );
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

      console.log(`📧 Sending email via Brevo API to ${to}...`);
      console.log(`   Subject: ${subject}`);

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "Mister Fyber",
            email: senderEmail,
          },
          to: [{ email: to }],
          subject: subject,
          htmlContent: htmlContent,
        }),
      });

      if (response.ok) {
        const data: any = await response.json();
        console.log(`✅ Email sent successfully to ${to}`);
        console.log(`   Message ID: ${data.messageId || "N/A"}`);
        return true;
      } else {
        const error = await response.text();
        console.error(`❌ Brevo API error: ${response.status} - ${error}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      return false;
    }
  }

  private async sendToAdmin(subject: string, html: string): Promise<boolean> {
    if (!this.adminEmail) {
      console.error("❌ Admin email not configured");
      return false;
    }
    // Admin emails are ALWAYS sent (no toggle for these)
    return await this.sendEmail(
      this.adminEmail,
      `[ADMIN] ${subject}`,
      html,
      false,
    );
  }

  // ==================== PASSWORD CHANGE NOTIFICATION (CUSTOMER) ====================
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

  // ==================== ACCOUNT DELETION REQUEST (ADMIN ONLY) ====================
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

  // ==================== SUPPORT TICKET NOTIFICATION (ADMIN ONLY) ====================
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

  // ==================== PLAN CHANGE REQUEST NOTIFICATION (ADMIN ONLY) ====================
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

  // ==================== BILL WITHOUT ACCOUNT (CUSTOMER) ====================
  async sendBillWithoutAccount(
    application: any,
    bill: any,
    plan: any,
  ): Promise<void> {
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;
    const dueDate = bill.dueDate
      ? new Date(bill.dueDate).toLocaleDateString()
      : "N/A";
    const amount = bill.total || 0;

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
                  <div class="bill-details">
                      <h3 style="margin-top: 0;">📋 Bill Details</h3>
                      <p><strong>Invoice Number:</strong> ${bill.invoiceNumber}</p>
                      <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                      <p><strong>Due Date:</strong> ${dueDate}</p>
                      <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
                      ${bill.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : ""}
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
    );
  }

  // ==================== WELCOME EMAIL (CUSTOMER) ====================
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

  // ==================== APPLICATION RECEIVED (CUSTOMER) ====================
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

  // ==================== NEW APPLICATION NOTIFICATION (ADMIN ONLY) ====================
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

  // ==================== APPLICATION APPROVED (CUSTOMER) ====================
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

  // ==================== APPLICATION REJECTED (CUSTOMER) ====================
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

  // ==================== ACCOUNT CREDENTIALS (CUSTOMER) ====================
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

  // ==================== PASSWORD RESET (CUSTOMER) ====================
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

  // ==================== INVOICE (CUSTOMER) ====================
  async sendInvoice(user: IUser, billing: any): Promise<void> {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.total || billing.amount || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

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

    const html = `
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
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <h3 style="margin-top: 0;">Invoice Details</h3>
                  <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                  <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                  <p><strong>Due Date:</strong> ${dueDate}</p>
                  ${billing.isProRated ? `<p><strong>Bill Type:</strong> Pro-rated (First Bill)</p>` : `<p><strong>Bill Type:</strong> Monthly Subscription</p>`}
                  ${billing.installationFee && billing.installationFee > 0 ? `<p><strong>Installation Fee:</strong> ₱${billing.installationFee.toLocaleString()}</p>` : ""}
              </div>
              ${installationFeeInfo}
              ${additionalInfo}
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View & Pay Invoice</a>
              </div>
              <div style="margin-top: 20px; padding: 10px; background-color: #fff3cd; border-left: 4px solid #ffc107; font-size: 12px;">
                  <p style="margin: 0;"><strong>📌 Billing Information:</strong></p>
                  <p style="margin: 5px 0 0;">• Install Day 1-24: Pro-rated bill from installation to end of month (due on 25th)<br>
                  • Install Day 25-31: Combined bill (pro-rated + next month) due on 5th of following month<br>
                  • Monthly bills due on 5th of each month (pay before service period)<br>
                  • Daily rate formula: (Monthly Price × 12) ÷ 365 days<br>
                  • Installation fee: One-time charge of ₱${billing.installationFee || 1500}</p>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">Mister Fyber</p>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      `🧾 Invoice #${billing.invoiceNumber || billing._id} Ready`,
      html,
      true,
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #333;">🧾 Invoice Generated</h2>
          <p>An invoice has been generated for Mister Fyber user ${user.firstName || ""} ${user.lastName || ""}.</p>
          <p><strong>Invoice:</strong> ${billing.invoiceNumber || billing._id}</p>
          <p><strong>Amount:</strong> ₱${safeToFixed(amount)}</p>
          <p><strong>Due Date:</strong> ${dueDate}</p>
          ${billing.isProRated ? `<p><strong>Type:</strong> Pro-rated Bill</p>` : `<p><strong>Type:</strong> Monthly Bill</p>`}
          ${billing.installationFee && billing.installationFee > 0 ? `<p><strong>Installation Fee:</strong> ₱${billing.installationFee.toLocaleString()}</p>` : ""}
      </div>
    `;
    await this.sendToAdmin(
      `Invoice Generated: ${billing.invoiceNumber || billing._id} for ${user.email}`,
      adminHtml,
    );
  }

  // ==================== PAYMENT CONFIRMATION (CUSTOMER) ====================
  async sendPaymentConfirmation(
    user: IUser,
    payment: any,
    billing: any,
  ): Promise<void> {
    const amount = payment.amount || payment.totalAmount || 0;
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
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <h3 style="margin-top: 0;">Payment Details</h3>
                  <p><strong>Payment ID:</strong> ${payment._id}</p>
                  <p><strong>Amount Paid:</strong> ₱${safeToFixed(amount)}</p>
                  <p><strong>Payment Method:</strong> ${payment.paymentMethod || "N/A"}</p>
                  <p><strong>Reference:</strong> ${payment.referenceNumber || "N/A"}</p>
                  <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                  ${billing?.isProRated ? `<p><strong>Note:</strong> Your pro-rated payment has been confirmed. Your service is now active!</p>` : ""}
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
    );

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #28a745;">💰 Payment Received</h2>
          <p>Payment received from ${user.firstName || ""} ${user.lastName || ""} (${user.email}) for Mister Fyber.</p>
          <p><strong>Amount:</strong> ₱${safeToFixed(amount)}</p>
          <p><strong>Method:</strong> ${payment.paymentMethod || "N/A"}</p>
          <p><strong>Reference:</strong> ${payment.referenceNumber || "N/A"}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          ${billing?.isProRated ? `<p><strong>Note:</strong> Pro-rated payment confirmed. User service activated.</p>` : ""}
      </div>
    `;
    await this.sendToAdmin(
      `💰 Payment Received: ₱${safeToFixed(amount)} from ${user.email}`,
      adminHtml,
    );
  }

  // ==================== PAYMENT REMINDER (CUSTOMER) ====================
  async sendPaymentReminder(user: IUser, billing: any): Promise<void> {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.total || billing.amount || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

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
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                  <p><strong>Due Date:</strong> ${dueDate}</p>
                  ${billing?.isProRated ? `<p><strong>Note:</strong> This is your pro-rated first bill. Once paid, your service will be fully activated.</p>` : ""}
              </div>
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Pay Now</a>
              </div>
              <p>Please pay before the due date to avoid service interruption.</p>
              <hr>
              <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      `⚠️ Payment Reminder - Due ${dueDate}`,
      html,
      true,
    );
  }

  // ==================== BILLING REMINDER (CUSTOMER) ====================
  async sendBillingReminder(user: IUser, billing: any): Promise<void> {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.total || billing.amount || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

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
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p><strong>Amount Due:</strong> ₱${safeToFixed(amount)}</p>
                  <p><strong>Due Date:</strong> ${dueDate}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${frontendUrl}/billing" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Bill</a>
              </div>
              <hr>
              <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
          </div>
      </body>
      </html>
    `;
    await this.sendEmail(
      user.email,
      `📅 Billing Reminder - Due ${dueDate}`,
      html,
      true,
    );
  }

  // ==================== ACCOUNT STATUS UPDATE (CUSTOMER) ====================
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

  // ==================== PLAN CHANGE NOTIFICATION (CUSTOMER) ====================
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

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #333;">📡 User Plan Changed</h2>
          <p>Mister Fyber user ${user.firstName || ""} ${user.lastName || ""} (${user.email}) changed their plan.</p>
          <p><strong>From:</strong> ${oldPlan?.name || "N/A"}</p>
          <p><strong>To:</strong> ${newPlan?.name || "N/A"}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      </div>
    `;
    await this.sendToAdmin(
      `Plan Change: ${user.email} → ${newPlan?.name || "N/A"}`,
      adminHtml,
    );
  }

  // ==================== SERVICE REMINDER (CUSTOMER) ====================
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

  // ==================== SERVICE INTERRUPTION (CUSTOMER) ====================
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
}

export default new EmailService();
