// backend/src/controllers/invoiceController.ts

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Invoice from "../models/Invoice";
import Application from "../models/Application";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import Payment from "../models/Payment";
import User from "../models/User";
import Plan from "../models/Plan";
import emailService from "../services/emailService";
import { generateInvoicePDF } from "../services/pdfService";
import fs from "fs";
import path from "path";

type AuthRequest = Request & { user?: any };

// Helper function to check admin access
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

function generateInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `INV-${year}${month}${day}-${timestamp}${random}`;
}

function formatDateForDisplay(date: Date): string {
  if (!date) return "N/A";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// ==================== CREATE INVOICE FROM BILLING ====================
export const createInvoiceFromBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { billingId, applicationId, dueDate, customItems } = req.body;

    if (!billingId && !applicationId) {
      return res.status(400).json({
        success: false,
        message: "Either billingId or applicationId is required",
      });
    }

    let billing = null;
    let application = null;

    if (billingId) {
      billing = await Billing.findById(billingId).lean();
      if (!billing) {
        return res.status(404).json({
          success: false,
          message: "Billing record not found",
        });
      }
      application = await Application.findOne({
        applicationId: billing.applicationId,
      }).lean();
    } else if (applicationId) {
      application = await Application.findOne({ applicationId }).lean();
      if (!application) {
        return res.status(404).json({
          success: false,
          message: "Application not found",
        });
      }
    }

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    // Get user for email
    const user = await User.findOne({ email: application.email }).lean();

    // Prepare invoice data
    const invoiceItems = [];
    let subtotal = 0;
    let isInstallationFee = false;
    let isProRated = false;
    let proRatedDays = 0;

    // If billing exists, use its items
    if (billing && billing.items) {
      for (const item of billing.items) {
        invoiceItems.push({
          description: item.description,
          quantity: item.quantity || 1,
          rate: item.rate,
          amount: item.amount,
          type: item.type || "subscription",
        });
        subtotal += item.amount;
      }
      isInstallationFee = billing.isInstallationBill || false;
      isProRated = billing.isProRated || false;
      proRatedDays = billing.proRatedDays || 0;
    } else if (customItems) {
      for (const item of customItems) {
        invoiceItems.push({
          description: item.description,
          quantity: item.quantity || 1,
          rate: item.rate,
          amount: item.amount,
          type: item.type || "subscription",
        });
        subtotal += item.amount;
      }
    } else {
      // Create default items
      const plan = await Plan.findById(application.planId).lean();
      const monthlyRate = (plan as any)?.price || 0;

      // Pro-rated
      if (billing?.isProRated) {
        isProRated = true;
        proRatedDays = billing.proRatedDays || 0;
        const dailyRate = (monthlyRate * 12) / 365;
        const proRatedAmount = Math.round(dailyRate * proRatedDays * 100) / 100;

        invoiceItems.push({
          description: `Pro-rated (${formatDateForDisplay(billing.billingPeriod.start)} - ${formatDateForDisplay(billing.billingPeriod.end)})`,
          quantity: proRatedDays,
          rate: dailyRate,
          amount: proRatedAmount,
          type: "pro-rated",
        });
        subtotal += proRatedAmount;
      }

      // Installation fee
      const installationFee = billing?.installationFee || 0;
      if (installationFee > 0) {
        invoiceItems.push({
          description: "Installation Fee (One-time)",
          quantity: 1,
          rate: installationFee,
          amount: installationFee,
          type: "installation",
        });
        subtotal += installationFee;
        isInstallationFee = true;
      }

      // Monthly subscription
      if (!billing?.isProRated || billing?.isProRated === false) {
        invoiceItems.push({
          description: `Monthly Subscription - ${formatDateForDisplay(billing?.billingPeriod.start || new Date())} to ${formatDateForDisplay(billing?.billingPeriod.end || new Date())}`,
          quantity: 1,
          rate: monthlyRate,
          amount: monthlyRate,
          type: "subscription",
        });
        subtotal += monthlyRate;
      }
    }

    // Determine invoice type
    let invoiceTypeFinal = "monthly";
    if (isInstallationFee && isProRated) {
      invoiceTypeFinal = "combined";
    } else if (isInstallationFee) {
      invoiceTypeFinal = "installation";
    } else if (isProRated) {
      invoiceTypeFinal = "pro-rated";
    }

    const total = subtotal;
    const finalDueDate = dueDate
      ? new Date(dueDate)
      : billing?.dueDate || new Date();

    const customerAddress = application.buildingName
      ? `${application.buildingName}`
      : (application as any).address || "N/A";

    const plan = await Plan.findById(application.planId).lean();
    const planName = (plan as any)?.name || "N/A";

    const invoiceData = {
      invoiceNumber: generateInvoiceNumber(),
      invoiceType: invoiceTypeFinal,
      applicationId: application.applicationId,
      userId: user?._id,
      customerName:
        `${application.firstName || ""} ${application.lastName || ""}`.trim() ||
        application.email,
      customerAddress: customerAddress,
      customerEmail: application.email,
      customerPhone: application.phoneNumber || "",
      companyName: "Fyberblizz Network Corporation",
      companyAddress:
        "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
      companyVat: "697-461-165-00000",
      companyContact: "0969-341-4876",
      companyEmail: "collection.breeze@misterfyber.com",
      billingPeriod: {
        start: billing?.billingPeriod?.start || new Date(),
        end: billing?.billingPeriod?.end || new Date(),
      },
      dueDate: finalDueDate,
      issuedDate: new Date(),
      items: invoiceItems,
      subtotal: subtotal,
      taxRate: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: total,
      bankName: "BDO",
      accountName: "FYBERBLIZZ NETWORK CORPORATION",
      accountNumber: "013448002421",
      status: "draft",
      billingId: billing?._id,
      billingCycleId: billing?.billingCycleId,
      isInstallationFee: isInstallationFee,
      isProRated: isProRated,
      proRatedDays: proRatedDays,
      planName: planName,
      notes: billing?.notes || "",
      termsAndConditions:
        "Please be advised that failure to settle your account on or before the due date may result in temporary service interruption.",
    };

    const invoice = await Invoice.create(invoiceData);

    res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: invoice,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GENERATE INVOICE PDF ====================
export const generateInvoicePDFController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const pdfBuffer = await generateInvoicePDF(invoice);

    const pdfDir = path.join(__dirname, "../../uploads/invoices");
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const pdfFileName = `${invoice.invoiceNumber}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFileName);
    fs.writeFileSync(pdfPath, pdfBuffer);

    const pdfUrl = `/uploads/invoices/${pdfFileName}`;
    await Invoice.findByIdAndUpdate(invoiceId, {
      pdfUrl: pdfUrl,
      pdfGeneratedAt: new Date(),
      status: "sent",
    });

    res.status(200).json({
      success: true,
      message: "PDF generated successfully",
      data: {
        pdfUrl: pdfUrl,
        invoice: await Invoice.findById(invoiceId).lean(),
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    next(error);
  }
};

// ==================== SEND INVOICE WITH PDF ====================
export const sendInvoiceWithPDF = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    let pdfBuffer: Buffer;
    let pdfPath: string;

    if (invoice.pdfUrl) {
      const filePath = path.join(__dirname, "../..", invoice.pdfUrl);
      if (fs.existsSync(filePath)) {
        pdfBuffer = fs.readFileSync(filePath);
        pdfPath = invoice.pdfUrl;
      } else {
        pdfBuffer = await generateInvoicePDF(invoice);
        const pdfDir = path.join(__dirname, "../../uploads/invoices");
        if (!fs.existsSync(pdfDir)) {
          fs.mkdirSync(pdfDir, { recursive: true });
        }
        const pdfFileName = `${invoice.invoiceNumber}.pdf`;
        pdfPath = `/uploads/invoices/${pdfFileName}`;
        fs.writeFileSync(path.join(pdfDir, pdfFileName), pdfBuffer);
        await Invoice.findByIdAndUpdate(invoiceId, {
          pdfUrl: pdfPath,
          pdfGeneratedAt: new Date(),
        });
      }
    } else {
      pdfBuffer = await generateInvoicePDF(invoice);
      const pdfDir = path.join(__dirname, "../../uploads/invoices");
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }
      const pdfFileName = `${invoice.invoiceNumber}.pdf`;
      pdfPath = `/uploads/invoices/${pdfFileName}`;
      fs.writeFileSync(path.join(pdfDir, pdfFileName), pdfBuffer);
      await Invoice.findByIdAndUpdate(invoiceId, {
        pdfUrl: pdfPath,
        pdfGeneratedAt: new Date(),
      });
    }

    const emailSent = await emailService.sendInvoiceWithPDF(
      invoice,
      pdfBuffer,
      `${invoice.invoiceNumber}.pdf`,
    );

    if (emailSent) {
      await Invoice.findByIdAndUpdate(invoiceId, {
        status: "sent",
      });
    }

    res.status(200).json({
      success: true,
      message: emailSent
        ? "Invoice sent with PDF attachment"
        : "Invoice created but email failed",
      data: {
        invoice: await Invoice.findById(invoiceId).lean(),
        emailSent: emailSent,
      },
    });
  } catch (error) {
    console.error("Error sending invoice:", error);
    next(error);
  }
};

// ==================== MARK INVOICE AS PAID ====================
export const markInvoiceAsPaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { invoiceId } = req.params;
    const { referenceNumber, notes } = req.body;

    if (!invoiceId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (invoice.status === "paid") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Invoice ${invoice.invoiceNumber} is already paid`,
      });
    }

    const payment = await Payment.create(
      [
        {
          amount: invoice.total,
          paymentMethod: "manual",
          paymentType: invoice.isInstallationFee
            ? "installation"
            : "subscription",
          status: "completed",
          referenceNumber: referenceNumber || `INV-${Date.now()}`,
          billingId: invoice.billingId,
          applicationId: invoice.applicationId,
          userId: invoice.userId,
          customerName: invoice.customerName,
          customerEmail: invoice.customerEmail,
          customerPhone: invoice.customerPhone,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              confirmedBy: req.user?._id,
              confirmedAt: new Date(),
              notes: notes || "Marked as paid via invoice",
              invoiceNumber: invoice.invoiceNumber,
            },
            notes: notes || "Payment from invoice",
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    invoice.status = "paid";
    invoice.paidAt = new Date();
    invoice.paymentId = payment[0]._id;
    await invoice.save({ session });

    if (invoice.billingId) {
      await Billing.findByIdAndUpdate(
        invoice.billingId,
        {
          $set: {
            status: "paid",
            paidAt: new Date(),
            paymentId: payment[0]._id,
            ...(invoice.isInstallationFee ? { installationFeePaid: true } : {}),
          },
        },
        { session },
      );
    }

    if (invoice.billingCycleId) {
      const billingCycle = await BillingCycle.findById(
        invoice.billingCycleId,
      ).session(session);
      if (billingCycle) {
        billingCycle.paymentHistory = billingCycle.paymentHistory || [];
        billingCycle.paymentHistory.push({
          billingId: invoice.billingId || invoice._id,
          amount: invoice.total,
          paidAt: new Date(),
        });
        if (invoice.isInstallationFee) {
          billingCycle.installationFeePaid = true;
        }
        await billingCycle.save({ session });
      }
    }

    if (invoice.applicationId) {
      const application = await Application.findOne({
        applicationId: invoice.applicationId,
      }).session(session);
      if (application) {
        if (invoice.isInstallationFee) {
          (application as any).installationFeePaid = true;
        }
        await application.save({ session });
      }
    }

    await session.commitTransaction();

    try {
      await emailService.sendPaymentConfirmation(
        {
          firstName: invoice.customerName,
          email: invoice.customerEmail,
        } as any,
        {
          amount: invoice.total,
          referenceNumber: payment[0].referenceNumber,
          paymentMethod: "Manual",
          _id: payment[0]._id,
        },
        {
          invoiceNumber: invoice.invoiceNumber,
          isProRated: invoice.isProRated,
        },
      );
    } catch (emailError) {
      console.error("Failed to send payment confirmation email:", emailError);
    }

    res.status(200).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} marked as paid`,
      data: {
        invoice: await Invoice.findById(invoiceId).lean(),
        payment: payment[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== GET ALL INVOICES ====================
export const getInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId, status, invoiceType, startDate, endDate } =
      req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    let query: any = {};

    if (applicationId) query.applicationId = applicationId;
    if (status) query.status = status;
    if (invoiceType) query.invoiceType = invoiceType;
    if (startDate || endDate) {
      query.issuedDate = {};
      if (startDate) query.issuedDate.$gte = new Date(startDate as string);
      if (endDate) query.issuedDate.$lte = new Date(endDate as string);
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET SINGLE INVOICE ====================
export const getInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    res.status(200).json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET INVOICE PDF ====================
export const getInvoicePDF = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    let pdfBuffer: Buffer;

    if (invoice.pdfUrl) {
      const filePath = path.join(__dirname, "../..", invoice.pdfUrl);
      if (fs.existsSync(filePath)) {
        pdfBuffer = fs.readFileSync(filePath);
      } else {
        pdfBuffer = await generateInvoicePDF(invoice);
        const pdfDir = path.join(__dirname, "../../uploads/invoices");
        if (!fs.existsSync(pdfDir)) {
          fs.mkdirSync(pdfDir, { recursive: true });
        }
        const pdfFileName = `${invoice.invoiceNumber}.pdf`;
        const pdfPath = path.join(pdfDir, pdfFileName);
        fs.writeFileSync(pdfPath, pdfBuffer);
        await Invoice.findByIdAndUpdate(invoiceId, {
          pdfUrl: `/uploads/invoices/${pdfFileName}`,
          pdfGeneratedAt: new Date(),
        });
      }
    } else {
      pdfBuffer = await generateInvoicePDF(invoice);
      const pdfDir = path.join(__dirname, "../../uploads/invoices");
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }
      const pdfFileName = `${invoice.invoiceNumber}.pdf`;
      const pdfPath = path.join(pdfDir, pdfFileName);
      fs.writeFileSync(pdfPath, pdfBuffer);
      await Invoice.findByIdAndUpdate(invoiceId, {
        pdfUrl: `/uploads/invoices/${pdfFileName}`,
        pdfGeneratedAt: new Date(),
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.invoiceNumber}.pdf"`,
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error getting PDF:", error);
    next(error);
  }
};

