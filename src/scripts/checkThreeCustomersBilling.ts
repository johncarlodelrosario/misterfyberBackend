import mongoose from "mongoose";
import dotenv from "dotenv";
import Application from "../models/Application";
import BillingCycle from "../models/BillingCycle";

dotenv.config();

const TARGETS = [
  { appId: "NEW26094666842", name: "Angelica Mae Gonda" },
  { appId: "NEW26092834120", name: "Rj Lasiste" },
  { appId: "NEW26103270419", name: "HIyasmin Villamor" },
];

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) { console.error("No URI"); process.exit(1); }

  await mongoose.connect(mongoUri);
  console.log("Connected\n");

  for (const t of TARGETS) {
    const app = await Application.findOne({ applicationId: t.appId }).lean();
    const cycle = await BillingCycle.findOne({ applicationId: t.appId }).lean();

    console.log("==================================================");
    console.log(`${t.name} (${t.appId})`);
    console.log("==================================================");
    if (app) {
      console.log(`  application status   : ${app.status}`);
      console.log(`  billingStarted       : ${(app as any).billingStarted}`);
      console.log(`  serviceStatus        : ${(app as any).serviceStatus}`);
      console.log(`  buildingName         : ${(app as any).buildingName}`);
      console.log(`  buildingId           : ${(app as any).buildingId}`);
    } else {
      console.log("  APPLICATION NOT FOUND");
    }
    if (cycle) {
      console.log(`  BillingCycle status  : ${cycle.status}`);
      console.log(`  proRatedPaid         : ${cycle.proRatedPaid}`);
      console.log(`  billingStartDate     : ${cycle.billingStartDate}`);
    } else {
      console.log("  BILLING CYCLE: WALA");
    }
    console.log("");
  }

  await mongoose.disconnect();
  console.log("Disconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
