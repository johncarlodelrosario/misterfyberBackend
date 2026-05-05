// models/BillingSettings.ts - COMPLETE
import mongoose, { Schema, Document } from "mongoose";

export interface IBillingSettings extends Document {
  reminderDays: number[];
  dueDateDaysAfterPeriod: number;
  gracePeriodDays: number;
  autoGenerateBills: boolean;
  autoSendReminders: boolean;
  autoSuspendOnNonPayment: boolean;
  billingCycleDay: number;
  createdAt: Date;
  updatedAt: Date;
}

const BillingSettingsSchema: Schema = new Schema(
  {
    reminderDays: {
      type: [Number],
      default: [7, 3, 1],
    },
    dueDateDaysAfterPeriod: {
      type: Number,
      default: 7,
    },
    gracePeriodDays: {
      type: Number,
      default: 5,
    },
    autoGenerateBills: {
      type: Boolean,
      default: true,
    },
    autoSendReminders: {
      type: Boolean,
      default: true,
    },
    autoSuspendOnNonPayment: {
      type: Boolean,
      default: true,
    },
    billingCycleDay: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IBillingSettings>(
  "BillingSettings",
  BillingSettingsSchema,
);
