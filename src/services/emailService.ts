import { IUser } from "../models/User";
import dotenv from "dotenv";
import path from "path";

// FORCE LOAD .env from the correct path BEFORE anything else
const envPath = path.resolve(process.cwd(), ".env");
console.log("📁 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error("❌ Failed to load .env file:", result.error);
} else {
  console.log("✅ .env file loaded successfully");
}

// Debug: Print all environment variables (without sensitive data)
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

class EmailService {
  private apiKey: string;
  private initialized: boolean = false;
  private adminEmail: string;
  private supportEmail: string;
  private emailFrom: string;

  constructor() {
    // Read environment variables directly from process.env
    this.adminEmail = process.env.ADMIN_EMAIL || "";
    this.supportEmail = process.env.SUPPORT_EMAIL || "";
    this.emailFrom = process.env.EMAIL_FROM || "";
    this.apiKey = process.env.BREVO_API_KEY || "";

    console.log("\n📧 EmailService Constructor Values:");
    console.log("   ADMIN_EMAIL:", this.adminEmail || "❌ MISSING");
    console.log("   SUPPORT_EMAIL:", this.supportEmail || "❌ MISSING");
    console.log("   EMAIL_FROM:", this.emailFrom || "❌ MISSING");
    console.log("   BREVO_API_KEY:", this.apiKey ? "✅ SET" : "❌ MISSING");

    // Check if all required configs are present
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

  async sendEmail(
    to: string,
    subject: string,
    htmlContent: string,
  ): Promise<boolean> {
    try {
      if (!this.initialized || !this.apiKey) {
        console.log(
          `⚠️ Email service not initialized - skipping email to ${to}`,
        );
        return false;
      }

      // Extract sender email from EMAIL_FROM (remove the name part if present)
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
    return await this.sendEmail(this.adminEmail, `[ADMIN] ${subject}`, html);
  }

  // ==================== REGISTRATION EMAIL ====================

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
                    body {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        margin: 0;
                        padding: 0;
                        background-color: #f4f4f4;
                    }
                    .container {
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                        background-color: #ffffff;
                        border-radius: 10px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    .header {
                        text-align: center;
                        padding: 20px 0;
                        border-bottom: 3px solid #28a745;
                        background-color: #f8f9fa;
                        border-radius: 10px 10px 0 0;
                    }
                    .header h1 {
                        color: #28a745;
                        margin: 0;
                        font-size: 28px;
                    }
                    .header p {
                        color: #666;
                        margin: 5px 0 0;
                    }
                    .content {
                        padding: 30px 20px;
                    }
                    .welcome-text {
                        font-size: 18px;
                        color: #333;
                        margin-bottom: 20px;
                    }
                    .details-box {
                        background: #f8f9fa;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                        border-left: 4px solid #28a745;
                    }
                    .details-box h3 {
                        margin-top: 0;
                        color: #28a745;
                    }
                    .detail-row {
                        margin: 10px 0;
                        padding: 5px 0;
                        border-bottom: 1px solid #e0e0e0;
                    }
                    .detail-label {
                        font-weight: bold;
                        color: #555;
                        display: inline-block;
                        width: 120px;
                    }
                    .detail-value {
                        color: #333;
                    }
                    .button-container {
                        text-align: center;
                        margin: 30px 0;
                    }
                    .btn {
                        display: inline-block;
                        padding: 12px 30px;
                        text-decoration: none;
                        border-radius: 5px;
                        font-weight: bold;
                        margin: 0 10px;
                        transition: all 0.3s ease;
                    }
                    .btn-primary {
                        background-color: #007bff;
                        color: white;
                    }
                    .btn-primary:hover {
                        background-color: #0056b3;
                    }
                    .btn-success {
                        background-color: #28a745;
                        color: white;
                    }
                    .btn-success:hover {
                        background-color: #1e7e34;
                    }
                    .footer {
                        text-align: center;
                        padding: 20px;
                        border-top: 1px solid #e0e0e0;
                        font-size: 12px;
                        color: #666;
                        background-color: #f8f9fa;
                        border-radius: 0 0 10px 10px;
                    }
                    .status-badge {
                        display: inline-block;
                        padding: 3px 10px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: bold;
                    }
                    .status-active {
                        background-color: #d4edda;
                        color: #155724;
                    }
                    .status-pending {
                        background-color: #fff3cd;
                        color: #856404;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎉 Welcome Aboard!</h1>
                        <p>Mister Fyber</p>
                    </div>
                    
                    <div class="content">
                        <div class="welcome-text">
                            Hello <strong>${user.firstName || user.username}</strong>!
                        </div>
                        
                        <p>Thank you for choosing <strong>Mister Fyber</strong>. We're excited to have you on board!</p>
                        <p>Your account has been successfully created and is now ready to use.</p>
                        
                        <div class="details-box">
                            <h3>📋 Account Details</h3>
                            <div class="detail-row">
                                <span class="detail-label">Username:</span>
                                <span class="detail-value">${user.username}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Email:</span>
                                <span class="detail-value">${user.email}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Full Name:</span>
                                <span class="detail-value">${user.firstName || ""} ${user.lastName || ""}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Phone:</span>
                                <span class="detail-value">${user.phoneNumber || "Not provided"}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Status:</span>
                                <span class="detail-value">
                                    <span class="status-badge ${user.status === "active" ? "status-active" : "status-pending"}">
                                        ${(user.status || "pending").toUpperCase()}
                                    </span>
                                </span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Registered:</span>
                                <span class="detail-value">${new Date().toLocaleString()}</span>
                            </div>
                        </div>
                        
                        <div class="button-container">
                            <a href="${loginUrl}" class="btn btn-primary">🔐 Login to Account</a>
                            <a href="${dashboardUrl}" class="btn btn-success">📊 Go to Dashboard</a>
                        </div>
                        
                        <p>With your account, you can:</p>
                        <ul>
                            <li>View and pay your bills online</li>
                            <li>Check your internet usage</li>
                            <li>Submit support tickets</li>
                            <li>Change your plan</li>
                            <li>Update your profile</li>
                        </ul>
                        
                        <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
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
      `🎉 Welcome to Mister Fyber, ${user.firstName || user.username}!`,
      html,
    );

    const adminHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>New User Registration</title>
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #28a745;">👤 New User Registration</h2>
                    <p>A new user has registered on Mister Fyber.</p>
                    <hr>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                        <p><strong>Name:</strong> ${user.firstName || ""} ${user.lastName || ""}</p>
                        <p><strong>Username:</strong> ${user.username}</p>
                        <p><strong>Email:</strong> ${user.email}</p>
                        <p><strong>Phone:</strong> ${user.phoneNumber || "N/A"}</p>
                        <p><strong>Status:</strong> ${user.status || "pending"}</p>
                        <p><strong>Registered:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    <hr>
                    <p style="color: #666; font-size: 12px;">Mister Fyber</p>
                </div>
            </body>
            </html>
        `;

    await this.sendToAdmin(
      `New User Registration: ${user.username}`,
      adminHtml,
    );
  }

  // ==================== APPLICATION EMAILS ====================

  async sendApplicationReceived(application: any, plan: any): Promise<void> {
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
                        <p><strong>Plan:</strong> ${plan.name}</p>
                        <p><strong>Monthly Price:</strong> ₱${plan.price.toFixed(2)}</p>
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
    );

    const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #f39c12;">📋 New Application</h2>
                <p><strong>Application ID:</strong> ${application.applicationId}</p>
                <p><strong>Name:</strong> ${application.firstName} ${application.lastName}</p>
                <p><strong>Email:</strong> ${application.email}</p>
                <p><strong>Phone:</strong> ${application.phoneNumber}</p>
                <p><strong>Plan:</strong> ${plan.name}</p>
                <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
            </div>
        `;
    await this.sendToAdmin(
      `New Application: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      adminHtml,
    );
  }

  async sendNewApplicationNotification(
    application: any,
    plan: any,
  ): Promise<void> {
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";
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
                    <p><strong>Plan:</strong> ${plan.name} (₱${plan.price.toFixed(2)})</p>
                    <p><strong>ID Type:</strong> ${application.idType}</p>
                    <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 5px;">
                    <h3>Address:</h3>
                    <p>${application.address?.street || "N/A"}<br>
                    ${application.address?.city || "N/A"}, ${application.address?.province || "N/A"}<br>
                    Zip Code: ${application.address?.zipCode || "N/A"}</p>
                </div>
                
                <div style="text-align: center; margin-top: 30px;">
                    <a href="${frontendUrl}/admin/applications" 
                       style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Review Application Now
                    </a>
                </div>
                
                <hr style="margin-top: 30px;">
                <p style="color: #666; font-size: 12px; text-align: center;">
                    This is an automated notification from Mister Fyber. Please review and take action.
                </p>
            </div>
        `;

    await this.sendToAdmin(
      `🆕 NEW APPLICATION: ${application.applicationId} from ${application.firstName} ${application.lastName}`,
      adminHtml,
    );
  }

  async sendApplicationApproved(application: any, plan: any): Promise<void> {
    const registerUrl = "https://www.misterfyber.com/register";

    const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Application Approved</title>
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #28a745;">🎉 Application Approved!</h2>
                    <p>Hello ${application.firstName},</p>
                    <p>Great news! Your application to Mister Fyber has been approved.</p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>Application ID:</strong> ${application.applicationId}</p>
                        <p><strong>Plan:</strong> ${plan.name}</p>
                        <p><strong>Monthly Price:</strong> ₱${plan.price.toFixed(2)}</p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${registerUrl}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Create Your Account
                        </a>
                    </div>
                    
                    <p>Use your Application ID: <strong>${application.applicationId}</strong> when registering.</p>
                    
                    ${
                      application.adminNotes
                        ? `
                    <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-left: 4px solid #007bff;">
                        <p><strong>Admin Notes:</strong></p>
                        <p>${application.adminNotes}</p>
                    </div>
                    `
                        : ""
                    }
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">Mister Fyber</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(
      application.email,
      `Application Approved - Create Your Account`,
      html,
    );

    const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #28a745;">✅ Application Approved</h2>
                <p>You have approved application #${application.applicationId} for Mister Fyber.</p>
                <p><strong>Applicant:</strong> ${application.firstName} ${application.lastName}</p>
                <p><strong>Email:</strong> ${application.email}</p>
                <p><strong>Plan:</strong> ${plan.name}</p>
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

    await this.sendEmail(application.email, `Application Status Update`, html);

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

  // ==================== PASSWORD RESET ====================

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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>You requested a password reset for your Mister Fyber account. Click the button below to reset your password:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetUrl}" 
                           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Reset Password
                        </a>
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

    await this.sendEmail(user.email, "Password Reset Request", html);
  }

  // ==================== BILLING & PAYMENT ====================

  async sendInvoice(user: IUser, billing: any): Promise<void> {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.totalAmount || billing.amount || billing.total || 0;
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.misterfyber.com";

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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>Your Mister Fyber invoice is now ready for payment.</p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Invoice Details</h3>
                        <p><strong>Invoice Number:</strong> ${billing.invoiceNumber || billing._id}</p>
                        <p><strong>Amount Due:</strong> ₱${amount.toFixed(2)}</p>
                        <p><strong>Due Date:</strong> ${dueDate}</p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/billing" 
                           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            View & Pay Invoice
                        </a>
                    </div>
                    
                    <p>Please pay before the due date to avoid service interruption.</p>
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">Mister Fyber</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(
      user.email,
      `Invoice #${billing.invoiceNumber || billing._id} Ready`,
      html,
    );

    const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #333;">🧾 Invoice Generated</h2>
                <p>An invoice has been generated for Mister Fyber user ${user.firstName || ""} ${user.lastName || ""}.</p>
                <p><strong>Invoice:</strong> ${billing.invoiceNumber || billing._id}</p>
                <p><strong>Amount:</strong> ₱${amount.toFixed(2)}</p>
                <p><strong>Due Date:</strong> ${dueDate}</p>
            </div>
        `;
    await this.sendToAdmin(
      `Invoice Generated: ${billing.invoiceNumber || billing._id} for ${user.email}`,
      adminHtml,
    );
  }

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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>Thank you for your payment to Mister Fyber. Your transaction has been completed successfully.</p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Payment Details</h3>
                        <p><strong>Payment ID:</strong> ${payment._id}</p>
                        <p><strong>Amount Paid:</strong> ₱${amount.toFixed(2)}</p>
                        <p><strong>Payment Method:</strong> ${payment.paymentMethod || "N/A"}</p>
                        <p><strong>Reference:</strong> ${payment.referenceNumber || "N/A"}</p>
                        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">Thank you for being a valued Mister Fyber customer!</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(
      user.email,
      `Payment Confirmation - ₱${amount.toFixed(2)}`,
      html,
    );

    const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #28a745;">💰 Payment Received</h2>
                <p>Payment received from ${user.firstName || ""} ${user.lastName || ""} (${user.email}) for Mister Fyber.</p>
                <p><strong>Amount:</strong> ₱${amount.toFixed(2)}</p>
                <p><strong>Method:</strong> ${payment.paymentMethod || "N/A"}</p>
                <p><strong>Reference:</strong> ${payment.referenceNumber || "N/A"}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
            </div>
        `;
    await this.sendToAdmin(
      `Payment Received: ₱${amount.toFixed(2)} from ${user.email}`,
      adminHtml,
    );
  }

