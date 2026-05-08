import { RouterOSClient } from "routeros-client";
import MikrotikConfig from "../models/MikrotikConfig";
import User, { IUser } from "../models/User";

class MikrotikService {
  private connections: Map<string, any> = new Map();

  async connect(configId: string) {
    try {
      const config = await MikrotikConfig.findById(configId);
      if (!config) {
        throw new Error("MikroTik configuration not found");
      }

      const client = new RouterOSClient({
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password,
        timeout: 5000,
      });

      await client.connect();

      this.connections.set(configId, client);

      config.status = "connected";
      config.lastSync = new Date();
      await config.save();

      return client;
    } catch (error) {
      console.error("MikroTik connection error:", error);
      throw error;
    }
  }

  async disconnect(configId: string) {
    const client = this.connections.get(configId);
    if (client) {
      await client.close();
      this.connections.delete(configId);
    }
  }

  private async getClient(configId: string) {
    let client = this.connections.get(configId);
    if (!client) {
      client = await this.connect(configId);
    }
    return client;
  }

  // User Management
  async createPPPoEUser(user: IUser, plan: any) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      const client = await this.getClient(config._id.toString());

      // Create PPPoE secret
      const pppSecret = await client.menu("/ppp/secret").add({
        name: user.mikrotik?.username || user.username,
        password:
          user.mikrotik?.password || Math.random().toString(36).slice(-8),
        service: "pppoe",
        profile: plan.mikrotikProfile || "default",
        comment: `User: ${user.username} | Email: ${user.email}`,
        "remote-address": user.mikrotik?.ipAddress || "",
        disabled: "no",
      });

      // Add to address list
      if (user.mikrotik?.ipAddress) {
        await client.menu("/ip/firewall/address-list").add({
          address: user.mikrotik.ipAddress,
          list: "pppoe-users",
          comment: user.username,
        });
      }

