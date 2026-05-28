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

    // Get the billing record
    const billing = await Billing.findById(billingId);
    if (!billing) {
      return res.status(404).json({ message: "Billing record not found" });
    }

    // Create payment record with pending status
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
      .populate("billingId");

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
    const payment = await Payment.findById(req.params.id)
      .populate("userId", "firstName lastName email")
      .populate("applicationId", "firstName lastName email applicationId")
      .populate("billingId");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Check authorization
    const isOwner =
      payment.userId &&
      payment.userId._id.toString() === req.user._id.toString();
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
      },
    };
    await payment.save({ session });

    // Update billing status
    const billing = await Billing.findById(payment.billingId).session(session);
    if (billing) {
      billing.status = "paid";
      billing.paymentId = payment._id;
      await billing.save({ session });

      // Update billing cycle payment history
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

    let customer: any = null;
    let customerEmail = "";
    let customerName = "";

    // Handle User or Application
    if (payment.userId) {
      customer = payment.userId as any;
      customerEmail = customer.email;
      customerName = `${customer.firstName} ${customer.lastName}`;

      if (customer.billingInfo) {
        customer.billingInfo.currentBill = 0;
      }

      if (customer.status === "suspended") {
        customer.status = "active";

        // Reconnect MikroTik if available
        if (customer.mikrotik?.username && customer.planId) {
          try {
            await mikrotikService.applyPlanToUser(customer, customer.planId);
          } catch (error) {
            console.error("Error reconnecting MikroTik:", error);
          }
        }
      }
      await customer.save({ session });
    } else if (payment.applicationId) {
      customer = payment.applicationId as any;
      customerEmail = customer.email;
      customerName = `${customer.firstName} ${customer.lastName}`;

      // Update application billing status
      customer.billingStarted = true;
      await customer.save({ session });
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
            <p><strong>Amount:</strong> ₱${payment.amount.toLocaleString()}</p>
            <p><strong>Reference:</strong> ${payment.referenceNumber}</p>
          </div>
          <p>Thank you for your payment!</p>
        </div>`,
      );
    }

    res.status(200).json({
      success: true,
      message: "Payment confirmed successfully.",
      data: payment,
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
      .populate("userId", "firstName lastName email username phoneNumber")
      .populate(
        "applicationId",
        "firstName lastName email applicationId phoneNumber",
      )
      .populate("billingId", "invoiceNumber total dueDate")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: payments,
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
      .populate("userId")
      .populate("applicationId");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "completed") {
      return res.status(400).json({ message: "Payment already confirmed" });
    }

    const customer = (payment.userId as any) || (payment.applicationId as any);
    const customerEmail = customer?.email;
    const customerName = customer
      ? `${customer.firstName} ${customer.lastName}`
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
    };
    await payment.save();

    // Send rejection email
    if (customerEmail) {
      await emailService.sendEmail(
        customerEmail,
        "Payment Verification Failed",
        `<p>Dear ${customerName},</p>
         <p>Your payment of ₱${payment.amount.toFixed(2)} could not be verified.</p>
         <p>Reason: ${reason || "Please contact support for more information"}</p>
         <p>Please submit your payment again or contact our support team.</p>`,
      );
    }

    res.status(200).json({
      success: true,
      message: "Payment rejected",
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};
