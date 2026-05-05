import mongoose, { Schema, Document } from "mongoose";

export interface IBillingCycle extends Document {
  userId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  billingStartDate: Date;
  billingEndDate: Date;
  nextBillingDate: Date;
  status: "active" | "paused" | "completed" | "cancelled";
  monthlyRate: number;
  currentProRatedAmount: number;
  reminderSent: boolean;
  reminderSentAt: Date;
  overdueReminderSent: boolean;
  serviceSuspendedAt: Date;
  pendingPlanChange: {
    newPlanId: mongoose.Types.ObjectId;
    requestedAt: Date;
    effectiveDate: Date;
    status: "pending" | "approved" | "rejected" | "cancelled";
  } | null;
  paymentHistory: {
    billingId: mongoose.Types.ObjectId;
    amount: number;
    paidAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const BillingCycleSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    billingStartDate: { type: Date, required: true },
    billingEndDate: { type: Date },
    nextBillingDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "paused", "completed", "cancelled"],
      default: "active",
    },
    monthlyRate: { type: Number, required: true },
    currentProRatedAmount: { type: Number, default: 0 },
    reminderSent: { type: Boolean, default: false },
    reminderSentAt: { type: Date },
    overdueReminderSent: { type: Boolean, default: false },
    serviceSuspendedAt: { type: Date },
    pendingPlanChange: {
      newPlanId: { type: Schema.Types.ObjectId, ref: "Plan" },
      requestedAt: { type: Date },
      effectiveDate: { type: Date },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected", "cancelled"],
        default: "pending",
      },
    },
    paymentHistory: [
      {
        billingId: { type: Schema.Types.ObjectId, ref: "Billing" },
        amount: { type: Number },
        paidAt: { type: Date },
      },
    ],
  },
  {
    timestamps: true,
  },
);

BillingCycleSchema.index({ userId: 1, status: 1 });
BillingCycleSchema.index({ nextBillingDate: 1 });
BillingCycleSchema.index({ "pendingPlanChange.status": 1 });

export default mongoose.model<IBillingCycle>(
  "BillingCycle",
  BillingCycleSchema,
);
