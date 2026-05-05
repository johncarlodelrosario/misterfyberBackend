import fs from "fs";
import path from "path";

class Logger {
  private logDir: string;

  constructor() {
    this.logDir = path.join(__dirname, "../../logs");
    this.ensureLogDirectory();
  }

  private ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private getLogFile(type: string): string {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `${type}-${date}.log`);
  }

  private writeToFile(type: string, message: string) {
    const logFile = this.getLogFile(type);
    const logEntry = `[${this.getTimestamp()}] ${message}\n`;

    fs.appendFile(logFile, logEntry, (err) => {
      if (err) {
        console.error("Error writing to log file:", err);
      }
    });
  }

  info(message: string, data?: any) {
    const logMessage = `INFO: ${message} ${data ? JSON.stringify(data) : ""}`;
    console.log("\x1b[36m%s\x1b[0m", logMessage); // Cyan color
    this.writeToFile("info", logMessage);
  }

  error(message: string, error?: any) {
    const logMessage = `ERROR: ${message} ${error ? JSON.stringify(error) : ""}`;
    console.error("\x1b[31m%s\x1b[0m", logMessage); // Red color
    this.writeToFile("error", logMessage);
  }

  warn(message: string, data?: any) {
    const logMessage = `WARN: ${message} ${data ? JSON.stringify(data) : ""}`;
    console.warn("\x1b[33m%s\x1b[0m", logMessage); // Yellow color
    this.writeToFile("warn", logMessage);
  }

  debug(message: string, data?: any) {
    if (process.env.NODE_ENV === "development") {
      const logMessage = `DEBUG: ${message} ${data ? JSON.stringify(data) : ""}`;
      console.log("\x1b[35m%s\x1b[0m", logMessage); // Magenta color
      this.writeToFile("debug", logMessage);
    }
  }

  audit(userId: string, action: string, details: any) {
    const logMessage = `AUDIT: User[${userId}] - ${action} - ${JSON.stringify(details)}`;
    console.log("\x1b[34m%s\x1b[0m", logMessage); // Blue color
    this.writeToFile("audit", logMessage);
  }
}

export default new Logger();
