// backend/src/services/notificationService.ts - COMPLETE FIXED VERSION

import cron from "node-cron";
import User from "../models/User";
import Billing from "../models/Billing";
import Notification from "../models/Notification";
import emailService, { getLocationFromEntity } from "./emailService";
import smsService from "./smsService";
import logger from "../utils/logger";
import mongoose from "mongoose";

interface IBillWithUser {
  _id: mongoose.Types.ObjectId;
  amount: number;
  dueDate: Date;
  status: string;
  userId: any;
}

interface IPayment {
  _id: mongoose.Types.ObjectId;
  amount: number;
  referenceNumber: string;
}

interface IPlan {
  name: string;
  price?: number;
  speed?: string;
}

class NotificationService {
  constructor() {
    this.initializeScheduledJobs();
  }

  private initializeScheduledJobs(): void {
    // Check for due bills every day at 8 AM
    cron.schedule("0 8 * * *", () => {
      this.checkDueBills();
    });

    // Check for overdue bills every day at 9 AM
    cron.schedule("0 9 * * *", () => {
      this.checkOverdueBills();
    });

    // Send service reminders every Monday at 10 AM
    cron.schedule("0 10 * * 1", () => {
      this.sendServiceReminders();
    });

    // Clean up old notifications every Sunday at 2 AM
    cron.schedule("0 2 * * 0", () => {
      this.cleanupOldNotifications();
    });
  }

