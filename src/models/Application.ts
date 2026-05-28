import mongoose, { Schema, Document } from "mongoose";

export interface IApplication extends Document {
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  buildingId?: mongoose.Types.ObjectId;
  buildingName?: string;
  floor?: string;
  unitNumber?: string;
  notes?: string;
  planId: mongoose.Types.ObjectId;
  idType?: string;
  idNumber?: string;
  idImage?: string;
  status: "pending" | "approved" | "rejected";
  adminNotes: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  registeredUserId?: mongoose.Types.ObjectId;
  billingStarted: boolean;
  billingCycleId?: mongoose.Types.ObjectId;
  approvalEmailSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function getBuildingAbbreviation(buildingName?: string): string {
  if (!buildingName) return "MAN";
  if (buildingName && buildingName.toUpperCase() === "SILK") return "SLK";
  if (buildingName && buildingName.trim().length >= 3) {
    return buildingName.trim().toUpperCase().substring(0, 3);
  }
  if (buildingName && buildingName.trim().length > 0) {
    return buildingName.trim().toUpperCase().padEnd(3, "X");
  }
  return "MAN";
}

function generateApplicationIdSync(buildingName?: string): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const randomNum = Math.floor(1000000 + Math.random() * 9000000).toString();
  let buildingCode = getBuildingAbbreviation(buildingName);
  return `${buildingCode}${year}${month}${randomNum}`;
}

const ApplicationSchema: Schema = new Schema(
  {
    applicationId: {
      type: String,
      required: true,
      unique: true,
      default: function () {
        return generateApplicationIdSync(this.buildingName);
      },
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phoneNumber: { type: String, required: true },
    buildingId: {
      type: Schema.Types.ObjectId,
      ref: "Building",
      required: false,
    },
    buildingName: { type: String, required: false },
    floor: { type: String, required: false, default: "Not Provided" },
    unitNumber: { type: String, required: false, default: "Not Provided" },
    notes: { type: String, default: "" },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    idType: { type: String, required: false, default: "Not Provided" },
    idNumber: {
      type: String,
      required: false,
      default: "Not Provided",
    },
    idImage: { type: String, required: false, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    adminNotes: { type: String, default: "" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    registeredUserId: { type: Schema.Types.ObjectId, ref: "User" },
    billingStarted: { type: Boolean, default: false },
    billingCycleId: { type: Schema.Types.ObjectId, ref: "BillingCycle" },
    approvalEmailSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ApplicationSchema.index({ applicationId: 1 });
ApplicationSchema.index({ email: 1 });
ApplicationSchema.index({ status: 1 });
ApplicationSchema.index({ registeredUserId: 1 });
ApplicationSchema.index({ billingCycleId: 1 });

export default mongoose.model<IApplication>("Application", ApplicationSchema);
