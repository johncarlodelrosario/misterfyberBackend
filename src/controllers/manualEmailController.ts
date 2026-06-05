import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Application from "../models/Application";
import User from "../models/User";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import emailService from "../services/emailService";
import { IUser } from "../models/User";

type AuthRequest = Request & { user?: any };

// Email templates storage (you can store these in database)
const emailTemplates: Record<string, any> = {};

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
): string {
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
      ${billingData.paymentLink ? `<div style="text-align: center; margin-top: 20px;"><a href="${billingData.paymentLink}" style="display: inline-block; background-color: #28a745; color: white; padding: 10px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">💰 Pay Now</a></div>` : ""}
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
      .select("firstName lastName email phoneNumber applicationId status")
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

        return {
          ...app,
          hasBilling: !!billingCycle,
          hasUnpaidBills: !!hasUnpaidBills,
          lastBillAmount: lastBill?.total || 0,
          lastBillStatus: lastBill?.status || null,
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
      .select("firstName lastName email phoneNumber")
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

    let billingData = null;
    if (includeBilling && billId) {
      billingData = await Billing.findById(billId).lean();
      if (!billingData) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      // Add payment link
      const frontendUrl =
        process.env.FRONTEND_URL || "https://www.misterfyber.com";
      billingData.paymentLink = `${frontendUrl}/billing/${billingData._id}`;
    }

    // Generate email HTML
    const emailHtml = generateEmailPreview(
      subject,
      message,
      includeBilling,
      billingData,
      application,
    );

    // Send to customer - USE forceSendEmail to bypass customer email setting
    const emailSent = await emailService.forceSendEmail(
      application.email,
      subject,
      emailHtml,
    );

    if (!emailSent) {
      await session.abortTransaction();
      return res.status(500).json({
        success: false,
        message:
          "Failed to send email. Please check email service configuration.",
      });
    }

    // Send copy to admin if requested
    let adminCopySent = false;
    if (sendCopyToAdmin) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
      if (adminEmail) {
        const adminHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #007bff;">📧 Admin Copy - Manual Email Sent</h2>
            <p><strong>Sent To:</strong> ${application.firstName} ${application.lastName} (${application.email})</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Sent By:</strong> ${req.user?.email || req.user?.username || "Admin"}</p>
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
          false,
        );
      }
    }

    // Log the email in database (optional - you can create an EmailLog model)
    // For now, we'll just log to console
    console.log(`📧 Manual email sent to ${application.email}: ${subject}`);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `Email sent successfully to ${application.firstName} ${application.lastName}`,
      data: {
        to: application.email,
        toName: `${application.firstName} ${application.lastName}`,
        subject,
        sentAt: new Date().toISOString(),
        adminCopySent,
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

    const results = [];
    let successCount = 0;
    let failCount = 0;

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

        let billingData = null;
        if (includeBilling) {
          let billQuery: any = { applicationId: application.applicationId };
          if (billType === "unpaid") {
            billQuery.status = { $in: ["sent", "overdue"] };
          } else if (billType === "latest") {
            // Get latest bill
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
        }

        const emailHtml = generateEmailPreview(
          subject,
          message,
          includeBilling && !!billingData,
          billingData,
          application,
        );

        // Use forceSendEmail for bulk emails as well
        const emailSent = await emailService.forceSendEmail(
          application.email,
          subject,
          emailHtml,
        );

        if (emailSent) {
          successCount++;
          results.push({
            applicationId,
            email: application.email,
            name: `${application.firstName} ${application.lastName}`,
            success: true,
          });
        } else {
          failCount++;
          results.push({
            applicationId,
            email: application.email,
            success: false,
            error: "Email sending failed",
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
        const summaryHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>📧 Bulk Email Summary</h2>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Sent By:</strong> ${req.user?.email || req.user?.username || "Admin"}</p>
            <hr>
            <p><strong>✅ Successful:</strong> ${successCount}</p>
            <p><strong>❌ Failed:</strong> ${failCount}</p>
            <hr>
            <h3>Recipients:</h3>
            <ul>
              ${results
                .filter((r) => r.success)
                .map((r) => `<li>${r.name} (${r.email})</li>`)
                .join("")}
            </ul>
            ${
              failCount > 0
                ? `
              <h3>Failed:</h3>
              <ul>
                ${results
                  .filter((r) => !r.success)
                  .map(
                    (r) =>
                      `<li>Application: ${r.applicationId} - ${r.error}</li>`,
                  )
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

    const templateId = name.toLowerCase().replace(/\s+/g, "_");
    emailTemplates[templateId] = {
      id: templateId,
      name,
      subject,
      message,
      category: category || "general",
      includeBillingDefault: includeBillingDefault || false,
      createdAt: new Date().toISOString(),
      updatedBy: req.user?.email || req.user?.username,
    };

    res.status(200).json({
      success: true,
      message: `Template "${name}" saved successfully`,
      data: emailTemplates[templateId],
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
    const templates = Object.values(emailTemplates);
    res.status(200).json({
      success: true,
      data: templates,
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

    if (!emailTemplates[templateId]) {
      return res.status(404).json({
        success: false,
        message: "Template not found",
      });
    }

    delete emailTemplates[templateId];

    res.status(200).json({
      success: true,
      message: "Template deleted successfully",
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
    const { subject, message, includeBilling, applicationId, billId } =
      req.body;

    let customerData = null;
    let billingData = null;

    if (applicationId) {
      customerData = await Application.findOne({ applicationId }).lean();
    }

    if (includeBilling && billId) {
      billingData = await Billing.findById(billId).lean();
      if (billingData) {
        const frontendUrl =
          process.env.FRONTEND_URL || "https://www.misterfyber.com";
        billingData.paymentLink = `${frontendUrl}/billing/${billingData._id}`;
      }
    }

    const previewHtml = generateEmailPreview(
      subject,
      message,
      includeBilling,
      billingData,
      customerData,
    );

    res.status(200).json({
      success: true,
      data: {
        html: previewHtml,
        subject,
        message,
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
    const { customMessage, includeDueDateReminder } = req.body;

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

    for (const applicationId of uniqueApplicationIds) {
      if (!applicationId) continue;

      const application = await Application.findOne({ applicationId }).lean();
      if (!application || !application.email) continue;

      const customerBills = unpaidBills.filter(
        (bill) => bill.applicationId === applicationId,
      );
      const totalAmount = customerBills.reduce(
        (sum, bill) => sum + (bill.total || 0),
        0,
      );

      // Fix: Properly find the earliest due date
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

      const emailHtml = generateEmailPreview(
        "Payment Reminder - Unpaid Bill(s)",
        reminderMessage,
        true,
        customerBills[0], // Show the most urgent bill
        application,
      );

      // Use forceSendEmail for reminders as well
      const sent = await emailService.forceSendEmail(
        application.email,
        `⚠️ Payment Reminder - ${customerBills.length} Unpaid Bill(s)`,
        emailHtml,
      );

      if (sent) {
        sentCount++;
        results.push({
          applicationId,
          email: application.email,
          name: `${application.firstName} ${application.lastName}`,
          billsCount: customerBills.length,
          totalAmount,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    res.status(200).json({
      success: true,
      message: `Sent reminders to ${sentCount} customers with unpaid bills`,
      data: {
        sentCount,
        totalCustomers: uniqueApplicationIds.length,
        results,
      },
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
  deleteEmailTemplate,
  previewEmail,
  sendReminderToUnpaid,
};
