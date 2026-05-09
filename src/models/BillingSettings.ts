import mongoose, { Schema, Document } from "mongoose";

export interface IBillingSettings extends Document {
  reminderDays: number[];
  dueDateDaysAfterPeriod: number;
  gracePeriodDays: number;
  autoGenerateBills: boolean;
  autoSendReminders: boolean;
  autoSuspendOnNonPayment: boolean;
  billingCycleDay: number;
  freeDays: number;
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
      default: 5,
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
    freeDays: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  },
);

// Create default settings if none exist
BillingSettingsSchema.statics.getDefaultSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      reminderDays: [7, 3, 1],
      dueDateDaysAfterPeriod: 5,
      gracePeriodDays: 5,
      autoGenerateBills: true,
      autoSendReminders: true,
      autoSuspendOnNonPayment: true,
      billingCycleDay: 1,
      freeDays: 1,
    });
  }
  return settings;
};

export default mongoose.model<IBillingSettings>(
  "BillingSettings",
  BillingSettingsSchema,
);