      return pppSecret;
    } catch (error) {
      console.error("Create PPPoE user error:", error);
      throw error;
    }
  }

  async updatePPPoEUser(user: IUser, updates: any) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      const client = await this.getClient(config._id.toString());

      // Find existing user
      const pppUsers = await client
        .menu("/ppp/secret")
        .where("name", user.mikrotik?.username);

      if (pppUsers.length > 0) {
        const pppUser = pppUsers[0];

        // Update user
        await client.menu("/ppp/secret").update(pppUser[".id"], {
          ...updates,
          comment: `User: ${user.username} | Email: ${user.email}`,
        });
      }

      return true;
    } catch (error) {
      console.error("Update PPPoE user error:", error);
      throw error;
    }
  }

  async disablePPPoEUser(user: IUser) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      if (!user.mikrotik?.username) {
        console.log("User has no MikroTik username, skipping...");
        return;
      }

      const client = await this.getClient(config._id.toString());

      const pppUsers = await client
        .menu("/ppp/secret")
        .where("name", user.mikrotik.username);

      if (pppUsers.length > 0) {
        const pppUser = pppUsers[0];
        await client.menu("/ppp/secret").update(pppUser[".id"], {
          disabled: "yes",
        });
        console.log(`🔴 Disabled PPPoE user: ${user.mikrotik.username}`);
      } else {
        console.log(`User ${user.mikrotik.username} not found in MikroTik`);
      }

      return true;
    } catch (error) {
      console.error("Disable PPPoE user error:", error);
      throw error;
    }
  }

  async enablePPPoEUser(user: IUser) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      if (!user.mikrotik?.username) {
        console.log("User has no MikroTik username, skipping...");
        return;
      }

      const client = await this.getClient(config._id.toString());

      const pppUsers = await client
        .menu("/ppp/secret")
        .where("name", user.mikrotik.username);

      if (pppUsers.length > 0) {
        const pppUser = pppUsers[0];
        await client.menu("/ppp/secret").update(pppUser[".id"], {
          disabled: "no",
        });
        console.log(`✅ Enabled PPPoE user: ${user.mikrotik.username}`);
      }

      return true;
    } catch (error) {
      console.error("Enable PPPoE user error:", error);
      throw error;
    }
  }

  // Alias for disablePPPoEUser - para compatible sa billingController
  async disableUser(user: IUser) {
    return this.disablePPPoEUser(user);
  }

  // Queue Management
  async createSimpleQueue(user: IUser, plan: any) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      const client = await this.getClient(config._id.toString());

      // Create queue for user
      const queue = await client.menu("/queue/simple").add({
        name: user.mikrotik?.username || user.username,
        target: user.mikrotik?.ipAddress || "",
        "max-limit": `${plan.speed || 100}M/${plan.speed || 100}M`,
        "burst-limit": "0/0",
        "burst-threshold": "0/0",
        "burst-time": "0/0",
        queue: "default/default",
        parent: "none",
        comment: `User: ${user.username} | Plan: ${plan.name}`,
      });

      return queue;
    } catch (error) {
      console.error("Create simple queue error:", error);
      throw error;
    }
  }

  // Hotspot Management
  async createHotspotUser(user: IUser, plan: any) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      const client = await this.getClient(config._id.toString());

      // Create hotspot user
      const hotspotUser = await client.menu("/ip/hotspot/user").add({
        name: user.mikrotik?.username || user.username,
        password:
          user.mikrotik?.password || Math.random().toString(36).slice(-8),
        profile: plan.mikrotikProfile || "default",
        "limit-uptime": `${plan.duration || 30}d`,
        comment: `User: ${user.username} | Email: ${user.email}`,
      });

      return hotspotUser;
    } catch (error) {
      console.error("Create hotspot user error:", error);
      throw error;
    }
  }

  // Get User Traffic
  async getUserTraffic(user: IUser) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config || !user.mikrotik?.username) {
        return {
          isActive: false,
          uptime: "0s",
          downloadRate: "0bps",
          uploadRate: "0bps",
          totalDownload: "0 bytes",
          totalUpload: "0 bytes",
        };
      }

      const client = await this.getClient(config._id.toString());

      // Get PPPoE active connections
      const activeConnections = await client
        .menu("/ppp/active")
        .where("name", user.mikrotik.username);

      // Get queue stats
      const queues = await client
        .menu("/queue/simple")
        .where("name", user.mikrotik.username);

      let trafficData = {
        isActive: activeConnections.length > 0,
        uptime:
          activeConnections.length > 0
            ? activeConnections[0]?.uptime || "0s"
            : "0s",
        downloadRate: "0bps",
        uploadRate: "0bps",
        totalDownload: "0 bytes",
        totalUpload: "0 bytes",
      };

      if (queues.length > 0) {
        const queue = queues[0];
        trafficData.downloadRate = queue?.rate || "0bps";
        trafficData.uploadRate = queue?.rate || "0bps";
        if (queue?.bytes) {
          const bytes = queue.bytes.split("/");
          trafficData.totalDownload = bytes[0] || "0 bytes";
          trafficData.totalUpload = bytes[1] || "0 bytes";
        }
      }

      return trafficData;
    } catch (error) {
      console.error("Get user traffic error:", error);
      return {
        isActive: false,
        uptime: "0s",
        downloadRate: "0bps",
        uploadRate: "0bps",
        totalDownload: "0 bytes",
        totalUpload: "0 bytes",
      };
    }
  }

  // System Info
  async getSystemInfo() {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      const client = await this.getClient(config._id.toString());

      const systemInfo = await client.menu("/system/resource").print();
      const interfaces = await client.menu("/interface").print();
      const activeUsers = await client.menu("/ppp/active").print();

      return {
        system: systemInfo[0],
        interfaces: interfaces,
        activeUsers: activeUsers.length,
        status: config.status,
        lastSync: config.lastSync,
      };
    } catch (error) {
      console.error("Get system info error:", error);
      throw error;
    }
  }

  // Apply Plan to User
  async applyPlanToUser(user: IUser, plan: any) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      // Initialize mikrotik object if it doesn't exist
      if (!user.mikrotik) {
        (user as any).mikrotik = {
          username: user.username,
          password: Math.random().toString(36).slice(-8),
          profile: "default",
          ipAddress: "",
          macAddress: "",
        };
        await user.save();
      } else if (!user.mikrotik.username) {
        user.mikrotik.username = user.username;
        if (!user.mikrotik.password) {
          user.mikrotik.password = Math.random().toString(36).slice(-8);
        }
        await user.save();
      }

      // Create PPPoE user
      await this.createPPPoEUser(user, plan);

      // Create queue
      await this.createSimpleQueue(user, plan);

      // If hotspot is enabled, create hotspot user
      if (config.settings?.hotspotEnabled) {
        await this.createHotspotUser(user, plan);
      }

      return true;
    } catch (error) {
      console.error("Apply plan to user error:", error);
      throw error;
    }
  }

  // Remove User
  async removeUser(user: IUser) {
    try {
      const config = await MikrotikConfig.findOne({ isActive: true });
      if (!config) {
        throw new Error("No active MikroTik configuration");
      }

      if (!user.mikrotik?.username) {
        console.log("User has no MikroTik username, skipping...");
        return;
      }

      const client = await this.getClient(config._id.toString());

      // Remove PPPoE secret
      const pppUsers = await client
        .menu("/ppp/secret")
        .where("name", user.mikrotik.username);
      if (pppUsers.length > 0) {
        await client.menu("/ppp/secret").remove(pppUsers[0][".id"]);
      }

      // Remove queue
      const queues = await client
        .menu("/queue/simple")
        .where("name", user.mikrotik.username);
      if (queues.length > 0) {
        await client.menu("/queue/simple").remove(queues[0][".id"]);
      }

      // Remove hotspot user
      const hotspotUsers = await client
        .menu("/ip/hotspot/user")
        .where("name", user.mikrotik.username);
      if (hotspotUsers.length > 0) {
        await client.menu("/ip/hotspot/user").remove(hotspotUsers[0][".id"]);
      }

      return true;
    } catch (error) {
      console.error("Remove user error:", error);
      throw error;
    }
  }
}

export default new MikrotikService();
