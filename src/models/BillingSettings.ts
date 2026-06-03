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
  proRatedDueDay: number;
  monthlyDueDay: number;
  billingCutoffDay: number;
  enableAutoBilling: boolean;
  sendInvoiceOnInstall: boolean;
  requireAdminActivation: boolean;
  installationFee: number;
  installationFeeDueDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const BillingSettingsSchema: Schema = new Schema(
  {
    reminderDays: { type: [Number], default: [7, 3, 1] },
    dueDateDaysAfterPeriod: { type: Number, default: 5 },
    gracePeriodDays: { type: Number, default: 5 },
    autoGenerateBills: { type: Boolean, default: true },
    autoSendReminders: { type: Boolean, default: true },
    autoSuspendOnNonPayment: { type: Boolean, default: true },
    billingCycleDay: { type: Number, default: 1 },
    freeDays: { type: Number, default: 0 },
    proRatedDueDay: { type: Number, default: 25, min: 1, max: 31 },
    monthlyDueDay: { type: Number, default: 5, min: 1, max: 31 },
    billingCutoffDay: { type: Number, default: 24, min: 1, max: 31 },
    enableAutoBilling: { type: Boolean, default: true },
    sendInvoiceOnInstall: { type: Boolean, default: true },
    requireAdminActivation: { type: Boolean, default: false },
    installationFee: { type: Number, default: 1500, min: 0 },
    installationFeeDueDays: { type: Number, default: 7, min: 1, max: 30 },
  },
  { timestamps: true },
);

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
      freeDays: 0,
      proRatedDueDay: 25,
      monthlyDueDay: 5,
      billingCutoffDay: 24,
      enableAutoBilling: true,
      sendInvoiceOnInstall: true,
      requireAdminActivation: false,
      installationFee: 1500,
      installationFeeDueDays: 7,
    });
  }
  return settings;
};

export default mongoose.model<IBillingSettings>(
  "BillingSettings",
  BillingSettingsSchema,
);
