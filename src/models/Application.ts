import mongoose, { Schema, Document } from "mongoose";

export interface IApplication extends Document {
  applicationId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  phoneNumber: string;
  birthDate?: Date;
  gender?: string;
  idType: string;
  idNumber: string;
  idImage?: string;
  selfiePhoto?: string;
  buildingId: mongoose.Types.ObjectId;
  buildingName: string;
  floor?: string;
  unitNumber?: string;
  tower?: string;
  macAddress?: string;
  planId: mongoose.Types.ObjectId;
  status: "pending" | "approved" | "rejected" | "suspended";
  adminNotes?: string;
  billingStarted: boolean;
  billingCycleId?: mongoose.Types.ObjectId;
  serviceStatus: "pending" | "active" | "suspended" | "disconnected";
  installationFee: number;
  installationFeePaid: boolean;
  registeredUserId?: mongoose.Types.ObjectId;
  notes?: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  approvalEmailSent?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema: Schema = new Schema(
  {
    applicationId: {
      type: String,
      required: true,
      unique: true,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    middleName: {
      type: String,
    },
    email: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    birthDate: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    idType: {
      type: String,
      required: true,
    },
    idNumber: {
      type: String,
      required: true,
    },
    idImage: {
      type: String,
      default: "",
    },
    selfiePhoto: {
      type: String,
    },
    buildingId: {
      type: Schema.Types.ObjectId,
      ref: "Building",
      required: true,
    },
    buildingName: {
      type: String,
      required: true,
    },
    floor: {
      type: String,
    },
    unitNumber: {
      type: String,
    },
    tower: {
      type: String,
      default: "",
    },
    macAddress: {
      type: String,
      default: "",
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    adminNotes: {
      type: String,
    },
    billingStarted: {
      type: Boolean,
      default: false,
    },
    billingCycleId: {
      type: Schema.Types.ObjectId,
      ref: "BillingCycle",
    },
    serviceStatus: {
      type: String,
      enum: ["pending", "active", "suspended", "disconnected"],
      default: "pending",
    },
    installationFee: {
      type: Number,
      default: 0,
    },
    installationFeePaid: {
      type: Boolean,
      default: false,
    },
    registeredUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      default: "",
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewedAt: {
      type: Date,
    },
    approvalEmailSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// ================================================
// FIXED: Pre-save middleware to generate applicationId
// This will run BEFORE any application is saved
// ================================================
ApplicationSchema.pre("save", async function (next) {
  // Only generate if applicationId is not already set
  if (!this.applicationId) {
    try {
      // Count existing applications to get sequential number
      const Application = mongoose.model("Application");
      const count = await Application.countDocuments();

      // Format: APP-2024-0001
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      const sequentialNumber = String(count + 1).padStart(4, "0");

      this.applicationId = `APP-${year}${month}-${sequentialNumber}`;

      console.log(`✅ Auto-generated applicationId: ${this.applicationId}`);
    } catch (error) {
      console.error("❌ Error generating applicationId:", error);
      // Fallback: use timestamp if count fails
      const timestamp = Date.now().toString().slice(-6);
      this.applicationId = `APP-${timestamp}`;
    }
  }
  next();
});

// ================================================
// FIXED: Pre-validate hook to ensure applicationId exists
// ================================================
ApplicationSchema.pre("validate", function (next) {
  if (!this.applicationId) {
    // Generate a temporary ID if validation runs before save
    const timestamp = Date.now().toString().slice(-6);
    this.applicationId = `APP-TEMP-${timestamp}`;
  }
  next();
});

// INDEXES for performance
ApplicationSchema.index({ applicationId: 1 }, { unique: true });
ApplicationSchema.index({ email: 1 });
ApplicationSchema.index({ buildingId: 1 });
ApplicationSchema.index({ status: 1 });
ApplicationSchema.index({ billingStarted: 1 });
ApplicationSchema.index({ registeredUserId: 1 });
ApplicationSchema.index({ createdAt: -1 });

export default mongoose.model<IApplication>("Application", ApplicationSchema);
