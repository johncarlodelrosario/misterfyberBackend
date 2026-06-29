// backend/src/controllers/paymentController.ts

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment";
import User from "../models/User";
import Application from "../models/Application";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import emailService from "../services/emailService";
import mikrotikService from "../services/mikrotikService";
import paymentService from "../services/paymentService";

interface AuthRequest extends Request {
  user?: any;
  query: any;
  params: any;
  body: any;
}

// Helper function to get populated customer data
async function getPopulatedPayment(paymentId: string) {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) {
    return null;
  }

  const payment = await Payment.findById(paymentId)
    .populate(
      "userId",
      "firstName lastName email username phoneNumber status mikrotik planId",
    )
    .populate(
      "billingId",
      "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod",
    )
    .lean();

  if (!payment) return null;

  // Create a plain object with application data for frontend
  const result: any = { ...payment };

  // Manually fetch application data using string applicationId
  if (payment.applicationId) {
    const application = await Application.findOne({
      applicationId: payment.applicationId,
    })
      .select(
        "firstName lastName email applicationId phoneNumber status serviceStatus billingStarted installationFee installationFeePaid",
      )
      .lean();

    if (application) {
      result.application = {
        _id: application._id,
        applicationId: application.applicationId,
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phoneNumber: application.phoneNumber,
        status: application.status,
        serviceStatus: (application as any).serviceStatus || "pending",
        billingStarted: application.billingStarted,
        installationFee: (application as any).installationFee || 0,
        installationFeePaid: (application as any).installationFeePaid || false,
        applicantName:
          `${application.firstName || ""} ${application.lastName || ""}`.trim(),
      };
      result.applicationId = application.applicationId;

      // Set customer name fields if not already set
      if (!result.customerName || result.customerName === "") {
        result.customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        result.customerEmail = application.email || "";
        result.customerPhone = application.phoneNumber || "";
      }
    }
  }

  // If userId is populated, also add user data
  if (payment.userId && typeof payment.userId === "object") {
    const user = payment.userId as any;
    result.user = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      username: user.username,
      status: user.status,
    };

    // Set customer name fields if not already set
    if (!result.customerName || result.customerName === "") {
      result.customerName =
        `${user.firstName || ""} ${user.lastName || ""}`.trim();
      result.customerEmail = user.email || "";
      result.customerPhone = user.phoneNumber || "";
    }
  }

  return result;
}

// Helper to extract customer info from various sources
function extractCustomerInfo(
  application: any,
  user: any,
  billing: any,
  requestBody: any,
): { name: string; email: string; phone: string } {
  let name = "";
  let email = "";
  let phone = "";

  // Try to get from application first
  if (application) {
    name =
      `${application.firstName || ""} ${application.lastName || ""}`.trim();
    email = application.email || "";
    phone = application.phoneNumber || "";
  }

  // If no name from application, try user
  if (!name && user) {
    name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    email = user.email || "";
    phone = user.phoneNumber || "";
  }

  // If still no name, try request body
  if (!name && requestBody) {
    name = requestBody.customerName || requestBody.name || "";
    email = requestBody.customerEmail || requestBody.email || "";
    phone = requestBody.customerPhone || requestBody.phone || "";
  }

  // If still no name, try billing
  if (!name && billing) {
    name = billing.customerName || "";
    email = billing.customerEmail || "";
    phone = billing.customerPhone || "";
  }

  // If still no name, use application ID as fallback
  if (!name && application?.applicationId) {
    name = application.applicationId;
  }

  return { name, email, phone };
}

