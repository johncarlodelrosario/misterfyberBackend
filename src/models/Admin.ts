import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface IAdmin extends Document {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  role: "super_admin" | "admin" | "staff";
  status: "active" | "inactive" | "suspended";
  permissions: string[];
  customerEmailAlertsEnabled: boolean; // Controls CUSTOMER emails
  lastLogin?: Date;
  profilePicture?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const AdminSchema: Schema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String },
    role: {
      type: String,
      enum: ["super_admin", "admin", "staff"],
      default: "staff",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    permissions: [{ type: String }],
    customerEmailAlertsEnabled: { type: Boolean, default: true }, // Default: ON (customers receive emails)
    lastLogin: { type: Date },
    profilePicture: { type: String },
  },
  {
    timestamps: true,
  },
);

AdminSchema.index({ email: 1 }, { unique: true });
AdminSchema.index({ username: 1 }, { unique: true });
AdminSchema.index({ role: 1 });
AdminSchema.index({ status: 1 });

AdminSchema.pre<IAdmin>("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

AdminSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

AdminSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

const Admin = mongoose.model<IAdmin>("Admin", AdminSchema);
export default Admin;
