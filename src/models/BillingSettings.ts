// models/BillingSettings.ts - COMPLETE WITH NEW SETTINGS
import mongoose, { Schema, Document } from "mongoose";

export interface IBillingSettings extends Document {
  // Existing settings
  reminderDays: number[];
  dueDateDaysAfterPeriod: number;
  gracePeriodDays: number;
  autoGenerateBills: boolean;
  autoSendReminders: boolean;
  autoSuspendOnNonPayment: boolean;
  billingCycleDay: number;
  freeDays: number;

  // NEW SETTINGS FOR YOUR FLOW
  proRatedDueDay: number; // Day of month for pro-rated bill due (default: 25)
  monthlyDueDay: number; // Day of month for monthly bill due (default: 5)
  billingCutoffDay: number; // Day when billing switches to next month (default: 23)
  enableAutoBilling: boolean; // Enable automatic billing generation
  sendInvoiceOnInstall: boolean; // Send invoice immediately on installation
  requireAdminActivation: boolean; // Require admin to activate after pro-rated payment

  createdAt: Date;
  updatedAt: Date;
}

const BillingSettingsSchema: Schema = new Schema(
  {
    // Existing settings
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

    // NEW SETTINGS FOR YOUR BILLING FLOW
    proRatedDueDay: {
      type: Number,
      default: 25,
      min: 1,
      max: 31,
      comment: "Day of month when pro-rated bills are due (default: 25th)",
    },
    monthlyDueDay: {
      type: Number,
      default: 5,
      min: 1,
      max: 31,
      comment: "Day of month when monthly bills are due (default: 5th)",
    },
    billingCutoffDay: {
      type: Number,
      default: 23,
      min: 1,
      max: 31,
      comment:
        "Installations after this day go to next month's billing (default: 23rd)",
    },
    enableAutoBilling: {
      type: Boolean,
      default: true,
      comment: "Automatically generate bills according to schedule",
    },
    sendInvoiceOnInstall: {
      type: Boolean,
      default: true,
      comment: "Send invoice email immediately when bill is created",
    },
    requireAdminActivation: {
      type: Boolean,
      default: false,
      comment:
        "Require admin to manually activate service after pro-rated payment",
    },
  },
  {
    timestamps: true,
  },
);

// Static method to get or create default settings
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
      proRatedDueDay: 25,
      monthlyDueDay: 5,
      billingCutoffDay: 23,
      enableAutoBilling: true,
      sendInvoiceOnInstall: true,
      requireAdminActivation: false,
    });
    console.log("✅ Default billing settings created with new billing flow");
  }
  return settings;
};

export default mongoose.model<IBillingSettings>(
  "BillingSettings",
  BillingSettingsSchema,
);
