// backend/src/models/Invoice.ts

import mongoose, { Schema, Document } from "mongoose";

export interface IInvoiceItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  type?: "subscription" | "installation" | "pro-rated" | "discount" | "tax";
}

export interface IInvoice extends Document {
  invoiceNumber: string;
  invoiceType: "monthly" | "pro-rated" | "installation" | "combined";
  applicationId: string;
  userId?: mongoose.Types.ObjectId;

  // Customer Information
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  customerPhone?: string;

  // Company Information
  companyName: string;
  companyAddress: string;
  companyVat: string;
  companyContact: string;
  companyEmail: string;

  // Billing Information
  billingPeriod: {
    start: Date;
    end: Date;
  };
  dueDate: Date;
  issuedDate: Date;

  // Items
  items: IInvoiceItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  total: number;

  // Payment Information
  paymentMethod?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;

  // Status
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  paidAt?: Date;
  paymentId?: mongoose.Types.ObjectId;

  // References
  billingId?: mongoose.Types.ObjectId;
  billingCycleId?: mongoose.Types.ObjectId;

  // Metadata
  notes?: string;
  termsAndConditions?: string;
  isInstallationFee: boolean;
  isProRated: boolean;
  proRatedDays?: number;

  // PDF Generation
  pdfUrl?: string;
  pdfGeneratedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema: Schema = new Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    invoiceType: {
      type: String,
      enum: ["monthly", "pro-rated", "installation", "combined"],
      required: true,
      default: "monthly",
    },
    applicationId: {
      type: String,
      ref: "Application",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    // Customer Information
    customerName: {
      type: String,
      required: true,
    },
    customerAddress: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
      required: true,
    },
    customerPhone: {
      type: String,
      required: false,
    },

    // Company Information
    companyName: {
      type: String,
      required: true,
      default: "Fyberblizz Network Corporation",
    },
    companyAddress: {
      type: String,
      required: true,
      default:
        "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
    },
    companyVat: {
      type: String,
      required: true,
      default: "697-461-165-00000",
    },
    companyContact: {
      type: String,
      required: true,
      default: "0969-341-4876",
    },
    companyEmail: {
      type: String,
      required: true,
      default: "collection.breeze@misterfyber.com",
    },

    // Billing Information
    billingPeriod: {
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },
    dueDate: {
      type: Date,
      required: true,
    },
    issuedDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // Items
    items: [
      {
        description: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
        type: {
          type: String,
          enum: [
            "subscription",
            "installation",
            "pro-rated",
            "discount",
            "tax",
          ],
          default: "subscription",
        },
      },
    ],
    subtotal: { type: Number, required: true },
    taxRate: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },

    // Payment Information
    paymentMethod: { type: String, required: false },
    bankName: { type: String, required: false },
    accountName: { type: String, required: false },
    accountNumber: { type: String, required: false },

    // Status
    status: {
      type: String,
      enum: ["draft", "sent", "paid", "overdue", "cancelled"],
      default: "draft",
    },
    paidAt: { type: Date },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },

    // References
    billingId: { type: Schema.Types.ObjectId, ref: "Billing" },
    billingCycleId: { type: Schema.Types.ObjectId, ref: "BillingCycle" },

    // Metadata
    notes: { type: String },
    termsAndConditions: { type: String },
    isInstallationFee: { type: Boolean, default: false },
    isProRated: { type: Boolean, default: false },
    proRatedDays: { type: Number, default: 0 },

    // PDF Generation
    pdfUrl: { type: String },
    pdfGeneratedAt: { type: Date },
  },
  { timestamps: true },
);

// Indexes
InvoiceSchema.index({ invoiceNumber: 1 });
InvoiceSchema.index({ applicationId: 1, status: 1 });
InvoiceSchema.index({ dueDate: 1 });
InvoiceSchema.index({ createdAt: -1 });
InvoiceSchema.index({ status: 1, dueDate: 1 });

// Pre-save hook to generate invoice number if not set
InvoiceSchema.pre("save", function (next) {
  if (!this.invoiceNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    this.invoiceNumber = `INV-${year}${month}${day}-${random}`;
  }
  next();
});

export default mongoose.model<IInvoice>("Invoice", InvoiceSchema);