  async checkDueBills(): Promise<void> {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      const dueBills = await Billing.find({
        status: "sent",
        dueDate: {
          $lte: tomorrow,
          $gte: new Date(),
        },
      }).populate("userId");

      for (const bill of dueBills) {
        const billData = bill as unknown as IBillWithUser;
        const user = billData.userId;

        if (!user || !user._id) continue;

        // Create notification
        await Notification.create({
          userId: user._id,
          type: "email",
          title: "Bill Due Reminder",
          message: `Your bill of ₱${billData.amount.toFixed(2)} is due on ${new Date(billData.dueDate).toLocaleDateString()}`,
          data: { billingId: billData._id },
          priority: "normal",
        });

        // Send email reminder
        await emailService.sendBillingReminder(user, billData);

        // Send SMS if phone number exists
        if (user.phoneNumber) {
          await smsService.sendBillingReminder(
            user.phoneNumber,
            billData.amount,
            billData.dueDate,
          );
        }
      }

      logger.info(`Sent due bill reminders for ${dueBills.length} users`);
    } catch (error) {
      logger.error("Error checking due bills:", error);
    }
  }

  async checkOverdueBills(): Promise<void> {
    try {
      const overdueBills = await Billing.find({
        status: "overdue",
        dueDate: { $lt: new Date() },
      }).populate("userId");

      for (const bill of overdueBills) {
        const billData = bill as unknown as IBillWithUser;
        const user = billData.userId;

        if (!user || !user._id) continue;

        // Create notification
        await Notification.create({
          userId: user._id,
          type: "email",
          title: "Bill Overdue",
          message: `Your bill of ₱${billData.amount.toFixed(2)} is overdue. Please pay immediately to avoid service interruption.`,
          data: { billingId: billData._id },
          priority: "high",
        });

        // Send email reminder for overdue
        await emailService.sendBillingReminder(user, billData);

        // Send SMS if phone number exists
        if (user.phoneNumber) {
          await smsService.sendBillingReminder(
            user.phoneNumber,
            billData.amount,
            billData.dueDate,
          );
        }

        // If bill is more than 7 days overdue, suspend service
        const daysOverdue = Math.floor(
          (Date.now() - new Date(billData.dueDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (daysOverdue > 7 && user.status !== "suspended") {
          await User.findByIdAndUpdate(user._id, { status: "suspended" });

          await Notification.create({
            userId: user._id,
            type: "system",
            title: "Service Suspended",
            message: "Your service has been suspended due to non-payment.",
            priority: "urgent",
          });
        }
      }

      logger.info(`Processed ${overdueBills.length} overdue bills`);
    } catch (error) {
      logger.error("Error checking overdue bills:", error);
    }
  }

  async sendServiceReminders(): Promise<void> {
    try {
      const users = await User.find({
        status: "active",
        "notificationPreferences.serviceUpdates": true,
      });

      for (const user of users) {
        if (!user._id) continue;

        // Create notification
        await Notification.create({
          userId: user._id,
          type: "email",
          title: "Weekly Service Update",
          message:
            "Thank you for being a valued customer. Check your usage and billing status in your dashboard.",
          priority: "low",
        });

        // Send email reminder
        await emailService.sendServiceReminder(user);
      }

      logger.info(`Sent service reminders to ${users.length} users`);
    } catch (error) {
      logger.error("Error sending service reminders:", error);
    }
  }

  async sendPaymentConfirmation(
    userId: string,
    payment: IPayment,
    billing: any,
  ): Promise<void> {
    try {
      const user = await User.findById(userId);

      if (!user || !user._id) return;

      // Create notification
      await Notification.create({
        userId: user._id,
        type: "email",
        title: "Payment Confirmed",
        message: `Your payment of ₱${payment.amount.toFixed(2)} has been confirmed. Reference: ${payment.referenceNumber}`,
        data: { paymentId: payment._id, billingId: billing._id },
        priority: "normal",
      });

      // Send email using sendPaymentConfirmationEmail method
      // This will generate and send the full invoice with PDF
      try {
        // Get location from billing or user
        let location = "";
        try {
          if (billing) {
            location = await getLocationFromEntity(billing);
          }
        } catch (err) {
          logger.warn("Could not get location for payment confirmation:", err);
        }

        // Prepare invoice data for email
        const invoiceData = {
          invoiceNumber:
            billing.invoiceNumber || billing._id?.toString() || "N/A",
          customerName: user.firstName
            ? `${user.firstName} ${user.lastName || ""}`.trim()
            : user.email,
          customerEmail: user.email,
          customerAddress: billing.customerAddress || "N/A",
          total: payment.amount,
          subtotal: payment.amount,
          discountAmount: 0,
          taxAmount: 0,
          taxRate: 0,
          items: billing.items || [],
          invoiceType: billing.isProRated
            ? "pro-rated"
            : billing.isInstallationBill
              ? "installation"
              : "monthly",
          isInstallationFee: billing.isInstallationBill || false,
          isProRated: billing.isProRated || false,
          dueDate: billing.dueDate || new Date(),
          paidAt: new Date(),
          referenceNumber: payment.referenceNumber,
          location: location,
          notes: billing.notes || "",
        };

        // Use sendPaymentConfirmationEmail which handles PDF generation
        await emailService.sendPaymentConfirmationEmail(
          invoiceData,
          payment,
          Buffer.from(""), // Empty buffer - will be generated by the service
          `${invoiceData.invoiceNumber || "invoice"}.pdf`,
          location,
          false, // useAdminSender
          "Payment confirmed",
          "System",
        );
      } catch (emailError) {
        logger.error(
          "Error sending full payment confirmation email:",
          emailError,
        );

        // Fallback: send simple email notification
        try {
          const subject = "Payment Confirmation - Mister Fyber";
          const message = `
            Dear ${user.firstName || "Customer"},
            
            Your payment of ₱${payment.amount.toFixed(2)} has been confirmed.
            
            Reference: ${payment.referenceNumber}
            
            Thank you for choosing Mister Fyber.
          `;
          await emailService.sendEmail(user.email, subject, message, true, "");
          logger.info(
            `Fallback payment confirmation email sent to ${user.email}`,
          );
        } catch (fallbackError) {
          logger.error("Fallback email also failed:", fallbackError);
        }
      }

      // Send SMS if phone number exists
      if (user.phoneNumber) {
        try {
          await smsService.sendPaymentConfirmation(
            user.phoneNumber,
            payment.amount,
            payment.referenceNumber,
          );
        } catch (smsError) {
          logger.error("Failed to send payment confirmation SMS:", smsError);
        }
      }
    } catch (error) {
      logger.error("Error sending payment confirmation:", error);
    }
  }

  async sendWelcomeNotifications(user: any): Promise<void> {
    try {
      if (!user || !user._id) return;

      // Create welcome notification
      await Notification.create({
        userId: user._id,
        type: "email",
        title: "Welcome to Mister Fyber!",
        message:
          "Thank you for choosing our internet service. Get started by completing your profile.",
        priority: "normal",
      });

      // Send welcome email
      await emailService.sendWelcomeEmail(user);

      // Send welcome SMS
      if (user.phoneNumber) {
        await smsService.sendWelcomeSMS(user.phoneNumber, user.username);
      }
    } catch (error) {
      logger.error("Error sending welcome notifications:", error);
    }
  }

  async sendPlanChangeNotification(
    userId: string,
    oldPlan: IPlan,
    newPlan: IPlan,
  ): Promise<void> {
    try {
      const user = await User.findById(userId);

      if (!user || !user._id) return;

      // Create notification
      await Notification.create({
        userId: user._id,
        type: "email",
        title: "Plan Updated",
        message: `Your plan has been changed from ${oldPlan.name} to ${newPlan.name}`,
        data: { oldPlan, newPlan },
        priority: "normal",
      });

      // Send email notification
      await emailService.sendPlanChangeNotification(user, oldPlan, newPlan);
    } catch (error) {
      logger.error("Error sending plan change notification:", error);
    }
  }

  async sendServiceInterruption(
    userId: string,
    reason: string,
    estimatedDuration?: string,
  ): Promise<void> {
    try {
      const user = await User.findById(userId);

      if (!user || !user._id) return;

      // Create notification
      await Notification.create({
        userId: user._id,
        type: "email",
        title: "Service Interruption",
        message: `Service interruption: ${reason}${estimatedDuration ? `. Estimated duration: ${estimatedDuration}` : ""}`,
        data: { reason, estimatedDuration },
        priority: "high",
      });

      // Send email notification
      await emailService.sendServiceInterruption(
        user,
        reason,
        estimatedDuration ? new Date(estimatedDuration) : undefined,
      );

      // Send SMS if phone number exists
      if (user.phoneNumber) {
        await smsService.sendServiceInterruption(
          user.phoneNumber,
          reason,
          estimatedDuration,
        );
      }
    } catch (error) {
      logger.error("Error sending service interruption notification:", error);
    }
  }

  async sendAccountStatusUpdate(
    userId: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    try {
      const user = await User.findById(userId);

      if (!user || !user._id) return;

      // Create notification
      await Notification.create({
        userId: user._id,
        type: "email",
        title: "Account Status Updated",
        message: `Your account status has been changed from ${oldStatus} to ${newStatus}.`,
        priority: "high",
      });

      // Send email notification
      await emailService.sendAccountStatusUpdate(user);
    } catch (error) {
      logger.error("Error sending account status update:", error);
    }
  }

  async cleanupOldNotifications(): Promise<void> {
    try {
      // Delete notifications older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await Notification.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        isRead: true,
      });

      logger.info(`Cleaned up ${result.deletedCount} old notifications`);
    } catch (error) {
      logger.error("Error cleaning up old notifications:", error);
    }
  }
}

export default new NotificationService();
