import mongoose, { Schema, Document } from "mongoose";

export interface IBilling extends Document {
  userId: mongoose.Types.ObjectId;
  invoiceNumber: string;
  billingPeriod: {
    start: Date;
    end: Date;
  };
  dueDate: Date;
  items: {
    description: string;
    quantity: number;
    rate: number;
    amount: number;
  }[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  status:
    | "draft"
    | "sent"
    | "paid"
    | "overdue"
    | "cancelled"
    | "pending_confirmation";
  paymentId: mongoose.Types.ObjectId;
  notes: string;
  isProRated: boolean;
  proRatedDays: number;
  billingCycleId: mongoose.Types.ObjectId;
  applicationId: string;
  reminder7DaySent: boolean;
  reminder3DaySent: boolean;
  reminder1DaySent: boolean;
  reminderDueDateSent: boolean;
  suspensionNotified: boolean;
  // SEPARATE INSTALLATION FEE TRACKING
  isInstallationBill: boolean;
  installationFee: number;
  installationFeePaid: boolean;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function generateInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `INV-${year}${month}-${timestamp}${random}`;
}

const BillingSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      default: generateInvoiceNumber,
    },
    billingPeriod: {
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },
    dueDate: { type: Date, required: true },
    items: [
      {
        description: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: {
      type: String,
      enum: [
        "draft",
        "sent",
        "paid",
        "overdue",
        "cancelled",
        "pending_confirmation",
      ],
      default: "draft",
    },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    notes: { type: String },
    isProRated: { type: Boolean, default: false },
    proRatedDays: { type: Number, default: 0 },
    billingCycleId: { type: Schema.Types.ObjectId, ref: "BillingCycle" },
    applicationId: { type: String, ref: "Application", index: true },
    reminder7DaySent: { type: Boolean, default: false },
    reminder3DaySent: { type: Boolean, default: false },
    reminder1DaySent: { type: Boolean, default: false },
    reminderDueDateSent: { type: Boolean, default: false },
    suspensionNotified: { type: Boolean, default: false },
    // SEPARATE INSTALLATION FEE TRACKING
    isInstallationBill: { type: Boolean, default: false },
    installationFee: { type: Number, default: 0 },
    installationFeePaid: { type: Boolean, default: false },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

BillingSchema.pre("validate", function (next) {
  if (!this.invoiceNumber) {
    this.invoiceNumber = generateInvoiceNumber();
  }
  next();
});

BillingSchema.index({ invoiceNumber: 1 });
BillingSchema.index({ userId: 1, status: 1 });
BillingSchema.index({ dueDate: 1 });
BillingSchema.index({ isProRated: 1, status: 1 });
BillingSchema.index({ applicationId: 1 });
BillingSchema.index({ installationFeePaid: 1 });
BillingSchema.index({ isInstallationBill: 1 });

export default mongoose.model<IBilling>("Billing", BillingSchema);
