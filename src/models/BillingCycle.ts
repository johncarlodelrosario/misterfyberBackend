import mongoose, { Document, Schema } from "mongoose";

export interface IBillingCycle extends Document {
  userId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  billingStartDate: Date;
  billingEndDate: Date;
  nextBillingDate: Date;
  status: "active" | "paused" | "cancelled" | "pending_activation";
  monthlyRate: number;
  currentProRatedAmount: number;
  proRatedPaid: boolean;
  proRatedPaidAt?: Date;
  freeDays: number;
  actualBillableDays: number;
  manualBillStart: boolean;
  manuallyStartedAt?: Date;
  paymentHistory: Array<{
    billingId: mongoose.Types.ObjectId;
    amount: number;
    paidAt: Date;
  }>;
  serviceSuspendedAt?: Date;
  pausedAt?: Date;
  resumedAt?: Date;
  pauseReason?: string;
  pauseUntil?: Date;
  disconnectReason?: string;
  isAfterCutoff?: boolean;
  cutoffDayUsed?: number;
  applicationId?: mongoose.Types.ObjectId;
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
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    billingStartDate: { type: Date, required: true },
    billingEndDate: { type: Date, required: true },
    nextBillingDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "paused", "cancelled", "pending_activation"],
      default: "pending_activation",
    },
    monthlyRate: { type: Number, required: true },
    currentProRatedAmount: { type: Number, required: true, default: 0 },
    proRatedPaid: { type: Boolean, default: false },
    proRatedPaidAt: { type: Date },
    freeDays: { type: Number, default: 0 },
    actualBillableDays: { type: Number, default: 0 },
    manualBillStart: { type: Boolean, default: false },
    manuallyStartedAt: { type: Date },
    paymentHistory: [
      {
        billingId: { type: Schema.Types.ObjectId, ref: "Billing" },
        amount: Number,
        paidAt: Date,
      },
    ],
    serviceSuspendedAt: { type: Date },
    pausedAt: { type: Date },
    resumedAt: { type: Date },
    pauseReason: { type: String },
    pauseUntil: { type: Date },
    disconnectReason: { type: String },
    isAfterCutoff: { type: Boolean, default: false },
    cutoffDayUsed: { type: Number },
    applicationId: { type: Schema.Types.ObjectId, ref: "Application" },
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

BillingCycleSchema.index({ userId: 1 });
BillingCycleSchema.index({ status: 1 });
BillingCycleSchema.index({ applicationId: 1 });

export default mongoose.model<IBillingCycle>(
  "BillingCycle",
  BillingCycleSchema,
);
