// backend/src/services/websocketService.ts
import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import eventService from "./eventService";

class WebSocketService {
  private io: SocketServer | null = null;
  private clients: Map<string, Socket> = new Map();
  private isInitialized: boolean = false;

  initialize(server: HttpServer) {
    if (this.isInitialized) {
      console.log("🔌 WebSocket already initialized");
      return this.io;
    }

    this.io = new SocketServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL
          ? process.env.FRONTEND_URL.split(",")
          : [
              "http://localhost:3000",
              "http://localhost:3001",
              "http://localhost:5173",
            ],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        credentials: true,
      },
      path: "/socket.io",
      transports: ["websocket", "polling"],
      allowEIO3: true,
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.io.on("connection", (socket: Socket) => {
      const clientId = socket.id;
      console.log(`🔌 Client connected: ${clientId}`);
      this.clients.set(clientId, socket);

      // Join admin dashboard room
      socket.join("admin-dashboard");

      // Handle subscription to specific events
      socket.on("subscribe", (event: string) => {
        console.log(`📡 Client ${clientId} subscribed to: ${event}`);
        socket.join(event);
      });

      socket.on("unsubscribe", (event: string) => {
        console.log(`📡 Client ${clientId} unsubscribed from: ${event}`);
        socket.leave(event);
      });

      // Handle dashboard refresh request
      socket.on("dashboard:refresh", () => {
        console.log(`📊 Dashboard refresh requested by ${clientId}`);
        socket.emit("dashboard:refreshing", {
          timestamp: new Date(),
          message: "Refreshing dashboard data...",
        });
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        console.log(`🔌 Client disconnected: ${clientId}`);
        this.clients.delete(clientId);
      });

      // Handle errors
      socket.on("error", (error) => {
        console.error(`❌ Socket error for ${clientId}:`, error);
      });
    });

    // Set up event listeners for broadcasting
    this.setupEventListeners();

    this.isInitialized = true;
    console.log("🔌 WebSocket server initialized");
    return this.io;
  }

  private setupEventListeners() {
    // ============================================================
    // Billing Events
    // ============================================================
    eventService.on("billing:created", (data) => {
      this.broadcastToAdmins("billing:created", {
        ...data,
        timestamp: new Date(),
        event: "billing:created",
      });
    });

    eventService.on("billing:paid", (data) => {
      this.broadcastToAdmins("billing:paid", {
        ...data,
        timestamp: new Date(),
        event: "billing:paid",
      });
    });

    eventService.on("billing:updated", (data) => {
      this.broadcastToAdmins("billing:updated", {
        ...data,
        timestamp: new Date(),
        event: "billing:updated",
      });
    });

    eventService.on("billing:deleted", (data) => {
      this.broadcastToAdmins("billing:deleted", {
        ...data,
        timestamp: new Date(),
        event: "billing:deleted",
      });
    });

    // ============================================================
    // Billing Cycle Events
    // ============================================================
    eventService.on("billingCycle:created", (data) => {
      this.broadcastToAdmins("billingCycle:created", {
        ...data,
        timestamp: new Date(),
        event: "billingCycle:created",
      });
    });

    eventService.on("billingCycle:updated", (data) => {
      this.broadcastToAdmins("billingCycle:updated", {
        ...data,
        timestamp: new Date(),
        event: "billingCycle:updated",
      });
    });

    eventService.on("billingCycle:deleted", (data) => {
      this.broadcastToAdmins("billingCycle:deleted", {
        ...data,
        timestamp: new Date(),
        event: "billingCycle:deleted",
      });
    });

    // ============================================================
    // Customer Events
    // ============================================================
    eventService.on("customer:created", (data) => {
      this.broadcastToAdmins("customer:created", {
        ...data,
        timestamp: new Date(),
        event: "customer:created",
      });
    });

    eventService.on("customer:updated", (data) => {
      this.broadcastToAdmins("customer:updated", {
        ...data,
        timestamp: new Date(),
        event: "customer:updated",
      });
    });

    // ============================================================
    // Payment Events
    // ============================================================
    eventService.on("payment:created", (data) => {
      this.broadcastToAdmins("payment:created", {
        ...data,
        timestamp: new Date(),
        event: "payment:created",
      });
    });

    eventService.on("payment:confirmed", (data) => {
      this.broadcastToAdmins("payment:confirmed", {
        ...data,
        timestamp: new Date(),
        event: "payment:confirmed",
      });
    });

    eventService.on("payment:submitted", (data) => {
      this.broadcastToAdmins("payment:submitted", {
        ...data,
        timestamp: new Date(),
        event: "payment:submitted",
      });
    });

    // ============================================================
    // Settings Events
    // ============================================================
    eventService.on("settings:updated", (data) => {
      this.broadcastToAdmins("settings:updated", {
        ...data,
        timestamp: new Date(),
        event: "settings:updated",
      });
    });

    // ============================================================
    // Suspension Events
    // ============================================================
    eventService.on("suspension:updated", (data) => {
      this.broadcastToAdmins("suspension:updated", {
        ...data,
        timestamp: new Date(),
        event: "suspension:updated",
      });
    });

    // ============================================================
    // Bills Generated Events
    // ============================================================
    eventService.on("bills:generated", (data) => {
      this.broadcastToAdmins("bills:generated", {
        ...data,
        timestamp: new Date(),
        event: "bills:generated",
      });
    });

    eventService.on("bills:recovered", (data) => {
      this.broadcastToAdmins("bills:recovered", {
        ...data,
        timestamp: new Date(),
        event: "bills:recovered",
      });
    });

    eventService.on("new_customer:detected", (data) => {
      this.broadcastToAdmins("new_customer:detected", {
        ...data,
        timestamp: new Date(),
        event: "new_customer:detected",
      });
    });

    // ============================================================
    // Generic Dashboard Update
    // ============================================================
    eventService.on("dashboard:update", (data) => {
      this.broadcastToAdmins("dashboard:update", {
        ...data,
        timestamp: new Date(),
        event: "dashboard:update",
        requiresRefresh: true,
      });
    });
  }

  private broadcastToAdmins(event: string, data: any) {
    if (!this.io) return;
    this.io.to("admin-dashboard").emit(event, data);
  }

  // Send to a specific client
  sendToClient(socketId: string, event: string, data: any) {
    const socket = this.clients.get(socketId);
    if (socket) {
      socket.emit(event, data);
      return true;
    }
    return false;
  }

  // Get number of connected clients
  getClientsCount(): number {
    return this.clients.size;
  }

  // Get all connected client IDs
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  // Check if a client is connected
  isClientConnected(socketId: string): boolean {
    return this.clients.has(socketId);
  }

  // Get the Socket.IO instance
  getIO(): SocketServer | null {
    return this.io;
  }

  // Disconnect all clients and close the server
  shutdown() {
    if (this.io) {
      this.io.close(() => {
        console.log("🔌 WebSocket server shut down");
      });
      this.clients.clear();
      this.isInitialized = false;
      this.io = null;
    }
  }
}

export const webSocketService = new WebSocketService();
export default webSocketService;
