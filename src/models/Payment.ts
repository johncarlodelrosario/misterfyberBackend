// backend/src/models/Payment.ts - COMPLETE WITH 'free' ENUM

import mongoose, { Schema, Document } from "mongoose";

export interface IPayment extends Document {
  userId?: mongoose.Types.ObjectId;
  applicationId?: string;
  amount: number;
  currency: string;
  paymentMethod:
    | "paymongo"
    | "dragonpay"
    | "gcash"
    | "maya"
    | "card"
    | "bank_transfer"
    | "manual"
    | "free";
  paymentType: "subscription" | "installation" | "others" | "pro_rated";
  status: "pending" | "processing" | "completed" | "failed" | "refunded";
  transactionId: string;
  referenceNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paymentDetails: {
    gateway: string;
    gatewayResponse: any;
    paymentIntentId?: string;
    paymentMethodId?: string;
    notes?: string;
    confirmedBy?: string;
    confirmedAt?: Date;
    rejectionReason?: string;
    rejectedAt?: Date;
    rejectedBy?: string;
    isFree?: boolean;
  };
  billingId: mongoose.Types.ObjectId;
  invoiceId?: mongoose.Types.ObjectId;
  metadata: any;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    applicationId: {
      type: String,
      ref: "Application",
      required: false,
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: "PHP" },
    paymentMethod: {
      type: String,
      enum: [
        "paymongo",
        "dragonpay",
        "gcash",
        "maya",
        "card",
        "bank_transfer",
        "manual",
        "free",
      ],
      required: true,
      default: "manual",
    },
    paymentType: {
      type: String,
      enum: ["subscription", "installation", "others", "pro_rated"],
      default: "subscription",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "refunded"],
      default: "pending",
    },
    transactionId: { type: String },
    referenceNumber: { type: String, unique: true },
    customerName: { type: String, required: false, default: "" },
    customerEmail: { type: String, required: false, default: "" },
    customerPhone: { type: String, required: false, default: "" },
    paymentDetails: {
      gateway: { type: String, default: "manual" },
      gatewayResponse: { type: Schema.Types.Mixed },
      paymentIntentId: { type: String },
      paymentMethodId: { type: String },
      notes: { type: String },
      confirmedBy: { type: String },
      confirmedAt: { type: Date },
      rejectionReason: { type: String },
      rejectedAt: { type: Date },
      rejectedBy: { type: String },
      isFree: { type: Boolean, default: false },
    },
    billingId: { type: Schema.Types.ObjectId, ref: "Billing", required: false },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
    metadata: { type: Schema.Types.Mixed },
    paidAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

PaymentSchema.pre("save", function (next) {
  if (!this.referenceNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.referenceNumber = `PAY-${timestamp}-${random}`;
  }
  next();
});

PaymentSchema.pre("validate", function (next) {
  // Allow payments without userId or applicationId if it's a free payment
  if (!this.userId && !this.applicationId && this.paymentMethod !== "free") {
    next(new Error("Either userId or applicationId must be provided"));
  }
  next();
});

// INDEXES - Add these for performance
PaymentSchema.index({ applicationId: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ createdAt: -1 });
PaymentSchema.index({ paymentType: 1 });
PaymentSchema.index({ billingId: 1 });
PaymentSchema.index({ referenceNumber: 1 });
PaymentSchema.index({ customerName: 1 });
PaymentSchema.index({ paymentMethod: 1 });

export default mongoose.model<IPayment>("Payment", PaymentSchema);
