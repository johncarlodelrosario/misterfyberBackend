// backend/src/models/Plan.ts - COMPLETE

import mongoose, { Schema, Document } from "mongoose";

export interface IPlan extends Document {
  name: string;
  description: string;
  price: number;
  speed: {
    download: number;
    upload: number;
    unit: "Mbps" | "Gbps";
  };
  dataCap: number | null;
  features: string[];
  mikrotikProfile: string;
  duration: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    speed: {
      download: {
        type: Number,
        required: true,
      },
      upload: {
        type: Number,
        required: true,
      },
      unit: {
        type: String,
        enum: ["Mbps", "Gbps"],
        default: "Mbps",
      },
    },
    dataCap: {
      type: Number,
      default: null,
    },
    features: [
      {
        type: String,
      },
    ],
    mikrotikProfile: {
      type: String,
      required: true,
    },
    duration: {
      type: Number,
      default: 30,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// ============================================================
// INDEXES FOR FAST QUERIES
// ============================================================
PlanSchema.index({ name: 1 }, { unique: true });
PlanSchema.index({ isActive: 1 });
PlanSchema.index({ price: 1 });

export default mongoose.model<IPlan>("Plan", PlanSchema);
