import mongoose from "mongoose";
import dotenv from "dotenv";
import Billing from "../models/Billing";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) process.exit(1);

  await mongoose.connect(mongoUri);
  console.log("Connected\n");

  // Bilang ng pro-rated bills ngayon
  const proRatedCount = await Billing.countDocuments({
    isProRated: true,
    isInstallationBill: false,
  });

  const wrongProRated = await Billing.countDocuments({
    isProRated: true,
    isInstallationBill: false,
    proRatedDays: 1,
  });

  const regularMonthly = await Billing.countDocuments({
    isProRated: false,
    isInstallationBill: false,
  });

  console.log("==================================================");
  console.log("VERIFICATION");
  console.log("==================================================");
  console.log(`Pro-rated bills (total)         : ${proRatedCount}`);
  console.log(`Pro-rated with days=1 (MALI)    : ${wrongProRated}   ${wrongProRated === 0 ? "✅" : "❌"}`);
  console.log(`Regular monthly bills           : ${regularMonthly}`);
  console.log("==================================================");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
