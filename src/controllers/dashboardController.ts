// backend/src/controllers/dashboardController.ts - COMPLETE FIXED WITH RETRY LOGIC
import { Request, Response, NextFunction } from "express";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import User from "../models/User";
import Payment from "../models/Payment";
import Application from "../models/Application";
import Building from "../models/Building";

type AuthRequest = Request & { user?: any };

// Cache
let dashboardCache: any = null;
let dashboardCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getDashboardData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Check cache
    const now = Date.now();
    if (dashboardCache && now - dashboardCacheTime < CACHE_TTL) {
      console.log("📦 Returning cached dashboard data");
      return res.status(200).json({
        success: true,
        data: dashboardCache,
        cached: true,
      });
    }

    console.log("🔄 Fetching fresh dashboard data...");

    // ==================== RETRY LOGIC WITH TIMEOUT ====================
    let retries = 3;
    let lastError: any = null;

    let billingCycles: any[] = [];
    let bills: any[] = [];
    let users: any[] = [];
    let applications: any[] = [];
    let pendingPayments: any[] = [];
    let customersWithoutAccounts: any[] = [];
    let pendingInstallationBills: any[] = [];
    let pendingProRated: any[] = [];
    let pendingActivations: any[] = [];
    let buildings: any[] = [];

    while (retries > 0) {
      try {
        console.log(`📊 Fetching dashboard data (attempt ${4 - retries}/3)...`);

        // Get buildings for reference
        buildings = await Building.find({}).maxTimeMS(30000).lean();

        // Run all queries in parallel with timeout
        const results = await Promise.all([
          // 1. Get all billing cycles
          BillingCycle.find({})
            .populate("planId", "name price")
            .sort({ createdAt: -1 })
            .limit(1000)
            .maxTimeMS(30000)
            .lean(),

          // 2. Get all unpaid bills
          Billing.find({
            status: { $in: ["sent", "overdue", "pending_confirmation"] },
          })
            .sort({ dueDate: 1 })
            .limit(1000)
            .maxTimeMS(30000)
            .lean(),

          // 3. Get all users
          User.find({})
            .select(
              "firstName lastName email username phoneNumber status planId building unitNumber floor",
            )
            .populate("planId", "name price")
            .limit(1000)
            .maxTimeMS(30000)
            .lean(),

          // 4. Get all applications
          Application.find({ status: { $in: ["approved", "pending"] } })
            .select(
              "firstName lastName email phoneNumber status applicationId planId buildingId buildingName unitNumber floor installationFee installationFeePaid billingStarted",
            )
            .populate("planId", "name price")
            .populate("buildingId", "buildingName streetAddress city")
            .limit(1000)
            .maxTimeMS(30000)
            .lean(),

          // 5. Get pending payments
          Payment.find({ status: "pending" })
            .sort({ createdAt: -1 })
            .limit(100)
            .maxTimeMS(30000)
            .lean(),

          // 6. Get customers without accounts
          Application.find({
            status: "approved",
            $or: [
              { registeredUserId: { $exists: false } },
              { registeredUserId: null },
            ],
            billingStarted: { $ne: true },
          })
            .select(
              "firstName lastName email applicationId planId buildingName",
            )
            .populate("planId", "name price")
            .limit(100)
            .maxTimeMS(30000)
            .lean(),

          // 7. Get pending installation bills
          Billing.find({
            isInstallationBill: true,
            installationFeePaid: false,
            status: { $in: ["sent", "overdue"] },
          })
            .sort({ dueDate: 1 })
            .limit(100)
            .maxTimeMS(30000)
            .lean(),

          // 8. Get pending pro-rated bills
          Billing.find({
            isProRated: true,
            status: "pending_confirmation",
            isInstallationBill: false,
          })
            .sort({ createdAt: -1 })
            .limit(100)
            .maxTimeMS(30000)
            .lean(),

          // 9. Get pending activations
          BillingCycle.find({
            status: "pending_activation",
            proRatedPaid: true,
            manualBillStart: false,
          })
            .populate("planId", "name price")
            .sort({ proRatedPaidAt: -1 })
            .limit(100)
            .maxTimeMS(30000)
            .lean(),
        ]);

        billingCycles = results[0];
        bills = results[1];
        users = results[2];
        applications = results[3];
        pendingPayments = results[4];
        customersWithoutAccounts = results[5];
        pendingInstallationBills = results[6];
        pendingProRated = results[7];
        pendingActivations = results[8];

        console.log(`✅ Dashboard data fetched successfully`);
        break;
      } catch (err: any) {
        lastError = err;
        retries--;
        console.log(
          `⏳ Retry ${4 - retries}/3 for dashboard... Error: ${err.message}`,
        );
        if (retries === 0) {
          console.error("❌ All retries failed for dashboard");
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // ==================== BUILD CUSTOMERS ARRAY ====================
    const userCustomers = users.map((user: any) => {
      const userBills = bills.filter(
        (bill: any) =>
          bill.userId?._id === user._id || bill.userId === user._id,
      );
      const totalBalance = userBills.reduce(
        (sum: number, bill: any) => sum + (bill.total || 0),
        0,
      );
      const overdueBills = userBills.filter(
        (bill: any) =>
          bill.status === "overdue" || new Date(bill.dueDate) < new Date(),
      );
      const userCycle = billingCycles.find(
        (cycle: any) =>
          cycle.userId?._id === user._id || cycle.userId === user._id,
      );

      let buildingObj = user.building || null;
      if (buildingObj && typeof buildingObj === "object" && !buildingObj._id) {
        const foundBuilding = buildings.find(
          (b: any) => b.buildingName === buildingObj.buildingName,
        );
        if (foundBuilding) {
          buildingObj = foundBuilding;
        }
      }

      return {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        phoneNumber: user.phoneNumber,
        status: user.status,
        type: "user" as const,
        planName: user.planId?.name || "No Plan",
        planPrice: user.planId?.price || 0,
        currentBalance: totalBalance,
        unpaidBills: userBills,
        overdueBills: overdueBills,
        billingCycle: userCycle || null,
        installationFee: 0,
        installationFeePaid: true,
        building: buildingObj,
        unitNumber: user.unitNumber,
        floor: user.floor,
      };
    });

    const applicationCustomers = applications
      .filter(
        (app: any) => app.status === "approved" || app.billingStarted === true,
      )
      .map((app: any) => {
        const appBills = bills.filter(
          (bill: any) => bill.applicationId === app.applicationId,
        );
        const totalBalance = appBills.reduce(
          (sum: number, bill: any) => sum + (bill.total || 0),
          0,
        );
        const overdueBills = appBills.filter(
          (bill: any) =>
            bill.status === "overdue" || new Date(bill.dueDate) < new Date(),
        );
        const appCycle = billingCycles.find(
          (cycle: any) => cycle.applicationId === app.applicationId,
        );

        let buildingObj = null;
        if (app.buildingId) {
          if (typeof app.buildingId === "object" && app.buildingId._id) {
            buildingObj = app.buildingId;
          } else if (typeof app.buildingId === "string") {
            const foundBuilding = buildings.find(
              (b: any) =>
                b._id === app.buildingId || b.buildingName === app.buildingId,
            );
            if (foundBuilding) {
              buildingObj = foundBuilding;
            }
          }
        }
        if (!buildingObj && app.buildingName) {
          const foundBuilding = buildings.find(
            (b: any) => b.buildingName === app.buildingName,
          );
          if (foundBuilding) {
            buildingObj = foundBuilding;
          } else {
            buildingObj = { buildingName: app.buildingName };
          }
        }

        return {
          _id: app._id,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.billingStarted ? "billing_started" : "approved",
          type: "application" as const,
          planName: app.planId?.name || "No Plan",
          planPrice: app.planId?.price || 0,
          currentBalance: totalBalance,
          unpaidBills: appBills,
          overdueBills: overdueBills,
          billingCycle: appCycle || null,
          applicationId: app.applicationId,
          installationFee: app.installationFee || 0,
          installationFeePaid: app.installationFeePaid || false,
          building: buildingObj,
          unitNumber: app.unitNumber,
          floor: app.floor,
        };
      });

    const allCustomers = [...userCustomers, ...applicationCustomers];
    allCustomers.sort((a, b) => b.currentBalance - a.currentBalance);

    // ==================== CALCULATE STATS ====================
    const totalBalance = allCustomers.reduce(
      (sum, c) => sum + c.currentBalance,
      0,
    );
    const customersWithBalance = allCustomers.filter(
      (c) => c.currentBalance > 0,
    ).length;
    const overdueCustomers = allCustomers.filter(
      (c) => c.overdueBills.length > 0,
    ).length;
    const activeCycles = billingCycles.filter(
      (c: any) => c.status === "active",
    ).length;
    const pausedCycles = billingCycles.filter(
      (c: any) => c.status === "paused",
    ).length;
    const applicationsWithoutBilling = applications.filter(
      (app: any) => app.status === "approved" && !app.billingStarted,
    ).length;

    const totalInstallationFeesDue = allCustomers
      .filter(
        (c) =>
          c.type === "application" &&
          !c.installationFeePaid &&
          (c.installationFee || 0) > 0,
      )
      .reduce((sum, c) => sum + (c.installationFee || 0), 0);
    const installationFeesPaidCount = allCustomers.filter(
      (c) => c.type === "application" && c.installationFeePaid,
    ).length;

    const stats = {
      totalCustomers: allCustomers.length,
      totalBalance: totalBalance,
      customersWithBalanceCount: customersWithBalance,
      overdueCustomersCount: overdueCustomers,
      activeCyclesCount: activeCycles,
      pausedCyclesCount: pausedCycles,
      pendingProRatedCount: pendingProRated.length,
      pendingActivationsCount: pendingActivations.length,
      pendingPaymentsCount: pendingPayments.length,
      pendingInstallationBillsCount: pendingInstallationBills.length,
      applicationsWithoutBilling: applicationsWithoutBilling,
      totalInstallationFeesDue: totalInstallationFeesDue,
      installationFeesPaidCount: installationFeesPaidCount,
    };

    // ==================== BUILD FINAL RESPONSE ====================
    const dashboardData = {
      customers: allCustomers,
      billingCycles: billingCycles,
      bills: bills,
      pendingPayments: pendingPayments,
      customersWithoutAccounts: customersWithoutAccounts,
      pendingInstallationBills: pendingInstallationBills,
      pendingProRated: pendingProRated,
      pendingActivations: pendingActivations,
      stats: stats,
    };

    // Cache the data
    dashboardCache = dashboardData;
    dashboardCacheTime = now;

    console.log(`✅ Dashboard data cached: ${allCustomers.length} customers`);

    res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error("Error in getDashboardData:", error);

    // ==================== RETURN CACHED DATA ON ERROR ====================
    if (dashboardCache) {
      console.log("📦 Returning cached dashboard data due to error");
      return res.status(200).json({
        success: true,
        data: dashboardCache,
        cached: true,
        error: "Database timeout - using cached data",
      });
    }

    // ==================== RETURN EMPTY DATA AS FALLBACK ====================
    const emptyData = {
      customers: [],
      billingCycles: [],
      bills: [],
      pendingPayments: [],
      customersWithoutAccounts: [],
      pendingInstallationBills: [],
      pendingProRated: [],
      pendingActivations: [],
      stats: {
        totalCustomers: 0,
        totalBalance: 0,
        customersWithBalanceCount: 0,
        overdueCustomersCount: 0,
        activeCyclesCount: 0,
        pausedCyclesCount: 0,
        pendingProRatedCount: 0,
        pendingActivationsCount: 0,
        pendingPaymentsCount: 0,
        pendingInstallationBillsCount: 0,
        applicationsWithoutBilling: 0,
        totalInstallationFeesDue: 0,
        installationFeesPaidCount: 0,
      },
    };

    res.status(200).json({
      success: true,
      data: emptyData,
      error: "Database timeout - please refresh",
    });
  }
};

export const clearDashboardCache = () => {
  dashboardCache = null;
  dashboardCacheTime = 0;
  console.log("🗑️ Dashboard cache cleared");
};
