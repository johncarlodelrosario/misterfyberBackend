// models/EmailSchedule.ts

import mongoose, { Schema, Document } from "mongoose";

export interface IEmailSchedule extends Document {
  name: string;
  applicationIds: string[];
  subject: string;
  message: string;
  richTextContent: string;
  includeBilling: boolean;
  billIds?: string[];
  billType?: "unpaid" | "latest" | "installation";
  sendCopyToAdmin: boolean;
  useAdminSender: boolean;
  scheduledFor: Date;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  sentCount: number;
  failedCount: number;
  totalRecipients: number;
  lastRunAt?: Date;
  completedAt?: Date;
  error?: string;
  createdBy: string;
  createdByEmail: string;
  locationFilter?: "all" | "breeze" | "sil" | "other";
  recurring: {
    enabled: boolean;
    frequency: "daily" | "weekly" | "monthly";
    interval: number;
    endDate?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const EmailScheduleSchema = new Schema<IEmailSchedule>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    applicationIds: {
      type: [String],
      default: [],
    },
    subject: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    richTextContent: {
      type: String,
      default: "",
    },
    includeBilling: {
      type: Boolean,
      default: false,
    },
    billIds: {
      type: [String],
      default: [],
    },
    billType: {
      type: String,
      enum: ["unpaid", "latest", "installation"],
    },
    sendCopyToAdmin: {
      type: Boolean,
      default: false,
    },
    useAdminSender: {
      type: Boolean,
      default: false,
    },
    scheduledFor: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "sent", "failed", "cancelled"],
      default: "pending",
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    totalRecipients: {
      type: Number,
      default: 0,
    },
    lastRunAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    error: {
      type: String,
    },
    createdBy: {
      type: String,
      required: true,
    },
    createdByEmail: {
      type: String,
      required: true,
    },
    locationFilter: {
      type: String,
      enum: ["all", "breeze", "sil", "other"],
      default: "all",
    },
    recurring: {
      enabled: {
        type: Boolean,
        default: false,
      },
      frequency: {
        type: String,
        enum: ["daily", "weekly", "monthly"],
        default: "weekly",
      },
      interval: {
        type: Number,
        default: 1,
      },
      endDate: {
        type: Date,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient querying
EmailScheduleSchema.index({ scheduledFor: 1, status: 1 });
EmailScheduleSchema.index({ status: 1 });
EmailScheduleSchema.index({ createdBy: 1 });
EmailScheduleSchema.index({ locationFilter: 1 });

export default mongoose.model<IEmailSchedule>(
  "EmailSchedule",
  EmailScheduleSchema,
);
