// backend/src/models/Building.ts - COMPLETE WITH INSTALLATION FEE PER BUILDING

import mongoose, { Schema, Document } from "mongoose";

export interface IBuilding extends Document {
  buildingName: string;
  region: string;
  province: string;
  city: string;
  barangay: string;
  streetAddress: string;
  zipCode?: string;
  location: "breeze" | "sil" | "other" | "";
  installationFee: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BuildingSchema: Schema = new Schema(
  {
    buildingName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    region: {
      type: String,
      required: false,
    },
    province: {
      type: String,
      required: false,
    },
    city: {
      type: String,
      required: false,
    },
    barangay: {
      type: String,
      required: false,
    },
    streetAddress: {
      type: String,
      required: false,
    },
    zipCode: {
      type: String,
      default: "",
    },
    location: {
      type: String,
      enum: ["breeze", "sil", "other", ""],
      default: "",
      required: false,
    },
    installationFee: {
      type: Number,
      default: 1500,
      min: 0,
      required: true,
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

BuildingSchema.index({ buildingName: 1 });
BuildingSchema.index({ region: 1, province: 1, city: 1 });
BuildingSchema.index({ isActive: 1 });
BuildingSchema.index({ location: 1 });
BuildingSchema.index({ installationFee: 1 });

export default mongoose.model<IBuilding>("Building", BuildingSchema);
