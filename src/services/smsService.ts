import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

class SMSService {
  private client: any;
  private fromNumber: string;
  private isConfigured: boolean;

  constructor() {
    this.isConfigured = false;

    // Check if Twilio credentials are provided
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    ) {
      try {
        this.client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN,
        );
        this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
        this.isConfigured = true;
        console.log("✅ SMS service initialized successfully");
      } catch (error) {
        console.warn("⚠️ Failed to initialize SMS service:", error);
      }
    } else {
      console.warn(
        "⚠️ SMS service not configured - missing Twilio credentials",
      );
    }
  }

  async sendSMS(to: string, message: string): Promise<any> {
    if (!this.isConfigured) {
      console.log("📱 SMS not sent (service not configured):", { to, message });
      return { success: false, message: "SMS service not configured" };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        to: to,
        from: this.fromNumber,
      });
      console.log("✅ SMS sent successfully:", result.sid);
      return { success: true, data: result };
    } catch (error) {
      console.error("❌ Error sending SMS:", error);
      return { success: false, error };
    }
  }

  async sendWelcomeSMS(phoneNumber: string, username: string): Promise<any> {
    const message = `Welcome to ISP Management System! Your account has been created. Username: ${username}. Thank you for choosing our service.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendPaymentConfirmation(
    phoneNumber: string,
    amount: number,
    reference: string,
  ): Promise<any> {
    const message = `Payment of ₱${amount} has been received. Reference: ${reference}. Thank you for your payment!`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendBillingReminder(
    phoneNumber: string,
    amount: number,
    dueDate: Date,
  ): Promise<any> {
    const formattedDate = new Date(dueDate).toLocaleDateString();
    const message = `Reminder: Your internet bill of ₱${amount} is due on ${formattedDate}. Please pay on time to avoid service interruption.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendServiceInterruption(
    phoneNumber: string,
    reason: string,
    estimatedDuration?: string,
  ): Promise<any> {
    const durationText = estimatedDuration
      ? ` Estimated duration: ${estimatedDuration}.`
      : "";
    const message = `Service Alert: ${reason}.${durationText} We apologize for the inconvenience.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendServiceAlertSMS(
    phoneNumber: string,
    message: string,
  ): Promise<any> {
    const alertMessage = `Service Alert: ${message}`;
    return this.sendSMS(phoneNumber, alertMessage);
  }
}

export default new SMSService();