// ==================== GET APPLICATION INVOICES ====================
export const getApplicationInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: "Application ID is required",
      });
    }

    const invoices = await Invoice.find({ applicationId })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: invoices,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== DELETE INVOICE ====================
export const deleteInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (invoice.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a paid invoice",
      });
    }

    if (invoice.pdfUrl) {
      const filePath = path.join(__dirname, "../..", invoice.pdfUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Invoice.findByIdAndDelete(invoiceId);

    res.status(200).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== UPDATE INVOICE ====================
export const updateInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { invoiceId } = req.params;
    const updateData = req.body;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (invoice.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cannot update a paid invoice",
      });
    }

    const allowedFields = [
      "dueDate",
      "items",
      "subtotal",
      "discountAmount",
      "taxRate",
      "total",
      "notes",
      "customerName",
      "customerAddress",
      "customerEmail",
      "customerPhone",
      "paymentMethod",
      "bankName",
      "accountName",
      "accountNumber",
    ];

    const filteredUpdate: any = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        filteredUpdate[field] = updateData[field];
      }
    }

    if (updateData.items) {
      let subtotal = 0;
      for (const item of updateData.items) {
        subtotal += item.amount || item.quantity * item.rate;
      }
      filteredUpdate.subtotal = subtotal;
      const taxAmount = (subtotal * (updateData.taxRate || 0)) / 100;
      filteredUpdate.taxAmount = taxAmount;
      filteredUpdate.total =
        subtotal + taxAmount - (updateData.discountAmount || 0);
    }

    const updatedInvoice = await Invoice.findByIdAndUpdate(
      invoiceId,
      filteredUpdate,
      { new: true },
    ).lean();

    res.status(200).json({
      success: true,
      message: "Invoice updated successfully",
      data: updatedInvoice,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET INVOICE STATISTICS ====================
export const getInvoiceStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const [totalStats, monthlyStats, statusStats, typeStats] =
      await Promise.all([
        Invoice.aggregate([
          { $match: { status: "paid" } },
          {
            $group: {
              _id: null,
              totalAmount: { $sum: "$total" },
              count: { $sum: 1 },
            },
          },
        ]),
        Invoice.aggregate([
          {
            $match: {
              status: "paid",
              paidAt: {
                $gte: new Date(
                  new Date().getFullYear(),
                  new Date().getMonth(),
                  1,
                ),
              },
            },
          },
          {
            $group: {
              _id: null,
              totalAmount: { $sum: "$total" },
              count: { $sum: 1 },
            },
          },
        ]),
        Invoice.aggregate([
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
              totalAmount: { $sum: "$total" },
            },
          },
        ]),
        Invoice.aggregate([
          {
            $group: {
              _id: "$invoiceType",
              count: { $sum: 1 },
              totalAmount: { $sum: "$total" },
            },
          },
        ]),
      ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: totalStats[0]?.totalAmount || 0,
        totalInvoices: totalStats[0]?.count || 0,
        monthlyRevenue: monthlyStats[0]?.totalAmount || 0,
        monthlyInvoices: monthlyStats[0]?.count || 0,
        byStatus: statusStats,
        byType: typeStats,
      },
    });
  } catch (error) {
    next(error);
  }
};
