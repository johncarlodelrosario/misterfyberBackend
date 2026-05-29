// controllers/paymentController.ts
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
  const payment = await Payment.findById(paymentId)
    .populate(
      "userId",
      "firstName lastName email username phoneNumber status mikrotik planId",
    )
    .populate(
      "applicationId",
      "firstName lastName email applicationId phoneNumber status billingStarted",
    )
    .populate("billingId", "invoiceNumber total dueDate isProRated")
    .lean();

  if (!payment) return null;

  // Create a plain object with application data for frontend
  const result: any = { ...payment };

  // If applicationId is populated, create an 'application' field for frontend
  if (payment.applicationId && typeof payment.applicationId === "object") {
    const app = payment.applicationId as any;
    result.application = {
      _id: app._id,
      applicationId: app.applicationId,
      firstName: app.firstName,
      lastName: app.lastName,
      email: app.email,
      phoneNumber: app.phoneNumber,
      status: app.status,
      billingStarted: app.billingStarted,
      applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
      address: app.address,
    };
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
  }

  return result;
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
    } = req.body;
    const userId = req.user._id;

    const billing = await Billing.findById(billingId);
    if (!billing) {
      return res.status(404).json({ message: "Billing record not found" });
    }

    const payment = await Payment.create({
      userId,
      amount,
      paymentMethod: paymentMethod || "manual",
      paymentType: paymentType || "subscription",
      status: "pending",
      referenceNumber: referenceNumber || `MANUAL-${Date.now()}`,
      billingId,
      paymentDetails: {
        gateway: "manual",
        gatewayResponse: null,
        notes: notes || "Manual payment - pending admin approval",
      },
    });

    res.status(201).json({
      success: true,
      message: "Payment recorded. Waiting for admin confirmation.",
      data: payment,
    });
  } catch (error) {
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

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
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
    const payment = await getPopulatedPayment(req.params.id);

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
    const payment = await paymentService.verifyPayment(req.params.reference);
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
    next(error);
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
    next(error);
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

    res.status(200).json({
      success: true,
      data: {
        daily: stats,
        totals: totalRevenue[0] || { total: 0, count: 0 },
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
    const { reason } = req.body;
    const payment = await paymentService.refundPayment(req.params.id, reason);
    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
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
    const { notes } = req.body;
    const adminId = req.user._id;

    // Get payment with populated data
    const payment = await Payment.findById(id)
      .populate("userId")
      .populate("applicationId")
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

    // Get readable application ID
    let readableApplicationId = "";
    let customerEmail = "";
    let customerName = "";
    let customer: any = null;

    if (payment.applicationId) {
      customer = payment.applicationId as any;
      readableApplicationId = customer.applicationId || customer._id.toString();
      customerEmail = customer.email;
      customerName =
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
    } else if (payment.userId) {
      customer = payment.userId as any;
      customerEmail = customer.email;
      customerName =
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
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
      },
      notes: payment.paymentDetails?.notes,
    };
    await payment.save({ session });

    // Update billing record
    const billing = await Billing.findById(payment.billingId).session(session);
    if (billing) {
      billing.status = "paid";
      billing.paymentId = payment._id;
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
      const app = await Application.findById(payment.applicationId).session(
        session,
      );
      if (app) {
        app.billingStarted = true;
        await app.save({ session });
      }
    }

    await session.commitTransaction();

    // Send confirmation email
    if (customerEmail && billing) {
      await emailService.sendEmail(
        customerEmail,
        `Payment Confirmed - ${billing.invoiceNumber}`,
        `<div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #28a745;">✅ Payment Confirmed!</h2>
          <p>Dear ${customerName},</p>
          <p>Your payment of <strong>₱${payment.amount.toLocaleString()}</strong> has been confirmed.</p>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
            <p><strong>Invoice:</strong> ${billing.invoiceNumber}</p>
            ${readableApplicationId ? `<p><strong>Application ID:</strong> ${readableApplicationId}</p>` : ""}
            <p><strong>Amount:</strong> ₱${payment.amount.toLocaleString()}</p>
            <p><strong>Reference:</strong> ${payment.referenceNumber}</p>
          </div>
          <p>Thank you for your payment!</p>
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>`,
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
        "applicationId",
        "firstName lastName email applicationId phoneNumber status billingStarted",
      )
      .populate("billingId", "invoiceNumber total dueDate")
      .sort({ createdAt: -1 })
      .lean();

    // Enrich payments with application data for frontend
    const enrichedPayments = payments.map((payment) => {
      const enriched: any = { ...payment };

      // Create application object for frontend if applicationId is populated
      if (payment.applicationId && typeof payment.applicationId === "object") {
        const app = payment.applicationId as any;
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.status,
          billingStarted: app.billingStarted,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
        };
        enriched.applicationId = app.applicationId;
      }

      // Add readable application ID from gateway response if available
      if (
        !enriched.application &&
        payment.paymentDetails?.gatewayResponse?.applicationId
      ) {
        enriched.readableApplicationId =
          payment.paymentDetails.gatewayResponse.applicationId;
      }

      // Create user object if userId is populated
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
      }

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

// @desc    Get all payments with pagination (Admin)
// @route   GET /api/payments/admin/all
// @access  Private/Admin
export const getAllPaymentsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;

    let query: any = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate(
          "userId",
          "firstName lastName email username phoneNumber status",
        )
        .populate(
          "applicationId",
          "firstName lastName email applicationId phoneNumber status billingStarted",
        )
        .populate("billingId", "invoiceNumber total dueDate")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(query),
    ]);

    // Calculate stats
    const [totalStats, monthlyStats] = await Promise.all([
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
    ]);

    // Enrich payments with application data
    const enrichedPayments = payments.map((payment) => {
      const enriched: any = { ...payment };

      if (payment.applicationId && typeof payment.applicationId === "object") {
        const app = payment.applicationId as any;
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.status,
          billingStarted: app.billingStarted,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
        };
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
      }

      return enriched;
    });

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
      },
    });
  } catch (error) {
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

    const payment = await Payment.findById(id)
      .populate("userId", "firstName lastName email")
      .populate("applicationId", "firstName lastName email applicationId");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "completed") {
      return res.status(400).json({ message: "Payment already confirmed" });
    }

    const customer = (payment.userId as any) || (payment.applicationId as any);
    const customerEmail = customer?.email;
    const customerName = customer
      ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim()
      : "Customer";

    payment.status = "failed";
    payment.paymentDetails = {
      gateway: payment.paymentDetails?.gateway || "manual",
      gatewayResponse: {
        ...payment.paymentDetails?.gatewayResponse,
        rejectionReason: reason || "Payment verification failed",
        rejectedAt: new Date(),
        rejectedBy: req.user._id,
      },
      notes: payment.paymentDetails?.notes,
    };
    await payment.save();

    if (customerEmail) {
      await emailService.sendEmail(
        customerEmail,
        "Payment Verification Failed - Mister Fyber",
        `<div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #dc3545;">❌ Payment Verification Failed</h2>
          <p>Dear ${customerName},</p>
          <p>Your payment of <strong>₱${payment.amount.toLocaleString()}</strong> could not be verified.</p>
          <p><strong>Reason:</strong> ${reason || "Please contact support for more information"}</p>
          <p>Please submit your payment again or contact our support team.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>`,
      );
    }

    const responsePayment = {
      _id: payment._id,
      userId: payment.userId,
      applicationId: payment.applicationId,
      amount: payment.amount,
      status: payment.status,
      referenceNumber: payment.referenceNumber,
      paymentDetails: payment.paymentDetails,
      createdAt: payment.createdAt,
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
