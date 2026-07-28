// models/application.model.ts
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

const getBuildingCode = (buildingName: string): string => {
  if (!buildingName) return "UNK";
  const name = buildingName.toUpperCase().trim();

  if (
    name.includes("EL PUEBLO") ||
    name.includes("EL PUEBLO MANILA") ||
    name.includes("EL PUEBLO MANILA CONDOMINIUM")
  ) {
    return "EPM";
  }
  if (name.includes("SILK") || name.includes("SILK RESIDENCE")) return "SIL";
  if (name.includes("VITALEZ") || name.includes("VITALEZ RESIDENCE"))
    return "VIT";
  if (name.includes("NEWPORT") || name.includes("NEWPORT RESIDENCE"))
    return "NEW";
  if (name.includes("METRO") || name.includes("METRO RESIDENCE")) return "MET";
  if (name.includes("EAST") || name.includes("EAST RESIDENCE")) return "EST";
  if (name.includes("WEST") || name.includes("WEST RESIDENCE")) return "WST";
  if (name.includes("NORTH") || name.includes("NORTH RESIDENCE")) return "NTH";
  if (name.includes("SOUTH") || name.includes("SOUTH RESIDENCE")) return "STH";
  if (name.includes("CENTRAL") || name.includes("CENTRAL RESIDENCE"))
    return "CTR";
  if (name.includes("GARDEN") || name.includes("GARDEN RESIDENCE"))
    return "GRD";
  if (name.includes("PARK") || name.includes("PARK RESIDENCE")) return "PRK";
  if (name.includes("LAKE") || name.includes("LAKE RESIDENCE")) return "LAK";
  if (name.includes("MOUNTAIN") || name.includes("MOUNTAIN RESIDENCE"))
    return "MTN";
  if (name.includes("OCEAN") || name.includes("OCEAN RESIDENCE")) return "OCN";
  if (name.includes("SUN") || name.includes("SUN RESIDENCE")) return "SUN";
  if (name.includes("MOON") || name.includes("MOON RESIDENCE")) return "MON";
  if (name.includes("STAR") || name.includes("STAR RESIDENCE")) return "STR";
  if (name.includes("ROYAL") || name.includes("ROYAL RESIDENCE")) return "ROY";
  if (name.includes("GRAND") || name.includes("GRAND RESIDENCE")) return "GRN";
  if (name.includes("TOWER") || name.includes("TOWER RESIDENCE")) return "TWR";
  if (name.includes("PLAZA") || name.includes("PLAZA RESIDENCE")) return "PLZ";
  if (name.includes("VILLA") || name.includes("VILLA RESIDENCE")) return "VIL";
  if (name.includes("TERRACE") || name.includes("TERRACE RESIDENCE"))
    return "TER";
  if (name.includes("HEIGHTS") || name.includes("HEIGHTS RESIDENCE"))
    return "HGT";
  if (name.includes("VIEW") || name.includes("VIEW RESIDENCE")) return "VIW";
  if (name.includes("HILL") || name.includes("HILL RESIDENCE")) return "HIL";
  if (name.includes("VALLEY") || name.includes("VALLEY RESIDENCE"))
    return "VAL";
  if (name.includes("RIDGE") || name.includes("RIDGE RESIDENCE")) return "RID";

  const words = name.split(" ");
  if (words.length >= 2) {
    return (words[0][0] + words[1].substring(0, 2)).toUpperCase();
  }
  return name.substring(0, 3);
};

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

ApplicationSchema.pre("save", async function (next) {
  if (!this.applicationId) {
    try {
      const buildingCode = getBuildingCode(this.buildingName || "");
      const year = new Date().getFullYear().toString().slice(-2);
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      const randomNumbers = Math.floor(
        Math.random() * 9000000 + 1000000,
      ).toString();
      this.applicationId = `${buildingCode}${year}${month}${randomNumbers}`;
      console.log(`✅ Auto-generated applicationId: ${this.applicationId}`);

      const Application = mongoose.model("Application");
      const existing = await Application.findOne({
        applicationId: this.applicationId,
      });
      if (existing) {
        const newRandom = Math.floor(
          Math.random() * 9000000 + 1000000,
        ).toString();
        this.applicationId = `${buildingCode}${year}${month}${newRandom}`;
        console.log(`🔄 Regenerated applicationId: ${this.applicationId}`);
      }
    } catch (error) {
      console.error("❌ Error generating applicationId:", error);
      const timestamp = Date.now().toString().slice(-7);
      const buildingCode = getBuildingCode(this.buildingName || "");
      const year = new Date().getFullYear().toString().slice(-2);
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      this.applicationId = `${buildingCode}${year}${month}${timestamp}`;
    }
  }
  next();
});

ApplicationSchema.pre("validate", function (next) {
  if (!this.applicationId) {
    const buildingCode = getBuildingCode(this.buildingName || "");
    const year = new Date().getFullYear().toString().slice(-2);
    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    const random = Math.floor(Math.random() * 9000000 + 1000000).toString();
    this.applicationId = `${buildingCode}${year}${month}${random}`;
  }
  next();
});

ApplicationSchema.index({ applicationId: 1 }, { unique: true });
ApplicationSchema.index({ email: 1 });
ApplicationSchema.index({ buildingId: 1 });
ApplicationSchema.index({ status: 1 });
ApplicationSchema.index({ billingStarted: 1 });
ApplicationSchema.index({ registeredUserId: 1 });
ApplicationSchema.index({ createdAt: -1 });

export default mongoose.model<IApplication>("Application", ApplicationSchema);
