// backend/src/services/schedulerService.ts

import mongoose from "mongoose";
import EmailSchedule from "../models/EmailSchedule";
import EmailSentRecord from "../models/EmailSentRecord";
import Application from "../models/Application";
import Billing from "../models/Billing";
import emailService, { getCollectionEmailByLocation } from "./emailService";

// Generate email preview HTML
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
    </html>
  `;
}

/**
 * Process a single scheduled email
 */
async function processScheduledEmail(schedule: any): Promise<void> {
  console.log(
    `📧 Processing scheduled email: ${schedule._id} - ${schedule.name}`,
  );

  // Update status to processing
  schedule.status = "processing";
  schedule.lastRunAt = new Date();
  await schedule.save();

  let sentCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  const applicationIds = schedule.applicationIds || [];

  for (const applicationId of applicationIds) {
    try {
      const application = await Application.findOne({ applicationId }).lean();
      if (!application || !application.email) {
        failedCount++;
        errors.push(`Application ${applicationId} not found or no email`);
        continue;
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

      // Fetch bills if needed
      let billingDataArray: any[] = [];
      if (schedule.includeBilling) {
        let billQuery: any = { applicationId: application.applicationId };
        if (schedule.billType === "unpaid") {
          billQuery.status = { $in: ["sent", "overdue"] };
        } else if (schedule.billType === "latest") {
          const latestBill = await Billing.findOne({
            applicationId: application.applicationId,
          })
            .sort({ createdAt: -1 })
            .lean();
          if (latestBill) {
            billingDataArray = [latestBill];
          }
        } else if (schedule.billType === "installation") {
          billQuery.isInstallationBill = true;
          billQuery.installationFeePaid = false;
        }

        if (billingDataArray.length === 0 && schedule.billType !== "latest") {
          const bills = await Billing.find(billQuery).lean();
          billingDataArray = bills;
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
      if (schedule.useAdminSender) {
        senderInfo = "Sent from: Admin (admin@misterfyber.com)";
      } else if (location) {
        const collectionEmail = getCollectionEmailByLocation(location);
        senderInfo = `Sent from: Collection (${collectionEmail})`;
      } else {
        senderInfo = "Sent from: Admin (admin@misterfyber.com)";
      }

      const emailHtml = generateEmailPreview(
        schedule.subject,
        schedule.message,
        schedule.includeBilling && billingDataArray.length > 0,
        billingDataArray,
        application,
        senderInfo,
        schedule.richTextContent,
      );

      let emailSent = false;
      let emailError = null;

      try {
        emailSent = await emailService.sendEmail(
          application.email,
          schedule.subject,
          emailHtml,
          true,
          location,
          {
            useAdminSender: schedule.useAdminSender === true,
          },
        );

        if (!emailSent) {
          emailError = "Email service returned false";
        }
      } catch (error: any) {
        emailError = error.message || "Email service error";
        console.error(`Failed to send email to ${application.email}:`, error);
      }

      // Save sent record
      const record = new EmailSentRecord({
        applicationId: application.applicationId,
        customerName: `${application.firstName} ${application.lastName}`,
        customerEmail: application.email,
        subject: schedule.subject,
        message: schedule.message,
        richTextContent: schedule.richTextContent || schedule.message,
        sentAt: new Date(),
        status: emailSent ? "sent" : "failed",
        isBulk: true,
        recipientCount: 1,
        includeBilling: schedule.includeBilling || false,
        billType: schedule.billType,
        billCount: billingDataArray.length,
        error: emailError || (emailSent ? undefined : "Failed to send email"),
        sentBy: schedule.createdBy || "Scheduler",
        sentByEmail: schedule.createdByEmail || "scheduler@misterfyber.com",
        adminCopySent: false,
        senderType: schedule.useAdminSender ? "admin" : "collection",
        location: location || "unknown",
        collectionEmail: location
          ? getCollectionEmailByLocation(location)
          : null,
        isScheduled: true,
        scheduleId: schedule._id.toString(),
      });

      await record.save();

      if (emailSent) {
        sentCount++;
      } else {
        failedCount++;
        errors.push(`Failed to send to ${application.email}: ${emailError}`);
      }

      // Add small delay between emails
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error: any) {
      failedCount++;
      errors.push(`Error processing ${applicationId}: ${error.message}`);
      console.error(`Error processing ${applicationId}:`, error);
    }
  }

  // Update schedule
  schedule.sentCount = sentCount;
  schedule.failedCount = failedCount;

  if (failedCount > 0 && sentCount === 0) {
    schedule.status = "failed";
    schedule.error = errors.join("; ");
  } else if (failedCount > 0) {
    schedule.status = "sent";
    schedule.error = `Partial failure: ${failedCount} failed. ${errors.join("; ")}`;
  } else {
    schedule.status = "sent";
    schedule.error = undefined;
  }

  schedule.completedAt = new Date();
  await schedule.save();

  console.log(
    `✅ Scheduled email complete: ${schedule._id} - Sent: ${sentCount}, Failed: ${failedCount}`,
  );
}

/**
 * Process all pending scheduled emails
 */
export async function processScheduledEmails(): Promise<void> {
  console.log("🔄 Checking for scheduled emails to process...");

  try {
    const now = new Date();

    // Find pending schedules that are due
    const schedules = await EmailSchedule.find({
      status: "pending",
      scheduledFor: { $lte: now },
    }).sort({ scheduledFor: 1 });

    if (schedules.length === 0) {
      console.log("📭 No pending scheduled emails to process");
      return;
    }

    console.log(`📧 Found ${schedules.length} scheduled emails to process`);

    for (const schedule of schedules) {
      try {
        await processScheduledEmail(schedule);

        // Handle recurring schedules
        if (schedule.recurring && schedule.recurring.enabled) {
          const { frequency, interval, endDate } = schedule.recurring;

          // Check if end date has passed
          if (endDate && new Date(endDate) <= new Date()) {
            console.log(
              `⏹️ Recurring schedule ${schedule._id} has ended (end date: ${endDate})`,
            );
            continue;
          }

          // Calculate next schedule date
          let nextDate = new Date(schedule.scheduledFor);
          if (frequency === "daily") {
            nextDate.setDate(nextDate.getDate() + interval);
          } else if (frequency === "weekly") {
            nextDate.setDate(nextDate.getDate() + interval * 7);
          } else if (frequency === "monthly") {
            nextDate.setMonth(nextDate.getMonth() + interval);
          }

          // Check if next date is beyond end date
          if (endDate && nextDate > new Date(endDate)) {
            console.log(
              `⏹️ Recurring schedule ${schedule._id} has reached end date`,
            );
            continue;
          }

          // Create a new schedule for the next occurrence
          const newSchedule = new EmailSchedule({
            name: `${schedule.name} (Recurring)`,
            applicationIds: schedule.applicationIds,
            subject: schedule.subject,
            message: schedule.message,
            richTextContent: schedule.richTextContent,
            includeBilling: schedule.includeBilling,
            billType: schedule.billType,
            sendCopyToAdmin: schedule.sendCopyToAdmin,
            useAdminSender: schedule.useAdminSender,
            scheduledFor: nextDate,
            status: "pending",
            totalRecipients: schedule.totalRecipients,
            createdBy: schedule.createdBy,
            createdByEmail: schedule.createdByEmail,
            locationFilter: schedule.locationFilter,
            recurring: schedule.recurring,
          });

          await newSchedule.save();
          console.log(
            `📅 Created recurring schedule: ${newSchedule._id} for ${nextDate.toLocaleString()}`,
          );
        }
      } catch (error) {
        console.error(`Error processing schedule ${schedule._id}:`, error);
        schedule.status = "failed";
        schedule.error = `Error: ${error}`;
        await schedule.save();
      }
    }
  } catch (error) {
    console.error("❌ Error processing scheduled emails:", error);
  }
}

// Set up the cron job to run every minute
export function startScheduler(): void {
  console.log("🚀 Starting email scheduler...");

  // Run immediately on startup
  processScheduledEmails();

  // Then run every minute
  setInterval(processScheduledEmails, 60000);

  console.log("✅ Email scheduler started, running every minute");
}
