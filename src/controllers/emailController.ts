// backend/src/controllers/emailController.ts
import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Application from "../models/Application";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import EmailSentRecord from "../models/EmailSentRecord";
import EmailTemplate from "../models/EmailTemplate";
import emailService, {
  getLocationFromEntity,
  getCollectionEmailByLocation,
} from "../services/emailService";

type AuthRequest = Request & { user?: any };

// Check admin access
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

// Generate email preview HTML
function generateEmailPreview(
  subject: string,
  message: string,
  includeBilling: boolean,
  billingData?: any,
  customerData?: any,
  senderInfo?: string,
): string {
  const senderSection = senderInfo
    ? `
    <div style="background: #f0f7ff; padding: 8px 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; color: #1a56db; text-align: center;">
      <strong>📧 ${senderInfo}</strong>
    </div>
  `
    : "";

  // Location badge for preview
  let locationBadge = "";
  if (customerData && customerData.buildingName) {
    const buildingName = customerData.buildingName.toLowerCase().trim();
    let location = "other";
    if (buildingName.includes("breeze")) location = "breeze";
    else if (buildingName.includes("sil") || buildingName.includes("silk"))
      location = "sil";

    if (location !== "other") {
      locationBadge = `
        <div style="display: inline-block; background: ${location === "breeze" ? "#1a56db" : "#7c3aed"}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; text-transform: uppercase; font-weight: bold; margin: 10px 0;">
          📍 ${location.toUpperCase()} - ${customerData.buildingName}
        </div>
      `;
    }
  }

  const billingSection =
    includeBilling && billingData
      ? `
    <div style="margin-top: 30px; padding: 20px; background-color: #f8f9fa; border-radius: 10px; border-left: 4px solid #007bff;">
      <h3 style="margin-top: 0; color: #007bff;">📋 Billing Information</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0;"><strong>Invoice Number:</strong></td><td>${billingData.invoiceNumber || "N/A"}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Amount Due:</strong></td><td style="color: #dc3545; font-size: 18px;">₱${(billingData.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
        <tr><td style="padding: 8px 0;"><strong>Due Date:</strong></td><td>${billingData.dueDate ? new Date(billingData.dueDate).toLocaleDateString() : "N/A"}</td></tr>
        ${billingData.isInstallationBill ? `<tr><td style="padding: 8px 0;"><strong>Bill Type:</strong></td><td>Installation Fee</td></tr>` : ""}
        ${billingData.isProRated ? `<tr><td style="padding: 8px 0;"><strong>Bill Type:</strong></td><td>Pro-rated First Bill</td></tr>` : billingData.isInstallationBill ? "" : `<tr><td style="padding: 8px 0;"><strong>Bill Type:</strong></td><td>Monthly Subscription</td></tr>`}
        <tr><td style="padding: 8px 0;"><strong>Status:</strong></td><td><span style="padding: 3px 10px; border-radius: 20px; font-size: 12px; ${billingData.status === "paid" ? "background-color: #d4edda; color: #155724;" : billingData.status === "overdue" ? "background-color: #f8d7da; color: #721c24;" : "background-color: #fff3cd; color: #856404;"}">${billingData.status?.toUpperCase() || "UNKNOWN"}</span></td></tr>
      </table>
      ${billingData.paymentLink ? `<div style="text-align: center; margin-top: 20px;"><a href="${billingData.paymentLink}" style="display: inline-block; background-color: #28a745; color: white; padding: 10px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;"> Pay Now</a></div>` : ""}
    </div>
  `
      : "";

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
            ${message.replace(/\n/g, "<br>")}
          </div>
          ${billingSection}
        </div>
        <div class="footer">
          <p>Mister Fyber - Your trusted internet provider</p>
          <p><small>Need help? Contact us at <a href="mailto:support@misterfyber.com">support@misterfyber.com</a></small></p>
        </div>
      </div>
    </html>
  `;
}

// ==================== GET CUSTOMERS FOR EMAIL SELECTION ====================
export const getCustomersForEmail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { search, status, hasBilling } = req.query;

    let query: any = {};

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { applicationId: { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const applications = await Application.find(query)
      .select(
        "firstName lastName email phoneNumber applicationId status buildingName buildingId",
      )
      .limit(100)
      .lean();

    // Enhance with billing info
    const enhancedCustomers = await Promise.all(
      applications.map(async (app) => {
        const billingCycle = await BillingCycle.findOne({
          applicationId: app.applicationId,
        }).lean();

        const hasUnpaidBills = await Billing.exists({
          applicationId: app.applicationId,
          status: { $in: ["sent", "overdue"] },
        });

        const lastBill = await Billing.findOne({
          applicationId: app.applicationId,
        })
          .sort({ createdAt: -1 })
          .lean();

        // Detect location from building name
        let location = "other";
        if (app.buildingName) {
          const buildingName = app.buildingName.toLowerCase().trim();
          if (buildingName.includes("breeze")) location = "breeze";
          else if (
            buildingName.includes("sil") ||
            buildingName.includes("silk")
          )
            location = "sil";
        }

        return {
          ...app,
          hasBilling: !!billingCycle,
          hasUnpaidBills: !!hasUnpaidBills,
          lastBillAmount: lastBill?.total || 0,
          lastBillStatus: lastBill?.status || null,
          location: location,
        };
      }),
    );

    // Filter by hasBilling if requested
    const filteredCustomers =
      hasBilling === "true"
        ? enhancedCustomers.filter((c) => c.hasBilling)
        : hasBilling === "false"
          ? enhancedCustomers.filter((c) => !c.hasBilling)
          : enhancedCustomers;

    res.status(200).json({
      success: true,
      data: filteredCustomers,
      total: filteredCustomers.length,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET BILLS FOR CUSTOMER ====================
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

    const bills = await Billing.find({
      applicationId: applicationId,
    })
      .sort({ createdAt: -1 })
      .lean();

    const customer = await Application.findOne({ applicationId })
      .select("firstName lastName email phoneNumber buildingName buildingId")
      .lean();

    res.status(200).json({
      success: true,
      data: {
        customer,
        bills,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== SEND MANUAL EMAIL ====================
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
      includeBilling,
      billId,
      sendCopyToAdmin,
      attachments,
      priority,
      useAdminSender,
    } = req.body;

    // Validate required fields
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

    // Get customer data
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

    // Get location from application - FIXED: Check buildingName directly
    let location = "";
    console.log(`🔍 Getting location for application: ${applicationId}`);
    console.log(`🏢 Building name: ${application.buildingName}`);

    if (application.buildingName) {
      const buildingName = application.buildingName.toLowerCase().trim();
      if (buildingName.includes("breeze")) {
        location = "breeze";
        console.log(
          `✅ Location detected: BREEZE from buildingName: ${application.buildingName}`,
        );
      } else if (
        buildingName.includes("sil") ||
        buildingName.includes("silk")
      ) {
        location = "sil";
        console.log(
          `✅ Location detected: SIL from buildingName: ${application.buildingName}`,
        );
      } else {
        console.log(`⚠️ Unknown building: ${application.buildingName}`);
      }
    }

    // If no location from buildingName, try buildingId
    if (!location && application.buildingId) {
      console.log(`🔍 Looking up building by ID: ${application.buildingId}`);
      const Building = require("../models/Building").default;
      const building = await Building.findById(application.buildingId).lean();
      if (building) {
        console.log(`🏢 Building found:`, building);
        if (building.name) {
          const buildingName = building.name.toLowerCase().trim();
          if (buildingName.includes("breeze")) {
            location = "breeze";
            console.log(
              `✅ Location detected: BREEZE from building name: ${building.name}`,
            );
          } else if (
            buildingName.includes("sil") ||
            buildingName.includes("silk")
          ) {
            location = "sil";
            console.log(
              `✅ Location detected: SIL from building name: ${building.name}`,
            );
          }
        }
        if (building.location) {
          location = building.location;
          console.log(`📍 Location from building: ${location}`);
        }
      }
    }

    console.log(
      `📍 Final location for ${applicationId}: ${location || "NOT FOUND"}`,
    );

    let billingData = null;
    let selectedBillId = null;
    if (includeBilling && billId) {
      billingData = await Billing.findById(billId).lean();
      selectedBillId = billId;
      if (!billingData) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";
      billingData.paymentLink = `${frontendUrl}/billing/${billingData._id}`;
    }

    // Determine sender info for preview
    let senderInfo = "";
    if (useAdminSender) {
      senderInfo = "Sent from: Admin (admin@misterfyber.com)";
    } else if (location) {
      const collectionEmail = getCollectionEmailByLocation(location);
      senderInfo = `Sent from: Collection (${collectionEmail})`;
    } else {
      senderInfo = "Sent from: Admin (admin@misterfyber.com)";
    }

    // Generate email HTML
    const emailHtml = generateEmailPreview(
      subject,
      message,
      includeBilling,
      billingData,
      application,
      senderInfo,
    );

    // Check if email service is configured
    const isConfigured = emailService.isConfigured();
    console.log(`📧 Email service configured: ${isConfigured}`);
    console.log(`📧 Using admin sender: ${useAdminSender ? "YES" : "NO"}`);
    console.log(`📧 Location: ${location || "NONE"}`);
    console.log(
      `📧 Collection email: ${location ? getCollectionEmailByLocation(location) : "NONE"}`,
    );

    // Send to customer with improved error handling
    let emailSent = false;
    let emailError = null;

    try {
      if (!isConfigured) {
        console.warn("⚠️ Email service not configured. Check BREVO_API_KEY.");
        console.warn(
          `   API Key: ${(emailService as any).apiKey ? "SET" : "MISSING"}`,
        );
        console.warn(
          `   API Key length: ${(emailService as any).apiKey?.length || 0}`,
        );

        if (process.env.NODE_ENV === "development") {
          console.log(
            `📧 [DEV MODE] Would send email to: ${application.email}`,
          );
          console.log(`   Subject: ${subject}`);
          console.log(`   Message preview: ${message.substring(0, 100)}...`);
          console.log(`   Use Admin Sender: ${useAdminSender ? "YES" : "NO"}`);
          console.log(`   Location: ${location || "NONE"}`);
          console.log(
            `   Would send from: ${useAdminSender ? "admin@misterfyber.com" : location ? getCollectionEmailByLocation(location) : "admin@misterfyber.com"}`,
          );
          emailSent = true;
        } else {
          throw new Error(
            "Email service is not configured. Please check BREVO_API_KEY in .env file.",
          );
        }
      } else {
        console.log(`📧 Attempting to send email to: ${application.email}`);
        emailSent = await emailService.sendEmail(
          application.email,
          subject,
          emailHtml,
          true, // isCustomerEmail
          location, // location for collection email
          {
            useAdminSender: useAdminSender === true,
          },
        );

        if (!emailSent) {
          console.warn(
            `⚠️ Email sending returned false for ${application.email}`,
          );
          emailError = "Email service returned false - check logs for details";
        } else {
          console.log(`✅ Email sent successfully to ${application.email}`);
          console.log(
            `   Sender: ${useAdminSender ? "admin@misterfyber.com" : location ? getCollectionEmailByLocation(location) : "admin@misterfyber.com"}`,
          );
          console.log(`   Location: ${location || "NONE"}`);
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
              <p><strong>Sender Type:</strong> ${useAdminSender ? "Admin" : "Collection"}</p>
              <p><strong>Location:</strong> ${location || "NONE"}</p>
              <p><strong>Collection Email:</strong> ${location ? getCollectionEmailByLocation(location) : "NONE"}</p>
              <hr>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                <h3>Message Content:</h3>
                <div>${message.replace(/\n/g, "<br>")}</div>
              </div>
              ${
                includeBilling && billingData
                  ? `
                <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 5px;">
                  <h3>Billing Information Included:</h3>
                  <p><strong>Invoice:</strong> ${billingData.invoiceNumber}</p>
                  <p><strong>Amount:</strong> ₱${(billingData.total || 0).toLocaleString()}</p>
                </div>
              `
                  : ""
              }
            </div>
          `;
          adminCopySent = await emailService.sendEmail(
            adminEmail,
            `[ADMIN COPY] ${subject}`,
            adminHtml,
            false, // isCustomerEmail
          );
        } catch (adminError) {
          console.error("Failed to send admin copy:", adminError);
        }
      }
    }

    // Save sent record
    const sentRecord = new EmailSentRecord({
      applicationId: application.applicationId,
      customerName: `${application.firstName} ${application.lastName}`,
      customerEmail: application.email,
      subject,
      message,
      sentAt: new Date(),
      status: emailSent ? "sent" : "failed",
      isBulk: false,
      recipientCount: 1,
      includeBilling: includeBilling || false,
      billId: selectedBillId,
      error: emailError || (emailSent ? undefined : "Failed to send email"),
      sentBy: req.user?.username || req.user?.email || "Admin",
      sentByEmail: req.user?.email || "admin@misterfyber.com",
      adminCopySent: adminCopySent || false,
      senderType: useAdminSender ? "admin" : "collection",
      location: location || "unknown",
      collectionEmail: location ? getCollectionEmailByLocation(location) : null,
    });

    await sentRecord.save({ session });

    await session.commitTransaction();

    // Return appropriate response
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
          environment: process.env.NODE_ENV,
          apiKeyPresent: !!(emailService as any).apiKey,
          apiKeyLength: (emailService as any).apiKey?.length || 0,
          location: location || "unknown",
          collectionEmail: location
            ? getCollectionEmailByLocation(location)
            : null,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: `Email sent successfully to ${application.firstName} ${application.lastName}`,
      data: {
        to: application.email,
        toName: `${application.firstName} ${application.lastName}`,
        subject,
        sentAt: new Date().toISOString(),
        adminCopySent,
        recordId: sentRecord._id,
        senderType: useAdminSender ? "admin" : "collection",
        location: location || "unknown",
        collectionEmail: location
          ? getCollectionEmailByLocation(location)
          : null,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== SEND BULK EMAILS ====================
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
      includeBilling,
      billType,
      sendCopyToAdmin,
      useAdminSender,
    } = req.body;

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

    // Check if email service is configured
    const isConfigured = emailService.isConfigured();
    if (!isConfigured && process.env.NODE_ENV !== "development") {
      return res.status(500).json({
        success: false,
        message: "Email service is not configured. Please check BREVO_API_KEY.",
        details: {
          isConfigured: false,
          environment: process.env.NODE_ENV,
          apiKeyPresent: !!(emailService as any).apiKey,
          apiKeyLength: (emailService as any).apiKey?.length || 0,
        },
      });
    }

    console.log(
      `📧 Bulk Email - Using admin sender: ${useAdminSender ? "YES" : "NO"}`,
    );

    const results = [];
    let successCount = 0;
    let failCount = 0;
    const sentRecords = [];
    const failedEmails = [];

    for (const applicationId of applicationIds) {
      try {
        const application = await Application.findOne({ applicationId }).lean();
        if (!application || !application.email) {
          results.push({
            applicationId,
            success: false,
            error: "Application not found or no email",
          });
          failCount++;
          continue;
        }

        // Get location from application - FIXED: Check buildingName directly
        let location = "";
        console.log(`🔍 Getting location for application: ${applicationId}`);
        console.log(`🏢 Building name: ${application.buildingName}`);

        if (application.buildingName) {
          const buildingName = application.buildingName.toLowerCase().trim();
          if (buildingName.includes("breeze")) {
            location = "breeze";
            console.log(
              `✅ Location detected: BREEZE from buildingName: ${application.buildingName}`,
            );
          } else if (
            buildingName.includes("sil") ||
            buildingName.includes("silk")
          ) {
            location = "sil";
            console.log(
              `✅ Location detected: SIL from buildingName: ${application.buildingName}`,
            );
          }
        }

        // If no location from buildingName, try buildingId
        if (!location && application.buildingId) {
          console.log(
            `🔍 Looking up building by ID: ${application.buildingId}`,
          );
          const Building = require("../models/Building").default;
          const building = await Building.findById(
            application.buildingId,
          ).lean();
          if (building) {
            if (building.name) {
              const buildingName = building.name.toLowerCase().trim();
              if (buildingName.includes("breeze")) {
                location = "breeze";
              } else if (
                buildingName.includes("sil") ||
                buildingName.includes("silk")
              ) {
                location = "sil";
              }
            }
            if (building.location) {
              location = building.location;
            }
          }
        }

        console.log(
          `📍 Final location for ${applicationId}: ${location || "NOT FOUND"}`,
        );

        let billingData = null;
        let selectedBillId = null;
        let selectedBillType = billType;

        if (includeBilling) {
          let billQuery: any = { applicationId: application.applicationId };
          if (billType === "unpaid") {
            billQuery.status = { $in: ["sent", "overdue"] };
          } else if (billType === "latest") {
            billingData = await Billing.findOne({
              applicationId: application.applicationId,
            })
              .sort({ createdAt: -1 })
              .lean();
          } else if (billType === "installation") {
            billQuery.isInstallationBill = true;
            billQuery.installationFeePaid = false;
          }

          if (!billingData && billType !== "latest") {
            billingData = await Billing.findOne(billQuery).lean();
          }

          if (billingData) {
            selectedBillId = billingData._id;
            const frontendUrl =
              process.env.FRONTEND_URL || "https://www.misterfyber.com";
            billingData.paymentLink = `${frontendUrl}/billing/${billingData._id}`;
          }
        }

        // Determine sender info for preview
        let senderInfo = "";
        if (useAdminSender) {
          senderInfo = "Sent from: Admin (admin@misterfyber.com)";
        } else if (location) {
          const collectionEmail = getCollectionEmailByLocation(location);
          senderInfo = `Sent from: Collection (${collectionEmail})`;
        } else {
          senderInfo = "Sent from: Admin (admin@misterfyber.com)";
        }

        const emailHtml = generateEmailPreview(
          subject,
          message,
          includeBilling && !!billingData,
          billingData,
          application,
          senderInfo,
        );

        let emailSent = false;
        let emailError = null;

        try {
          if (isConfigured || process.env.NODE_ENV === "development") {
            if (!isConfigured && process.env.NODE_ENV === "development") {
              console.log(
                `📧 [DEV MODE] Would send bulk email to: ${application.email}`,
              );
              console.log(`   Location: ${location || "NONE"}`);
              console.log(
                `   Sender: ${useAdminSender ? "admin@misterfyber.com" : location ? getCollectionEmailByLocation(location) : "admin@misterfyber.com"}`,
              );
              emailSent = true;
            } else {
              emailSent = await emailService.sendEmail(
                application.email,
                subject,
                emailHtml,
                true, // isCustomerEmail
                location, // location
                {
                  useAdminSender: useAdminSender === true,
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
          sentAt: new Date(),
          status: emailSent ? "sent" : "failed",
          isBulk: true,
          recipientCount: 1,
          includeBilling: includeBilling || false,
          billType: selectedBillType,
          billId: selectedBillId,
          error: emailError || (emailSent ? undefined : "Failed to send email"),
          sentBy: req.user?.username || req.user?.email || "Admin",
          sentByEmail: req.user?.email || "admin@misterfyber.com",
          adminCopySent: false,
          senderType: useAdminSender ? "admin" : "collection",
          location: location || "unknown",
          collectionEmail: location
            ? getCollectionEmailByLocation(location)
            : null,
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
            sender: useAdminSender
              ? "admin@misterfyber.com"
              : location
                ? getCollectionEmailByLocation(location)
                : "admin@misterfyber.com",
          });
          sentRecords.push(record);
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

        // Small delay to avoid rate limiting
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

    // Send admin summary if requested
    if (sendCopyToAdmin && successCount > 0) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
      if (adminEmail) {
        try {
          const summaryHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2>📧 Bulk Email Summary</h2>
              <p><strong>Subject:</strong> ${subject}</p>
              <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Sent By:</strong> ${req.user?.email || req.user?.username || "Admin"}</p>
              <p><strong>Sender Type:</strong> ${useAdminSender ? "Admin" : "Collection"}</p>
              <hr>
              <p><strong>✅ Successful:</strong> ${successCount}</p>
              <p><strong>❌ Failed:</strong> ${failCount}</p>
              <hr>
              <h3>Recipients:</h3>
              <ul>
                ${results
                  .filter((r) => r.success)
                  .map(
                    (r) =>
                      `<li>${r.name} (${r.email}) - Location: ${r.location || "unknown"} - Sender: ${r.sender}</li>`,
                  )
                  .join("")}
              </ul>
              ${
                failCount > 0
                  ? `
                <h3>Failed:</h3>
                <ul>
                  ${failedEmails
                    .map((r) => `<li>${r.name} (${r.email}) - ${r.error}</li>`)
                    .join("")}
                </ul>
              `
                  : ""
              }
            </div>
          `;
          await emailService.sendEmail(
            adminEmail,
            `[BULK EMAIL SUMMARY] ${subject}`,
            summaryHtml,
            false, // isCustomerEmail
          );
        } catch (adminError) {
          console.error("Failed to send admin summary:", adminError);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Bulk email completed. Sent: ${successCount}, Failed: ${failCount}`,
      data: {
        total: applicationIds.length,
        successCount,
        failCount,
        results,
        failedEmails: failCount > 0 ? failedEmails : undefined,
        senderType: useAdminSender ? "admin" : "collection",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== SAVE EMAIL TEMPLATE ====================
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

    // Check if template with same name exists
    const existingTemplate = await EmailTemplate.findOne({ name });
    if (existingTemplate) {
      // Update existing template
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

    // Create new template
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

// ==================== GET EMAIL TEMPLATES ====================
export const getEmailTemplates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { category, search } = req.query;

    let query: any = {};

    if (category && category !== "all") {
      query.category = category;
    }

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

    // Format to match frontend interface
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

// ==================== UPDATE EMAIL TEMPLATE ====================
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

    // Check if new name conflicts with existing template (excluding current)
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

// ==================== DELETE EMAIL TEMPLATE ====================
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

// ==================== PREVIEW EMAIL ====================
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
      includeBilling,
      applicationId,
      billId,
      useAdminSender,
    } = req.body;

    let customerData = null;
    let billingData = null;
    let location = "";

    if (applicationId) {
      customerData = await Application.findOne({ applicationId }).lean();
      if (customerData) {
        // Get location from buildingName directly
        if (customerData.buildingName) {
          const buildingName = customerData.buildingName.toLowerCase().trim();
          if (buildingName.includes("breeze")) {
            location = "breeze";
          } else if (
            buildingName.includes("sil") ||
            buildingName.includes("silk")
          ) {
            location = "sil";
          }
        }
        // If no location, try buildingId
        if (!location && customerData.buildingId) {
          const Building = require("../models/Building").default;
          const building = await Building.findById(
            customerData.buildingId,
          ).lean();
          if (building) {
            if (building.name) {
              const buildingName = building.name.toLowerCase().trim();
              if (buildingName.includes("breeze")) location = "breeze";
              else if (
                buildingName.includes("sil") ||
                buildingName.includes("silk")
              )
                location = "sil";
            }
            if (building.location) location = building.location;
          }
        }
        console.log(
          `📍 Preview location for ${applicationId}: ${location || "NOT FOUND"}`,
        );
      }
    }

    if (includeBilling && billId) {
      billingData = await Billing.findById(billId).lean();
      if (billingData) {
        const frontendUrl =
          process.env.FRONTEND_URL || "https://www.misterfyber.com";
        billingData.paymentLink = `${frontendUrl}/billing/${billingData._id}`;
      }
    }

    // Determine sender info for preview
    let senderInfo = "";
    if (useAdminSender) {
      senderInfo = "Sent from: Admin (admin@misterfyber.com)";
    } else if (location) {
      const collectionEmail = getCollectionEmailByLocation(location);
      senderInfo = `Sent from: Collection (${collectionEmail})`;
    } else {
      senderInfo = "Sent from: Admin (admin@misterfyber.com)";
    }

    const previewHtml = generateEmailPreview(
      subject,
      message,
      includeBilling,
      billingData,
      customerData,
      senderInfo,
    );

    res.status(200).json({
      success: true,
      data: {
        html: previewHtml,
        subject,
        message,
        location: location || "unknown",
        senderInfo: senderInfo,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== SEND REMINDER TO ALL WITH UNPAID BILLS ====================
export const sendReminderToUnpaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { customMessage, includeDueDateReminder, useAdminSender } = req.body;

    // Check if email service is configured
    const isConfigured = emailService.isConfigured();
    if (!isConfigured && process.env.NODE_ENV !== "development") {
      return res.status(500).json({
        success: false,
        message: "Email service is not configured. Please check BREVO_API_KEY.",
        details: {
          isConfigured: false,
          environment: process.env.NODE_ENV,
        },
      });
    }

    console.log(
      `📧 Reminder to Unpaid - Using admin sender: ${useAdminSender ? "YES" : "NO"}`,
    );

    // Find all applications with unpaid bills
    const unpaidBills = await Billing.find({
      status: { $in: ["sent", "overdue"] },
      isInstallationBill: false,
    })
      .sort({ dueDate: 1 })
      .lean();

    const uniqueApplicationIds = [
      ...new Set(unpaidBills.map((bill) => bill.applicationId)),
    ];

    const results = [];
    let sentCount = 0;
    let failCount = 0;
    const sentRecords = [];
    const failedEmails = [];

    for (const applicationId of uniqueApplicationIds) {
      if (!applicationId) continue;

      const application = await Application.findOne({ applicationId }).lean();
      if (!application || !application.email) continue;

      // Get location from buildingName directly
      let location = "";
      if (application.buildingName) {
        const buildingName = application.buildingName.toLowerCase().trim();
        if (buildingName.includes("breeze")) {
          location = "breeze";
        } else if (
          buildingName.includes("sil") ||
          buildingName.includes("silk")
        ) {
          location = "sil";
        }
      }
      if (!location && application.buildingId) {
        const Building = require("../models/Building").default;
        const building = await Building.findById(application.buildingId).lean();
        if (building) {
          if (building.name) {
            const buildingName = building.name.toLowerCase().trim();
            if (buildingName.includes("breeze")) location = "breeze";
            else if (
              buildingName.includes("sil") ||
              buildingName.includes("silk")
            )
              location = "sil";
          }
          if (building.location) location = building.location;
        }
      }

      const customerBills = unpaidBills.filter(
        (bill) => bill.applicationId === applicationId,
      );
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

      // Determine sender info
      let senderInfo = "";
      if (useAdminSender) {
        senderInfo = "Sent from: Admin (admin@misterfyber.com)";
      } else if (location) {
        const collectionEmail = getCollectionEmailByLocation(location);
        senderInfo = `Sent from: Collection (${collectionEmail})`;
      } else {
        senderInfo = "Sent from: Admin (admin@misterfyber.com)";
      }

      const emailHtml = generateEmailPreview(
        "Payment Reminder - Unpaid Bill(s)",
        reminderMessage,
        true,
        customerBills[0],
        application,
        senderInfo,
      );

      let emailSent = false;
      let emailError = null;

      try {
        if (isConfigured || process.env.NODE_ENV === "development") {
          if (!isConfigured && process.env.NODE_ENV === "development") {
            console.log(
              `📧 [DEV MODE] Would send reminder to: ${application.email}`,
            );
            console.log(`   Location: ${location || "NONE"}`);
            console.log(
              `   Sender: ${useAdminSender ? "admin@misterfyber.com" : location ? getCollectionEmailByLocation(location) : "admin@misterfyber.com"}`,
            );
            emailSent = true;
          } else {
            emailSent = await emailService.sendEmail(
              application.email,
              `⚠️ Payment Reminder - ${customerBills.length} Unpaid Bill(s)`,
              emailHtml,
              true, // isCustomerEmail
              location, // location
              {
                useAdminSender: useAdminSender === true,
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
        billId: customerBills[0]?._id,
        error:
          emailError || (emailSent ? undefined : "Failed to send reminder"),
        sentBy: req.user?.username || req.user?.email || "Admin",
        sentByEmail: req.user?.email || "admin@misterfyber.com",
        adminCopySent: false,
        senderType: useAdminSender ? "admin" : "collection",
        location: location || "unknown",
        collectionEmail: location
          ? getCollectionEmailByLocation(location)
          : null,
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
          sender: useAdminSender
            ? "admin@misterfyber.com"
            : location
              ? getCollectionEmailByLocation(location)
              : "admin@misterfyber.com",
        });
        sentRecords.push(record);
      } else {
        failCount++;
        failedEmails.push({
          applicationId,
          email: application.email,
          name: `${application.firstName} ${application.lastName}`,
          error: emailError || "Failed to send reminder",
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    res.status(200).json({
      success: true,
      message: `Sent reminders to ${sentCount} customers with unpaid bills (${failCount} failed)`,
      data: {
        sentCount,
        failCount,
        totalCustomers: uniqueApplicationIds.length,
        results,
        failedEmails: failCount > 0 ? failedEmails : undefined,
        senderType: useAdminSender ? "admin" : "collection",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET SENT EMAIL RECORDS ====================
export const getSentRecords = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { applicationId, status, isBulk } = req.query;

    let query: any = {};

    if (applicationId) {
      query.applicationId = applicationId;
    }

    if (status) {
      query.status = status;
    }

    if (isBulk !== undefined) {
      query.isBulk = isBulk === "true";
    }

    const records = await EmailSentRecord.find(query)
      .sort({ sentAt: -1 })
      .limit(200)
      .lean();

    // Transform to match frontend interface
    const formattedRecords = records.map((record) => ({
      id: record._id.toString(),
      applicationId: record.applicationId,
      customerName: record.customerName,
      customerEmail: record.customerEmail,
      subject: record.subject,
      message: record.message,
      sentAt: record.sentAt,
      status: record.status,
      isBulk: record.isBulk,
      recipientCount: record.recipientCount || 1,
      includeBilling: record.includeBilling,
      billType: record.billType,
      error: record.error,
      senderType: (record as any).senderType || "collection",
      location: (record as any).location || "unknown",
      collectionEmail: (record as any).collectionEmail || null,
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

// ==================== DELETE SENT RECORD ====================
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

export default {
  getCustomersForEmail,
  getCustomerBills,
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
};
