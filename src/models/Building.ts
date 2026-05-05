import mongoose, { Schema, Document } from "mongoose";

export interface IBuilding extends Document {
  buildingName: string;
  region: string;
  province: string;
  city: string;
  barangay: string;
  streetAddress: string;
  zipCode?: string;
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
      required: true,
    },
    province: {
      type: String,
      required: false,
    },
    city: {
      type: String,
      required: true,
    },
    barangay: {
      type: String,
      required: true,
    },
    streetAddress: {
      type: String,
      required: true,
    },
    zipCode: {
      type: String,
      default: "",
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

export default mongoose.model<IBuilding>("Building", BuildingSchema);