// @desc    Create payment (manual - pending status only)
// @route   POST /api/payments
// @access  Private
export const createPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      amount,
      paymentMethod,
      billingId,
      paymentType,
      referenceNumber,
      notes,
      customerName,
      customerEmail,
      customerPhone,
    } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!amount) {
      return res.status(400).json({ message: "Amount is required" });
    }
    if (!billingId) {
      return res.status(400).json({ message: "Billing ID is required" });
    }

    const billing = await Billing.findById(billingId).populate("applicationId");
    if (!billing) {
      return res.status(404).json({ message: "Billing record not found" });
    }

    // Extract customer info - PRIORITIZE from billing's application
    let customerNameFinal = customerName || "";
    let customerEmailFinal = customerEmail || "";
    let customerPhoneFinal = customerPhone || "";

    // CRITICAL FIX: Get from application if billing has it
    if (billing.applicationId) {
      // Check if it's a populated object or just an ID
      if (
        typeof billing.applicationId === "object" &&
        billing.applicationId !== null
      ) {
        const app = billing.applicationId as any;
        customerNameFinal =
          `${app.firstName || ""} ${app.lastName || ""}`.trim();
        customerEmailFinal = app.email || "";
        customerPhoneFinal = app.phoneNumber || "";
        console.log(
          `✅ Got customer from populated application: ${customerNameFinal}`,
        );
      } else {
        // It's just an ID, fetch the application
        const app = await Application.findOne({
          applicationId: billing.applicationId,
        }).lean();
        if (app) {
          customerNameFinal =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          customerEmailFinal = app.email || "";
          customerPhoneFinal = app.phoneNumber || "";
          console.log(
            `✅ Got customer from fetched application: ${customerNameFinal}`,
          );
        }
      }
    }

    // If still no name, try to get from user
    if (!customerNameFinal && userId) {
      const user = await User.findById(userId);
      if (user) {
        customerNameFinal =
          `${user.firstName || ""} ${user.lastName || ""}`.trim();
        customerEmailFinal = user.email || "";
        customerPhoneFinal = user.phoneNumber || "";
        console.log(`✅ Got customer from user: ${customerNameFinal}`);
      }
    }

    // If still no name, use application ID
    if (!customerNameFinal && billing.applicationId) {
      customerNameFinal = billing.applicationId.toString();
      console.log(`⚠️ Using application ID as name: ${customerNameFinal}`);
    }

    // If still no name, use "Unknown Customer"
    if (!customerNameFinal) {
      customerNameFinal = "Unknown Customer";
      console.log(`⚠️ No name found, using "Unknown Customer"`);
    }

    const paymentData: any = {
      userId,
      amount: Number(amount),
      paymentMethod: paymentMethod || "manual",
      paymentType:
        paymentType ||
        (billing.isInstallationBill ? "installation" : "subscription"),
      status: "pending",
      referenceNumber: referenceNumber || `MANUAL-${Date.now()}`,
      billingId,
      customerName: customerNameFinal,
      customerEmail: customerEmailFinal,
      customerPhone: customerPhoneFinal,
      paymentDetails: {
        gateway: "manual",
        gatewayResponse: {
          customerName: customerNameFinal,
          customerEmail: customerEmailFinal,
          customerPhone: customerPhoneFinal,
        },
        notes: notes || "Manual payment - pending admin approval",
      },
    };

    // If billing has applicationId (string), use it
    if (billing.applicationId) {
      paymentData.applicationId = billing.applicationId;
    }

    const payment = await Payment.create(paymentData);
    console.log(
      `✅ Payment created with customer name: ${payment.customerName}`,
    );

    res.status(201).json({
      success: true,
      message: "Payment recorded. Waiting for admin confirmation.",
      data: payment,
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    next(error);
  }
};

// @desc    Get all payments for user
// @route   GET /api/payments
// @access  Private
export const getPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user._id;
    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .populate("billingId")
      .lean();

    // Manually fetch application data for each payment
    const enrichedPayments = await Promise.all(
      payments.map(async (payment) => {
        const enriched: any = { ...payment };
        if (payment.applicationId) {
          const application = await Application.findOne({
            applicationId: payment.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            enriched.application = application;
            if (!enriched.customerName || enriched.customerName === "") {
              enriched.customerName =
                `${application.firstName || ""} ${application.lastName || ""}`.trim();
              enriched.customerEmail = application.email || "";
              enriched.customerPhone = application.phoneNumber || "";
            }
          }
        }
        return enriched;
      }),
    );

    res.status(200).json({
      success: true,
      count: enrichedPayments.length,
      data: enrichedPayments,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single payment
// @route   GET /api/payments/:id
// @access  Private
export const getPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await getPopulatedPayment(id);

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    const isOwner =
      payment.userId &&
      payment.userId._id?.toString() === req.user._id.toString();
    const isAdmin =
      req.user.role === "super_admin" || req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify payment
// @route   GET /api/payments/verify/:reference
// @access  Private
export const verifyPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ message: "Reference number is required" });
    }

    const payment = await paymentService.verifyPayment(reference);
    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    PayMongo webhook
