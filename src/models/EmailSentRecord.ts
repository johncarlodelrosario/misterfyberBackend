// models/EmailSentRecord.ts

import mongoose, { Schema, Document } from "mongoose";

export interface IEmailSentRecord extends Document {
  applicationId: string;
  customerName: string;
  customerEmail: string;
  subject: string;
  message: string;
  sentAt: Date;
  status: "sent" | "failed" | "pending";
  isBulk: boolean;
  recipientCount?: number;
  includeBilling: boolean;
  billType?: string;
  // CHANGED: support multiple bill IDs
  billIds?: string[];
  billCount?: number;
  error?: string;
  sentBy: string;
  sentByEmail: string;
  adminCopySent?: boolean;
  senderType?: "admin" | "collection";
  location?: string;
  collectionEmail?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailSentRecordSchema = new Schema<IEmailSentRecord>(
  {
    applicationId: {
      type: String,
      required: true,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
      required: true,
    },
    subject: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["sent", "failed", "pending"],
      default: "sent",
    },
    isBulk: {
      type: Boolean,
      default: false,
    },
    recipientCount: {
      type: Number,
      default: 1,
    },
    includeBilling: {
      type: Boolean,
      default: false,
    },
    billType: {
      type: String,
      enum: ["unpaid", "latest", "installation"],
    },
    // CHANGED: support multiple bill IDs
    billIds: {
      type: [String],
      default: [],
    },
    billCount: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
    },
    sentBy: {
      type: String,
      required: true,
    },
    sentByEmail: {
      type: String,
      required: true,
    },
    adminCopySent: {
      type: Boolean,
      default: false,
    },
    senderType: {
      type: String,
      enum: ["admin", "collection"],
      default: "collection",
    },
    location: {
      type: String,
      default: "unknown",
    },
    collectionEmail: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

EmailSentRecordSchema.index({ applicationId: 1, sentAt: -1 });
EmailSentRecordSchema.index({ status: 1 });
EmailSentRecordSchema.index({ isBulk: 1 });
EmailSentRecordSchema.index({ sentAt: -1 });
EmailSentRecordSchema.index({ senderType: 1 });
EmailSentRecordSchema.index({ location: 1 });

export default mongoose.model<IEmailSentRecord>(
  "EmailSentRecord",
  EmailSentRecordSchema,
);
