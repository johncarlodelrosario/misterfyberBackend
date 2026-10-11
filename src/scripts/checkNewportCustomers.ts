import mongoose from "mongoose";
import dotenv from "dotenv";
import Application from "../models/Application";
import Payment from "../models/Payment";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not found");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB\n");

  const apps = await Application.find({
    buildingName: "Newport Residences",
  }).lean();

  console.log(`Total Newport customers: ${apps.length}\n`);
  console.log("==================================================");

  let withPayments = 0;
  let withoutPayments = 0;
  const noPaymentList: any[] = [];

  for (const app of apps) {
    const paymentCount = await Payment.countDocuments({
      applicationId: app.applicationId,
    });

    if (paymentCount > 0) {
      withPayments++;
      console.log(`✅ ${app.firstName} ${app.lastName} (${app.applicationId}) - ${paymentCount} payment(s)`);
    } else {
      withoutPayments++;
      noPaymentList.push({
        applicationId: app.applicationId,
        name: `${app.firstName} ${app.lastName}`,
        email: app.email,
      });
      console.log(`❌ ${app.firstName} ${app.lastName} (${app.applicationId}) - WALANG PAYMENT`);
    }
  }

  console.log("\n==================================================");
  console.log(`With payments    : ${withPayments}`);
  console.log(`Without payments : ${withoutPayments}`);
  console.log("==================================================\n");

  if (noPaymentList.length > 0) {
    console.log("Mga customers na WALANG payment:");
    console.log(JSON.stringify(noPaymentList, null, 2));
  }

  await mongoose.disconnect();
  console.log("\nDisconnected");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