// @route   POST /api/payments/webhook/paymongo
// @access  Public
export const payMongoWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await paymentService.processPaymentWebhook(req.body, "paymongo");
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("PayMongo webhook error:", error);
    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true, error: "Processing error" });
  }
};

// @desc    DragonPay webhook
// @route   POST /api/payments/webhook/dragonpay
// @access  Public
export const dragonPayWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await paymentService.processPaymentWebhook(req.body, "dragonpay");
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("DragonPay webhook error:", error);
    res.status(200).json({ status: "success", error: "Processing error" });
  }
};

// @desc    Get payment statistics
// @route   GET /api/payments/stats
// @access  Private/Admin
export const getPaymentStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const stats = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            method: "$paymentMethod",
            type: "$paymentType",
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.date": -1 },
      },
    ]);

    const totalRevenue = await Payment.aggregate([
      {
        $match: { status: "completed" },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Get subscription revenue
    const subscriptionRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          paymentType: "subscription",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Get installation fee revenue
    const installationFeeRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          paymentType: "installation",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Get this month's revenue
    const thisMonthRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Get pending payments total
    const pendingPayments = await Payment.aggregate([
      {
        $match: { status: "pending" },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        daily: stats,
        totals: totalRevenue[0] || { total: 0, count: 0 },
        subscriptionRevenue: subscriptionRevenue[0] || { total: 0, count: 0 },
        installationFees: installationFeeRevenue[0] || { total: 0, count: 0 },
        thisMonth: thisMonthRevenue[0] || { total: 0, count: 0 },
        pending: pendingPayments[0] || { total: 0, count: 0 },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Refund payment
// @route   POST /api/payments/:id/refund
// @access  Private/Admin
export const refundPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await paymentService.refundPayment(id, reason);
    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error: any) {
    if (error.message === "Payment not found") {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
};

// @desc    Confirm payment (Admin only) - MANUAL APPROVAL
// @route   PUT /api/payments/:id/confirm
// @access  Private/Admin
export const confirmPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes, paymentType } = req.body;
    const adminId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    // Get payment with populated data
    const payment = await Payment.findById(id)
      .populate("userId")
      .populate("billingId")
      .session(session);

    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "completed") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Payment already confirmed" });
    }

    // Update payment type if specified
    if (paymentType) {
      payment.paymentType = paymentType;
    }

    // Get readable application ID and customer info
    let readableApplicationId = "";
    let customerEmail = "";
    let customerName = "";
    let customer: any = null;

    if (payment.applicationId) {
      const application = await Application.findOne({
        applicationId: payment.applicationId,
      }).lean();
      if (application) {
        customer = application;
        readableApplicationId = application.applicationId;
        customerEmail = application.email;
        customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        // Update payment with customer info if not set
        if (!payment.customerName || payment.customerName === "") {
          payment.customerName = customerName;
          payment.customerEmail = customerEmail;
          payment.customerPhone = application.phoneNumber || "";
        }
      }
    } else if (payment.userId) {
      customer = payment.userId as any;
      customerEmail = customer.email;
      customerName =
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
      if (!payment.customerName || payment.customerName === "") {
        payment.customerName = customerName;
        payment.customerEmail = customerEmail;
        payment.customerPhone = customer.phoneNumber || "";
      }
    }

    // Update payment status
    payment.status = "completed";
    payment.paidAt = new Date();
    payment.paymentDetails = {
      gateway: payment.paymentDetails?.gateway || "manual",
      gatewayResponse: {
        ...payment.paymentDetails?.gatewayResponse,
        confirmedBy: adminId,
        confirmedAt: new Date(),
        confirmationNotes: notes,
        applicationId: readableApplicationId,
        customerName: payment.customerName,
        customerEmail: payment.customerEmail,
        customerPhone: payment.customerPhone,
      },
      notes: payment.paymentDetails?.notes,
    };
    await payment.save({ session });

    // Update billing record
    const billing = await Billing.findById(payment.billingId).session(session);
    if (billing) {
      billing.status = "paid";
      billing.paymentId = payment._id;
      billing.paidAt = new Date();

      if (billing.isInstallationBill || billing.installationFee > 0) {
        billing.installationFeePaid = true;
      }
      await billing.save({ session });

      // Update billing cycle
      const billingCycle = await BillingCycle.findById(
        billing.billingCycleId,
      ).session(session);
      if (billingCycle) {
        billingCycle.paymentHistory = billingCycle.paymentHistory || [];
        billingCycle.paymentHistory.push({
          billingId: billing._id,
          amount: payment.amount,
          paidAt: new Date(),
        });

        if (billing.isProRated && !billingCycle.proRatedPaid) {
          billingCycle.proRatedPaid = true;
          billingCycle.proRatedPaidAt = new Date();
          if (billingCycle.status === "pending_activation") {
            billingCycle.status = "active";
          }
        }

        // Mark installation fee as paid in billing cycle
        if (
          billing.isInstallationBill ||
          (billing.installationFee && billing.installationFee > 0)
        ) {
          billingCycle.installationFeePaid = true;
        }

        await billingCycle.save({ session });
      }
    }

    // Update customer status
    if (payment.userId) {
      const user = await User.findById(payment.userId).session(session);
      if (user) {
        if (user.billingInfo) {
          user.billingInfo.currentBill = 0;
        }
        if (user.status === "suspended") {
          user.status = "active";
          if (user.mikrotik?.username && user.planId) {
            try {
              await mikrotikService.applyPlanToUser(user, user.planId);
            } catch (error) {
              console.error("Error reconnecting MikroTik:", error);
            }
          }
        }
        await user.save({ session });
      }
    } else if (payment.applicationId) {
      const app = await Application.findOne({
        applicationId: payment.applicationId,
      }).session(session);
      if (app) {
        app.billingStarted = true;
        app.serviceStatus = "active";
        // If this payment is for installation fee, mark it as paid
        if (
          payment.paymentType === "installation" ||
          (billing && billing.isInstallationBill)
        ) {
          app.installationFeePaid = true;
        }
        await app.save({ session });
      }
    }

    await session.commitTransaction();

    // Send confirmation email
    if (customerEmail && billing) {
      const isInstallationPayment =
        billing.isInstallationBill || payment.paymentType === "installation";

      let emailBody = `<div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #28a745;">✅ Payment Confirmed!</h2>
          <p>Dear ${customerName || "Customer"},</p>
          <p>Your payment of <strong>₱${payment.amount.toLocaleString()}</strong> has been confirmed.</p>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
            <p><strong>Invoice:</strong> ${billing.invoiceNumber}</p>
            ${readableApplicationId ? `<p><strong>Application ID:</strong> ${readableApplicationId}</p>` : ""}
            <p><strong>Amount:</strong> ₱${payment.amount.toLocaleString()}</p>
            <p><strong>Reference:</strong> ${payment.referenceNumber}</p>`;

      if (isInstallationPayment) {
        emailBody += `<p><strong>Payment Type:</strong> Installation Fee</p>`;
        emailBody += `<p><strong>Installation Fee:</strong> ₱${(billing.installationFee || payment.amount).toLocaleString()} (Paid)</p>`;
        emailBody += `<p><strong>Next Step:</strong> Your installation will be scheduled within 24-48 hours.</p>`;
      }

      emailBody += `</div><p>Thank you for your payment!</p>
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>`;

      await emailService.sendEmail(
        customerEmail,
        `Payment Confirmed - ${billing.invoiceNumber}`,
        emailBody,
      );
    }

    // Get populated payment for response
    const populatedPayment = await getPopulatedPayment(payment._id.toString());

    res.status(200).json({
      success: true,
      message: "Payment confirmed successfully.",
      data: populatedPayment,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// @desc    Get all payments with pending status (Admin)
// @route   GET /api/payments/admin/pending
// @access  Private/Admin
export const getPendingPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const payments = await Payment.find({ status: "pending" })
      .populate(
        "userId",
        "firstName lastName email username phoneNumber status",
      )
      .populate(
        "billingId",
        "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod",
      )
      .sort({ createdAt: -1 })
      .lean();

    // Get all unique application IDs
    const applicationIds = payments
      .filter((p) => p.applicationId)
      .map((p) => p.applicationId)
      .filter((value, index, self) => self.indexOf(value) === index);

    // Fetch all applications in ONE query
    const applications = await Application.find({
      applicationId: { $in: applicationIds },
    }).lean();

    const applicationMap = new Map();
    applications.forEach((app) => {
      applicationMap.set(app.applicationId, app);
    });

    // Enrich payments with application data
    const enrichedPayments = payments.map((payment) => {
      const enriched: any = { ...payment };

      if (payment.applicationId && applicationMap.has(payment.applicationId)) {
        const app = applicationMap.get(payment.applicationId);
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.status,
          serviceStatus: (app as any).serviceStatus || "pending",
          billingStarted: app.billingStarted,
          installationFee: (app as any).installationFee || 0,
          installationFeePaid: (app as any).installationFeePaid || false,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
        };
        enriched.applicationId = app.applicationId;

        // Set customer name if not already set
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
      }

      if (
        !enriched.application &&
        payment.paymentDetails?.gatewayResponse?.applicationId
      ) {
        enriched.readableApplicationId =
          payment.paymentDetails.gatewayResponse.applicationId;
      }

      if (payment.userId && typeof payment.userId === "object") {
        const user = payment.userId as any;
        enriched.user = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          username: user.username,
          status: user.status,
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
          enriched.customerEmail = user.email || "";
          enriched.customerPhone = user.phoneNumber || "";
        }
      }

      enriched.isInstallationPayment =
        payment.paymentType === "installation" ||
        (payment.billingId &&
          typeof payment.billingId === "object" &&
          (payment.billingId as any).isInstallationBill);

      return enriched;
    });

    res.status(200).json({
      success: true,
      data: enrichedPayments,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all payments with pagination (Admin) - FIXED VERSION
// @route   GET /api/payments/admin/all
// @access  Private/Admin
export const getAllPaymentsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const paymentType = req.query.paymentType as string;
    const search = req.query.search as string;

    let query: any = {};
    if (status && status !== "all" && status !== "") {
      query.status = status;
    }
    if (paymentType && paymentType !== "all" && paymentType !== "") {
      query.paymentType = paymentType;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { referenceNumber: { $regex: search, $options: "i" } },
        { applicationId: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerEmail: { $regex: search, $options: "i" } },
      ];
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate(
          "userId",
          "firstName lastName email username phoneNumber status",
        )
        .populate(
          "billingId",
          "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(query),
    ]);

    // Calculate stats
    const [
      totalStats,
      monthlyStats,
      subscriptionStats,
      installationStats,
      pendingStats,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { status: "completed" } },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1,
              ),
            },
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            paymentType: "subscription",
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            paymentType: "installation",
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "pending",
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
    ]);

    // Get ALL unique application IDs from payments
    const applicationIds = payments
      .filter((p) => p.applicationId)
      .map((p) => p.applicationId)
      .filter((value, index, self) => self.indexOf(value) === index);

    // Fetch all applications in ONE query
    let applicationMap = new Map();
    if (applicationIds.length > 0) {
      const applications = await Application.find({
        applicationId: { $in: applicationIds },
      }).lean();

      applications.forEach((app) => {
        applicationMap.set(app.applicationId, app);
      });
    }

    // Helper function to enrich a single payment with application data
    const enrichPaymentWithAppData = (payment: any) => {
      const enriched: any = { ...payment };

      // Get application data from map
      if (payment.applicationId && applicationMap.has(payment.applicationId)) {
        const app = applicationMap.get(payment.applicationId);
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName || "",
          lastName: app.lastName || "",
          email: app.email || "",
          phoneNumber: app.phoneNumber || "",
          status: app.status || "",
          serviceStatus: (app as any).serviceStatus || "pending",
          billingStarted: app.billingStarted || false,
          installationFee: (app as any).installationFee || 0,
          installationFeePaid: (app as any).installationFeePaid || false,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
          fullName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
        };
        // Set customer name fields if not already set
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
      }

      // If we have userId but no application data, try to get name from user
      if (
        !enriched.application &&
        payment.userId &&
        typeof payment.userId === "object"
      ) {
        const user = payment.userId as any;
        enriched.user = {
          _id: user._id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          username: user.username || "",
          status: user.status || "",
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
          enriched.customerEmail = user.email || "";
          enriched.customerPhone = user.phoneNumber || "";
        }
      }

      // If still no name, use applicationId as last resort
      if (!enriched.customerName || enriched.customerName === "") {
        enriched.customerName = payment.applicationId || "Unknown Customer";
      }

      enriched.isInstallationPayment =
        payment.paymentType === "installation" ||
        (payment.billingId &&
          typeof payment.billingId === "object" &&
          (payment.billingId as any).isInstallationBill);

      return enriched;
    };

    // Enrich payments with application data (synchronous - no await needed)
    const enrichedPayments = payments.map(enrichPaymentWithAppData);

    res.status(200).json({
      success: true,
      data: enrichedPayments,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats: {
        total: totalStats[0]?.total || 0,
        totalCount: totalStats[0]?.count || 0,
        monthly: monthlyStats[0]?.total || 0,
        monthlyCount: monthlyStats[0]?.count || 0,
        subscription: subscriptionStats[0]?.total || 0,
        subscriptionCount: subscriptionStats[0]?.count || 0,
        installationFees: installationStats[0]?.total || 0,
        installationFeeCount: installationStats[0]?.count || 0,
        pending: pendingStats[0]?.total || 0,
        pendingCount: pendingStats[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error("Error in getAllPaymentsAdmin:", error);
    next(error);
  }
};

// @desc    Reject payment (Admin)
// @route   PUT /api/payments/:id/reject
// @access  Private/Admin
export const rejectPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id)
      .populate("userId", "firstName lastName email")
      .populate(
        "billingId",
        "invoiceNumber total isInstallationBill installationFee",
      )
      .lean();

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "completed") {
      return res.status(400).json({ message: "Payment already confirmed" });
    }

    if (payment.status === "failed") {
      return res.status(400).json({ message: "Payment already rejected" });
    }

    // Fetch customer data
    let customer = null;
    let customerEmail = "";
    let customerName = payment.customerName || "";

    if (payment.applicationId) {
      const application = await Application.findOne({
        applicationId: payment.applicationId,
      }).lean();
      if (application) {
        customer = application;
        customerEmail = application.email;
        if (!customerName || customerName === "") {
          customerName =
            `${application.firstName || ""} ${application.lastName || ""}`.trim();
        }
      }
    } else if (payment.userId) {
      const user = await User.findById(payment.userId).lean();
      if (user) {
        customer = user;
        customerEmail = user.email;
        if (!customerName || customerName === "") {
          customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
        }
      }
    }

    await Payment.updateOne(
      { _id: id },
      {
        $set: {
          status: "failed",
          "paymentDetails.gatewayResponse.rejectionReason":
            reason || "Payment verification failed",
          "paymentDetails.gatewayResponse.rejectedAt": new Date(),
          "paymentDetails.gatewayResponse.rejectedBy": req.user._id,
        },
      },
    );

    const updatedPayment = await Payment.findById(id).lean();

    if (customerEmail) {
      const isInstallationPayment =
        payment.paymentType === "installation" ||
        (payment.billingId &&
          typeof payment.billingId === "object" &&
          (payment.billingId as any).isInstallationBill);

      let emailBody = `<div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #dc3545;">❌ Payment Verification Failed</h2>
          <p>Dear ${customerName || "Customer"},</p>
          <p>Your payment of <strong>₱${payment.amount.toLocaleString()}</strong> could not be verified.</p>
          <p><strong>Reason:</strong> ${reason || "Please contact support for more information"}</p>`;

      if (isInstallationPayment) {
        emailBody += `<p><strong>Note:</strong> This payment was for an installation fee of ₱${payment.amount.toLocaleString()}.</p>`;
        emailBody += `<p>Please submit your installation fee payment again to proceed with your installation.</p>`;
      } else {
        emailBody += `<p>Please submit your payment again or contact our support team.</p>`;
      }

      emailBody += `<hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>`;

      await emailService.sendEmail(
        customerEmail,
        isInstallationPayment
          ? "Installation Fee Payment Failed - Mister Fyber"
          : "Payment Verification Failed - Mister Fyber",
        emailBody,
      );
    }

    const responsePayment = {
      _id: updatedPayment?._id,
      userId: updatedPayment?.userId,
      applicationId: updatedPayment?.applicationId,
      amount: updatedPayment?.amount,
      status: updatedPayment?.status,
      referenceNumber: updatedPayment?.referenceNumber,
      paymentType: updatedPayment?.paymentType,
      customerName: updatedPayment?.customerName || payment.customerName,
      customerEmail: updatedPayment?.customerEmail || payment.customerEmail,
      customerPhone: updatedPayment?.customerPhone || payment.customerPhone,
      paymentDetails: updatedPayment?.paymentDetails,
      createdAt: updatedPayment?.createdAt,
    };

    res.status(200).json({
      success: true,
      message: "Payment rejected",
      data: responsePayment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get installation fee payment summary
// @route   GET /api/payments/installation/summary
// @access  Private/Admin
export const getInstallationPaymentSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Get all installation payments
    const installationPayments = await Payment.find({
      paymentType: "installation",
      status: "completed",
    })
      .sort({ createdAt: -1 })
      .lean();

    const pendingInstallationPayments = await Payment.find({
      paymentType: "installation",
      status: "pending",
    }).lean();

    const totalInstallationRevenue = installationPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0,
    );

    const pendingTotal = pendingInstallationPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0,
    );

    const thisMonthInstallation = await Payment.aggregate([
      {
        $match: {
          paymentType: "installation",
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: totalInstallationRevenue,
        totalCount: installationPayments.length,
        pendingCount: pendingInstallationPayments.length,
        pendingTotal: pendingTotal,
        thisMonth: thisMonthInstallation[0] || { total: 0, count: 0 },
        recentPayments: installationPayments.slice(0, 10),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete payment (Admin only)
// @route   DELETE /api/payments/:id
// @access  Private/Admin
export const deletePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id);

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Store payment data for response before deletion
    const paymentData = {
      _id: payment._id,
      amount: payment.amount,
      referenceNumber: payment.referenceNumber,
      status: payment.status,
      paymentType: payment.paymentType,
      customerName: payment.customerName,
      customerEmail: payment.customerEmail,
      createdAt: payment.createdAt,
    };

    // Delete the payment
    await Payment.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: `Payment ${paymentData.referenceNumber} deleted successfully`,
      data: paymentData,
    });
  } catch (error) {
    console.error("Error deleting payment:", error);
    next(error);
  }
};

export default {
  createPayment,
  getPayments,
  getPayment,
  verifyPayment,
  payMongoWebhook,
  dragonPayWebhook,
  getPaymentStats,
  refundPayment,
  confirmPayment,
  rejectPayment,
  getPendingPayments,
  getAllPaymentsAdmin,
  getInstallationPaymentSummary,
  deletePayment,
};
