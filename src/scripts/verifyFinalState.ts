import mongoose from "mongoose";
import dotenv from "dotenv";
import Billing from "../models/Billing";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) process.exit(1);

  await mongoose.connect(mongoUri);
  console.log("Connected\n");

  const totalBills = await Billing.countDocuments({ isInstallationBill: false });
  const proRated = await Billing.countDocuments({ isProRated: true, isInstallationBill: false });
  const regular = await Billing.countDocuments({ isProRated: false, isInstallationBill: false });
  const wrong = await Billing.countDocuments({
    isProRated: true,
    isInstallationBill: false,
    proRatedDays: 1,
    total: { $gt: 500 },  // buong monthly rate lang ang mali
  });

  console.log("==================================================");
  console.log("FINAL STATE");
  console.log("==================================================");
  console.log(`Total monthly bills   : ${totalBills}`);
  console.log(`Pro-rated (tama)      : ${proRated}`);
  console.log(`Regular monthly (tama): ${regular}`);
  console.log(`MALI PA (dapat 0)     : ${wrong}   ${wrong === 0 ? "✅" : "❌"}`);
  console.log("==================================================");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
