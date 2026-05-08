// models/BillingCycle.ts - COMPLETE
import mongoose, { Document, Schema } from "mongoose";

export interface IBillingCycle extends Document {
  userId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  billingStartDate: Date;
  billingEndDate: Date;
  nextBillingDate: Date;
  status: "active" | "paused" | "cancelled";
  monthlyRate: number;
  currentProRatedAmount: number;
  proRatedPaid: boolean;
  proRatedPaidAt?: Date;
  paymentHistory: Array<{
    billingId: mongoose.Types.ObjectId;
    amount: number;
    paidAt: Date;
  }>;
  serviceSuspendedAt?: Date;
  pendingPlanChange?: {
    newPlanId: mongoose.Types.ObjectId;
    requestedAt: Date;
    effectiveDate: Date;
    status: "pending" | "approved" | "rejected";
  };
  createdAt: Date;
  updatedAt: Date;
}

const BillingCycleSchema = new Schema<IBillingCycle>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    billingStartDate: { type: Date, required: true },
    billingEndDate: { type: Date, required: true },
    nextBillingDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "paused", "cancelled"],
      default: "active",
    },
    monthlyRate: { type: Number, required: true },
    currentProRatedAmount: { type: Number, required: true },
    proRatedPaid: { type: Boolean, default: false },
    proRatedPaidAt: { type: Date },
    paymentHistory: [
      {
        billingId: { type: Schema.Types.ObjectId, ref: "Billing" },
        amount: Number,
        paidAt: Date,
      },
    ],
    serviceSuspendedAt: { type: Date },
    pendingPlanChange: {
      newPlanId: { type: Schema.Types.ObjectId, ref: "Plan" },
      requestedAt: Date,
      effectiveDate: Date,
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
    },
  },
  { timestamps: true },
);

export default mongoose.model<IBillingCycle>(
  "BillingCycle",
  BillingCycleSchema,
);
