// models/EmailTemplate.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IEmailTemplate extends Document {
  name: string;
  subject: string;
  message: string;
  category: string;
  includeBillingDefault: boolean;
  createdBy: string;
  createdByEmail: string;
  updatedBy: string;
  updatedByEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      default: "general",
      enum: ["general", "billing", "reminder", "promotional", "support"],
    },
    includeBillingDefault: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: String,
      required: true,
    },
    createdByEmail: {
      type: String,
      required: true,
    },
    updatedBy: {
      type: String,
      required: true,
    },
    updatedByEmail: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
EmailTemplateSchema.index({ name: 1 });
EmailTemplateSchema.index({ category: 1 });
EmailTemplateSchema.index({ createdAt: -1 });

export default mongoose.model<IEmailTemplate>(
  "EmailTemplate",
  EmailTemplateSchema,
);
