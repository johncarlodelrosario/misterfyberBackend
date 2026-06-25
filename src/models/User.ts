import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  buildingId?: mongoose.Types.ObjectId;
  buildingName?: string;
  tower?: string;
  floor?: string;
  unitNumber?: string;
  address?: {
    street?: string;
    city?: string;
    province?: string;
    zipCode?: string;
  };
  idType?: string;
  idNumber?: string;
  idImage?: string;
  profilePicture?: string;
  planId?: mongoose.Types.ObjectId;
  applicationId?: string;
  macAddress?: string;
  status:
    | "active"
    | "inactive"
    | "suspended"
    | "pending"
    | "paused"
    | "pending_activation";
  lastLogin?: Date;
  failedLoginAttempts: number;
  lastFailedLogin?: Date;
  emailVerified: boolean;
  googleId?: string;
  facebookId?: string;
  deletionRequested: boolean;
  deletionReason?: string;
  deletionRequestedAt?: Date;
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    push: boolean;
    billingReminders: boolean;
    serviceUpdates: boolean;
    promotional: boolean;
  };
  mikrotik: {
    username: string;
    password: string;
    profile: string;
    ipAddress: string;
    macAddress: string;
  };
  billingInfo: {
    currentBill: number;
    lastPayment: Date;
    nextBillingDate: Date;
    paymentMethod: string;
    autoPay: boolean;
    billingCycleId?: mongoose.Types.ObjectId;
  };
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema: Schema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    buildingId: { type: Schema.Types.ObjectId, ref: "Building" },
    buildingName: { type: String },
    tower: { type: String, required: false, default: "" },
    floor: { type: String },
    unitNumber: { type: String },
    address: {
      street: { type: String },
      city: { type: String },
      province: { type: String },
      zipCode: { type: String },
    },
    idType: { type: String },
    idNumber: { type: String },
    idImage: { type: String },
    profilePicture: { type: String },
    planId: { type: Schema.Types.ObjectId, ref: "Plan" },
    applicationId: { type: String, index: true },
    macAddress: { type: String, required: false, default: "" },
    status: {
      type: String,
      enum: [
        "active",
        "inactive",
        "suspended",
        "pending",
        "paused",
        "pending_activation",
      ],
      default: "pending",
    },
    lastLogin: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lastFailedLogin: { type: Date },
    emailVerified: { type: Boolean, default: false },
    googleId: { type: String, sparse: true },
    facebookId: { type: String, sparse: true },
    deletionRequested: { type: Boolean, default: false },
    deletionReason: { type: String },
    deletionRequestedAt: { type: Date },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      billingReminders: { type: Boolean, default: true },
      serviceUpdates: { type: Boolean, default: true },
      promotional: { type: Boolean, default: false },
    },
    mikrotik: {
      username: { type: String, default: "" },
      password: { type: String, default: "" },
      profile: { type: String, default: "" },
      ipAddress: { type: String, default: "" },
      macAddress: { type: String, default: "" },
    },
    billingInfo: {
      currentBill: { type: Number, default: 0 },
      lastPayment: { type: Date },
      nextBillingDate: { type: Date },
      paymentMethod: { type: String, default: "" },
      autoPay: { type: Boolean, default: false },
      billingCycleId: { type: Schema.Types.ObjectId, ref: "BillingCycle" },
    },
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ username: 1 }, { unique: true });
UserSchema.index({ status: 1 });
UserSchema.index({ applicationId: 1 });
UserSchema.index({ "mikrotik.username": 1 });
UserSchema.index({ "billingInfo.billingCycleId": 1 });

UserSchema.pre<IUser>("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

UserSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

const User = mongoose.model<IUser>("User", UserSchema);
export default User;
