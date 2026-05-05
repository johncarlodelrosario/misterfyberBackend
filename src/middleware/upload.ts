import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";
import { v2 as cloudinary } from "cloudinary";

// FIXED: Import CloudinaryStorage ng tama
const multerStorageCloudinary = require("multer-storage-cloudinary");
const CloudinaryStorage = multerStorageCloudinary.CloudinaryStorage;

// Configure Cloudinary gamit ang credentials mula sa .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log("📦 Cloudinary configured with:");
console.log(`   Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);
console.log(
  `   API Key: ${process.env.CLOUDINARY_API_KEY ? "✅ SET" : "❌ NOT SET"}`,
);
console.log(
  `   API Secret: ${process.env.CLOUDINARY_API_SECRET ? "✅ SET" : "❌ NOT SET"}`,
);

// Ensure local upload directories exist (fallback)
const createUploadDirs = () => {
  const dirs = ["uploads/id-cards", "uploads/payments", "uploads/temp"];
  dirs.forEach((dir) => {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`📁 Created directory: ${fullPath}`);
    }
  });
};
createUploadDirs();

// Cloudinary storage for ID cards - PRESERVE ORIGINAL FILENAME
const idCardCloudStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req: any, file: any) => {
    // GAMITIN ANG EXACT ORIGINAL NAME NG FILE - HINDI BABAGUHIN!
    const originalName = file.originalname;
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
    const safeName = nameWithoutExt.replace(/\s/g, "_");

    console.log(`📁 Uploading to Cloudinary: ${safeName}`);

    return {
      folder: "misterfyber/id-cards",
      public_id: safeName,
      resource_type: "auto",
    };
  },
});

// Cloudinary storage for payment proofs
const paymentCloudStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req: any, file: any) => {
    const originalName = file.originalname;
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
    const safeName = nameWithoutExt.replace(/\s/g, "_");

    return {
      folder: "misterfyber/payments",
      public_id: safeName,
      resource_type: "auto",
    };
  },
});

// Local storage fallback
const idCardLocalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads/id-cards/");
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname;
    const safeName = originalName.replace(/\s/g, "_");
    cb(null, safeName);
  },
});

const paymentLocalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads/payments/");
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname;
    const safeName = originalName.replace(/\s/g, "_");
    cb(null, safeName);
  },
});

// File filter function
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("Only images (jpeg, jpg, png, gif) and PDFs are allowed"));
  }
};

const limits = {
  fileSize: 5 * 1024 * 1024,
  files: 5,
};

// Use Cloudinary (auto-detect kung may credentials)
const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

console.log(`📦 Using ${useCloudinary ? "CLOUDINARY" : "LOCAL"} storage`);

export const uploadIdCard = multer({
  storage: useCloudinary ? idCardCloudStorage : idCardLocalStorage,
  fileFilter: fileFilter,
  limits: limits,
});

export const uploadPaymentProof = multer({
  storage: useCloudinary ? paymentCloudStorage : paymentLocalStorage,
  fileFilter: fileFilter,
  limits: limits,
});

export const uploadMultiple = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(process.cwd(), "uploads/temp/");
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const originalName = file.originalname;
      const safeName = originalName.replace(/\s/g, "_");
      cb(null, `temp-${safeName}`);
    },
  }),
  fileFilter: fileFilter,
  limits: limits,
});

export const uploadIdCardSingle = uploadIdCard.single("idImage");
export const uploadPaymentProofSingle =
  uploadPaymentProof.single("paymentProof");
export const uploadMultipleFiles = uploadMultiple.array("files", 5);

export const getFileUrl = (filePath: string, req?: Request): string => {
  if (!filePath) return "";

  // Cloudinary URL
  if (
    filePath.includes("cloudinary.com") ||
    filePath.startsWith("https://res.cloudinary.com")
  ) {
    return filePath;
  }

  // Data URL
  if (filePath.startsWith("data:")) {
    return filePath;
  }

  // Local storage
  const baseUrl =
    process.env.BASE_URL || "https://misterfyberbackend.onrender.com";
  let cleanPath = filePath.replace(/\\/g, "/");
  if (!cleanPath.startsWith("uploads/")) {
    cleanPath = `uploads/${cleanPath}`;
  }

  return `${baseUrl}/${cleanPath}`;
};
