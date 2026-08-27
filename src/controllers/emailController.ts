// backend/src/controllers/manualEmailController.ts

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

// Generate email preview HTML with support for multiple bills and rich text
function generateEmailPreview(
  subject: string,
  message: string,
  includeBilling: boolean,
  billingDataArray: any[] = [],
  customerData?: any,
  senderInfo?: string,
  richTextContent?: string,
): string {
  // Use rich text content if provided, otherwise use plain message
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

  // Build billing section for multiple bills
  let billingSection = "";
  if (includeBilling && billingDataArray && billingDataArray.length > 0) {
    const totalAmount = billingDataArray.reduce(
      (sum, bill) => sum + (bill.total || 0),
      0,
    );

    let billsHtml = "";
    billingDataArray.forEach((bill, index) => {
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
          <p><small>Need help? Contact us at <a href="mailto:admin@misterfyber.com">admin@misterfyber.com</a></small></p>
        </div>
      </div>
    </body>
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
    const { search, status, hasBilling, forceRefresh, location } = req.query;

    // Set no-cache headers
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
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

    if (status) {
      query.status = status;
    }

    // Location filter
    if (location && location !== "all") {
      if (location === "breeze") {
        query.buildingName = { $regex: "breeze", $options: "i" };
      } else if (location === "sil") {
        query.buildingName = { $regex: /sil|silk/, $options: "i" };
      } else if (location === "other") {
        query.buildingName = {
          $not: {
            $regex: /breeze|sil|silk/,
            $options: "i",
          },
        };
      }
    }

    const applications = await Application.find(query)
      .select(
        "firstName lastName email phoneNumber applicationId status buildingName buildingId",
      )
      .lean()
      .sort({ createdAt: -1 });

    console.log(
      `📊 Found ${applications.length} applications for email selection`,
    );

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
          _fetchedAt: new Date().toISOString(),
        };
      }),
    );

    const filteredCustomers =
      hasBilling === "true"
        ? enhancedCustomers.filter((c) => c.hasBilling)
        : hasBilling === "false"
          ? enhancedCustomers.filter((c) => !c.hasBilling)
          : enhancedCustomers;

    console.log(
      `✅ Returning ${filteredCustomers.length} customers (fresh data)`,
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

// ==================== GET CUSTOMER BILLS ====================
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
        timestamp: new Date().toISOString(),
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
      richTextContent,
      includeBilling,
      billIds,
      sendCopyToAdmin,
      attachments,
      priority,
      useAdminSender,
    } = req.body;

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

    // Get location
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

    // Fetch multiple bills
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

    // Generate email HTML with rich text support
    const emailHtml = generateEmailPreview(
      subject,
      message,
      includeBilling && billingDataArray.length > 0,
      billingDataArray,
      application,
      senderInfo,
      richTextContent,
    );

    // Check if email service is configured
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
            useAdminSender: useAdminSender === true,
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
          const totalAmount = billingDataArray.reduce(
            (sum, bill) => sum + (bill.total || 0),
            0,
          );

          let billsSummary = "";
          billingDataArray.forEach((bill) => {
            billsSummary += `
              <li>${bill.invoiceNumber || "N/A"} - ₱${(bill.total || 0).toLocaleString()} (${bill.status || "N/A"})</li>
            `;
          });

          const adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #007bff;">📧 Admin Copy - Manual Email Sent</h2>
              <p><strong>Sent To:</strong> ${application.firstName} ${application.lastName} (${application.email})</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Sent By:</strong> ${req.user?.email || req.user?.username || "Admin"}</p>
              <p><strong>Sender Type:</strong> ${useAdminSender ? "Admin" : "Collection"}</p>
              <p><strong>Location:</strong> ${location || "NONE"}</p>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                <h3>Message Content:</h3>
                <div>${richTextContent || message.replace(/\n/g, "<br>")}</div>
              </div>
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

    // Save sent record
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
      senderType: useAdminSender ? "admin" : "collection",
      location: location || "unknown",
      collectionEmail: location ? getCollectionEmailByLocation(location) : null,
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
      richTextContent,
      includeBilling,
      billType,
      sendCopyToAdmin,
      useAdminSender,
      locationFilter,
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

    const isConfigured = emailService.isConfigured();
    if (!isConfigured && process.env.NODE_ENV !== "development") {
      return res.status(500).json({
        success: false,
        message: "Email service is not configured.",
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
          const building = await Building.findById(
            application.buildingId,
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
            if (building.location) {
              location = building.location;
            }
          }
        }

        // If location filter is applied, skip non-matching
        if (locationFilter && locationFilter !== "all") {
          if (location !== locationFilter) {
            console.log(
              `⏭️ Skipping ${applicationId} - location ${location} doesn't match filter ${locationFilter}`,
            );
            continue;
          }
        }

        let billingDataArray: any[] = [];
        let selectedBillIds: string[] = [];
        let selectedBillType = billType;

        if (includeBilling) {
          let billQuery: any = { applicationId: application.applicationId };
          if (billType === "unpaid") {
            billQuery.status = { $in: ["sent", "overdue"] };
          } else if (billType === "latest") {
            const latestBill = await Billing.findOne({
              applicationId: application.applicationId,
            })
              .sort({ createdAt: -1 })
              .lean();
            if (latestBill) {
              billingDataArray = [latestBill];
              selectedBillIds = [latestBill._id];
            }
          } else if (billType === "installation") {
            billQuery.isInstallationBill = true;
            billQuery.installationFeePaid = false;
          }

          if (billingDataArray.length === 0 && billType !== "latest") {
            const bills = await Billing.find(billQuery).lean();
            billingDataArray = bills;
            selectedBillIds = bills.map((b) => b._id);
          }

          if (billingDataArray.length > 0) {
            const frontendUrl =
              process.env.FRONTEND_URL || "https://www.misterfyber.com";
            billingDataArray = billingDataArray.map((bill) => ({
              ...bill,
              paymentLink: `${frontendUrl}/billing/${bill._id}`,
            }));
          }
        }

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
          includeBilling && billingDataArray.length > 0,
          billingDataArray,
          application,
          senderInfo,
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
          richTextContent: richTextContent || message,
          sentAt: new Date(),
          status: emailSent ? "sent" : "failed",
          isBulk: true,
          recipientCount: 1,
          includeBilling: includeBilling || false,
          billType: selectedBillType,
          billIds: selectedBillIds,
          billCount: billingDataArray.length,
          error: emailError || (emailSent ? undefined : "Failed to send email"),
          sentBy: req.user?.username || req.user?.email || "Admin",
          sentByEmail: req.user?.email || "admin@misterfyber.com",
          adminCopySent: false,
          senderType: useAdminSender ? "admin" : "collection",
          location: location || "unknown",
          collectionEmail: location
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
            billsIncluded: billingDataArray.length,
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
                      `<li>${r.name} (${r.email}) - Location: ${r.location || "unknown"} - Bills: ${r.billsIncluded || 0}</li>`,
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
            false,
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

// ==================== GET EMAIL TEMPLATES ====================
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
      richTextContent,
      includeBilling,
      applicationId,
      billIds,
      useAdminSender,
    } = req.body;

    let customerData = null;
    let billingDataArray: any[] = [];
    let location = "";

    if (applicationId) {
      customerData = await Application.findOne({ applicationId }).lean();
      if (customerData) {
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
      includeBilling && billingDataArray.length > 0,
      billingDataArray,
      customerData,
      senderInfo,
      richTextContent,
    );

    res.status(200).json({
      success: true,
      data: {
        html: previewHtml,
        subject,
        message,
        location: location || "unknown",
        senderInfo: senderInfo,
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

// ==================== SEND REMINDER TO UNPAID ====================
export const sendReminderToUnpaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { customMessage, includeDueDateReminder, useAdminSender } = req.body;

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

    const results = [];
    let sentCount = 0;
    let failCount = 0;

    for (const applicationId of uniqueApplicationIds) {
      if (!applicationId) continue;

      const application = await Application.findOne({ applicationId }).lean();
      if (!application || !application.email) continue;

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
        customerBills,
        application,
        senderInfo,
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
        billIds: customerBills.map((b) => b._id),
        billCount: customerBills.length,
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
        });
      } else {
        failCount++;
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
        senderType: useAdminSender ? "admin" : "collection",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET SENT RECORDS ====================
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

    if (applicationId) {
      query.applicationId = applicationId;
    }

    if (status) {
      query.status = status;
    }

    if (isBulk !== undefined) {
      query.isBulk = isBulk === "true";
    }

    if (scheduleId) {
      query.scheduleId = scheduleId;
    }

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

// ==================== SCHEDULE EMAIL - FIXED (NO TIMEZONE CONVERSION) ====================
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
      billType,
      sendCopyToAdmin,
      useAdminSender,
      scheduledFor,
      locationFilter,
      recurring,
    } = req.body;

    // Validation
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

    // ============================================================
    // FIX: Use the date as-is from frontend
    // Frontend already sends the correct UTC time
    // ============================================================
    const scheduleDate = new Date(scheduledFor);

    console.log(`📅 Schedule date received: ${scheduledFor}`);
    console.log(`📅 Date object: ${scheduleDate.toISOString()}`);
    console.log(`📅 Local time would be: ${scheduleDate.toLocaleString()}`);

    // Check if schedule time is in the future
    const now = new Date();
    if (scheduleDate <= now) {
      console.warn(
        `⚠️ Schedule time is in the past: ${scheduleDate.toISOString()}`,
      );
      // Still allow it for testing
    }

    // If no specific application IDs, use location filter to find customers
    let targetApplicationIds = applicationIds || [];
    if (targetApplicationIds.length === 0 && locationFilter) {
      let query: any = {};
      if (locationFilter === "breeze") {
        query.buildingName = { $regex: "breeze", $options: "i" };
      } else if (locationFilter === "sil") {
        query.buildingName = { $regex: /sil|silk/, $options: "i" };
      } else if (locationFilter === "other") {
        query.buildingName = {
          $not: {
            $regex: /breeze|sil|silk/,
            $options: "i",
          },
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

    // Create schedule with the date as-is (no conversion)
    const schedule = new EmailSchedule({
      name,
      applicationIds: targetApplicationIds,
      subject,
      message,
      richTextContent: richTextContent || message,
      includeBilling: includeBilling || false,
      billType: billType || "unpaid",
      sendCopyToAdmin: sendCopyToAdmin || false,
      useAdminSender: useAdminSender || false,
      scheduledFor: scheduleDate, // Use as-is, no conversion
      status: "pending",
      totalRecipients: targetApplicationIds.length,
      createdBy: req.user?.username || req.user?.email || "Admin",
      createdByEmail: req.user?.email || "admin@misterfyber.com",
      locationFilter: locationFilter || "all",
      recurring: recurring || { enabled: false },
    });

    await schedule.save();

    console.log(`✅ Email scheduled at: ${scheduleDate.toISOString()}`);
    console.log(`✅ Local time: ${scheduleDate.toLocaleString()}`);

    res.status(200).json({
      success: true,
      message: `Email scheduled successfully for ${scheduleDate.toLocaleString()}`,
      data: {
        scheduleId: schedule._id,
        name: schedule.name,
        scheduledFor: schedule.scheduledFor,
        totalRecipients: schedule.totalRecipients,
        status: schedule.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET SCHEDULED EMAILS ====================
export const getScheduledEmails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { status, page = 1, limit = 50 } = req.query;

    const query: any = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 50;
    const skip = (pageNum - 1) * limitNum;

    const schedules = await EmailSchedule.find(query)
      .sort({ scheduledFor: 1 })
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
      billType: schedule.billType,
      sendCopyToAdmin: schedule.sendCopyToAdmin,
      useAdminSender: schedule.useAdminSender,
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

// ==================== UPDATE SCHEDULED EMAIL ====================
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

    // Don't allow updates to cancelled or completed schedules
    if (schedule.status === "cancelled" || schedule.status === "sent") {
      return res.status(400).json({
        success: false,
        message: `Cannot update a ${schedule.status} schedule`,
      });
    }

    // Update fields
    const allowedFields = [
      "name",
      "subject",
      "message",
      "richTextContent",
      "includeBilling",
      "billType",
      "sendCopyToAdmin",
      "useAdminSender",
      "scheduledFor",
      "locationFilter",
      "recurring",
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (schedule as any)[field] = updates[field];
      }
    }

    // If scheduledFor is updated, use as-is
    if (updates.scheduledFor) {
      const newDate = new Date(updates.scheduledFor);
      if (newDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Scheduled time must be in the future",
        });
      }
      schedule.scheduledFor = newDate;
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

// ==================== DELETE SCHEDULED EMAIL ====================
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

    // Only allow deletion of pending schedules
    if (schedule.status === "processing") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a processing schedule",
      });
    }

    // Update status to cancelled instead of deleting
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

// ==================== CANCEL SCHEDULED EMAIL ====================
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

// ==================== GET SCHEDULE STATS ====================
export const getScheduleStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const pending = await EmailSchedule.countDocuments({ status: "pending" });
    const processing = await EmailSchedule.countDocuments({
      status: "processing",
    });
    const sent = await EmailSchedule.countDocuments({ status: "sent" });
    const failed = await EmailSchedule.countDocuments({ status: "failed" });
    const cancelled = await EmailSchedule.countDocuments({
      status: "cancelled",
    });

    // Get total scheduled recipients
    const schedules = await EmailSchedule.find({
      status: { $in: ["pending", "processing", "sent"] },
    }).lean();

    let totalRecipients = 0;
    for (const schedule of schedules) {
      totalRecipients += schedule.totalRecipients || 0;
    }

    // Get upcoming schedules
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

// ==================== FORCE PROCESS SCHEDULES ====================
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

// ==================== EXPORT ====================
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
  scheduleEmail,
  getScheduledEmails,
  updateScheduledEmail,
  deleteScheduledEmail,
  cancelScheduledEmail,
  getScheduleStats,
  forceProcessSchedules,
};
