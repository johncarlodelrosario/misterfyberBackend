// models/Payment.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IPayment extends Document {
  userId?: mongoose.Types.ObjectId;
  applicationId?: string; // Changed from ObjectId to string
  amount: number;
  currency: string;
  paymentMethod:
    | "paymongo"
    | "dragonpay"
    | "gcash"
    | "maya"
    | "card"
    | "bank_transfer"
    | "manual";
  paymentType: "subscription" | "installation" | "others";
  status: "pending" | "processing" | "completed" | "failed" | "refunded";
  transactionId: string;
  referenceNumber: string;
  paymentDetails: {
    gateway: string;
    gatewayResponse: any;
    paymentIntentId?: string;
    paymentMethodId?: string;
    notes?: string;
    confirmedBy?: string;
    confirmedAt?: Date;
  };
  billingId: mongoose.Types.ObjectId;
  metadata: any;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    applicationId: {
      type: String, // Changed to String
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
      ],
      required: true,
      default: "manual",
    },
    paymentType: {
      type: String,
      enum: ["subscription", "installation", "others"],
      default: "subscription",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "refunded"],
      default: "pending",
    },
    transactionId: { type: String },
    referenceNumber: { type: String, unique: true },
    paymentDetails: {
      gateway: { type: String, default: "manual" },
      gatewayResponse: { type: Schema.Types.Mixed },
      paymentIntentId: { type: String },
      paymentMethodId: { type: String },
      notes: { type: String },
      confirmedBy: { type: String },
      confirmedAt: { type: Date },
    },
    billingId: { type: Schema.Types.ObjectId, ref: "Billing", required: true },
    metadata: { type: Schema.Types.Mixed },
    paidAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

// Generate reference number before saving
PaymentSchema.pre("save", function (next) {
  if (!this.referenceNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.referenceNumber = `PAY-${timestamp}-${random}`;
  }
  next();
});

// Validate that either userId or applicationId is provided
PaymentSchema.pre("validate", function (next) {
  if (!this.userId && !this.applicationId) {
    next(new Error("Either userId or applicationId must be provided"));
  }
  next();
});

// Add index for applicationId
PaymentSchema.index({ applicationId: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ createdAt: -1 });

export default mongoose.model<IPayment>("Payment", PaymentSchema);