  async sendPaymentReminder(user: IUser, billing: any): Promise<void> {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.totalAmount || billing.amount || billing.total || 0;
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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>This is a friendly reminder that your Mister Fyber payment is due soon.</p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>Amount Due:</strong> ₱${amount.toFixed(2)}</p>
                        <p><strong>Due Date:</strong> ${dueDate}</p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/billing" 
                           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Pay Now
                        </a>
                    </div>
                    
                    <p>Please pay before the due date to avoid service interruption.</p>
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(user.email, `Payment Reminder - Due ${dueDate}`, html);
  }

  async sendBillingReminder(user: IUser, billing: any): Promise<void> {
    const dueDate = billing.dueDate
      ? new Date(billing.dueDate).toLocaleDateString()
      : "N/A";
    const amount = billing.totalAmount || billing.amount || billing.total || 0;
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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>Your Mister Fyber bill is due on ${dueDate}.</p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>Amount Due:</strong> ₱${amount.toFixed(2)}</p>
                        <p><strong>Due Date:</strong> ${dueDate}</p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/billing" 
                           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            View Bill
                        </a>
                    </div>
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">This is an automated reminder from Mister Fyber.</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(user.email, `Billing Reminder - Due ${dueDate}`, html);
  }

  // ==================== ACCOUNT & SERVICE UPDATES ====================

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
                    <p>Hello ${user.firstName || user.username},</p>
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
      `Account Status Update: ${user.status || "pending"}`,
      html,
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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>Your Mister Fyber plan has been changed successfully.</p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>Old Plan:</strong> ${oldPlan.name}</p>
                        <p><strong>New Plan:</strong> ${newPlan.name}</p>
                        <p><strong>New Price:</strong> ₱${newPlan.price.toFixed(2)}</p>
                        <p><strong>New Speed:</strong> ${newPlan.speed?.download || "N/A"} Mbps / ${newPlan.speed?.upload || "N/A"} Mbps</p>
                    </div>
                    
                    <p>The changes will take effect immediately.</p>
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">Mister Fyber</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(user.email, `Plan Changed to ${newPlan.name}`, html);

    const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #333;">📡 User Plan Changed</h2>
                <p>Mister Fyber user ${user.firstName || ""} ${user.lastName || ""} (${user.email}) changed their plan.</p>
                <p><strong>From:</strong> ${oldPlan.name}</p>
                <p><strong>To:</strong> ${newPlan.name}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
            </div>
        `;
    await this.sendToAdmin(
      `Plan Change: ${user.email} → ${newPlan.name}`,
      adminHtml,
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
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>Thank you for being a valued Mister Fyber customer. Check your usage and billing status in your dashboard.</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${frontendUrl}/dashboard" 
                           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Go to Dashboard
                        </a>
                    </div>
                    
                    <hr>
                    <p style="color: #666; font-size: 12px;">Stay updated with your internet usage and billing with Mister Fyber.</p>
                </div>
            </body>
            </html>
        `;

    await this.sendEmail(user.email, "Weekly Service Update", html);
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
                    <p>Hello ${user.firstName || user.username},</p>
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

    await this.sendEmail(user.email, "Service Interruption Notice", html);

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
