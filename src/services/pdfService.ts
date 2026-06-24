// backend/src/services/pdfService.ts

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export interface InvoiceData {
  invoiceNumber: string;
  invoiceType: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  customerPhone?: string;
  companyName: string;
  companyAddress: string;
  companyVat: string;
  companyContact: string;
  companyEmail: string;
  billingPeriod: { start: Date; end: Date };
  dueDate: Date;
  issuedDate: Date;
  items: Array<{
    description: string;
    quantity: number;
    rate: number;
    amount: number;
    type?: string;
  }>;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  notes?: string;
  termsAndConditions?: string;
  isInstallationFee: boolean;
  isProRated: boolean;
  proRatedDays?: number;
}

function formatDateForPDF(date: Date): string {
  if (!date) return "N/A";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatCurrency(amount: number): string {
  return `Php ${amount.toFixed(2)}`;
}

export async function generateInvoicePDF(
  invoiceData: InvoiceData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Create a new PDF document
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ==================== HEADER ====================
      // Company Name
      doc
        .font("Helvetica-Bold")
        .fontSize(22)
        .fillColor("#1a237e")
        .text(invoiceData.companyName, 50, 45, { align: "center" });

      // Company Address
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text(invoiceData.companyAddress, 50, 75, { align: "center" });

      // Company VAT and Contact
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text(
          `VAT-REG.: ${invoiceData.companyVat} | CONTACT NO.: ${invoiceData.companyContact}`,
          50,
          92,
          { align: "center" },
        );

      // Company Email
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text(invoiceData.companyEmail, 50, 109, { align: "center" });

      // ==================== DIVIDER ====================
      doc.moveTo(50, 130).lineTo(550, 130).stroke("#1a237e");

      // ==================== INVOICE TITLE ====================
      doc
        .font("Helvetica-Bold")
        .fontSize(24)
        .fillColor("#1a237e")
        .text("INVOICE", 50, 150);

      // Invoice Number
      doc
        .font("Helvetica")
        .fontSize(12)
        .fillColor("#333")
        .text(`Invoice #: ${invoiceData.invoiceNumber}`, 400, 155, {
          align: "right",
        });

      // Invoice Type
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#666")
        .text(`Type: ${invoiceData.invoiceType.toUpperCase()}`, 400, 175, {
          align: "right",
        });

      // ==================== BILL TO SECTION ====================
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#333")
        .text("BILL TO:", 50, 210);

      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#333")
        .text(invoiceData.customerName, 50, 232)
        .text(invoiceData.customerAddress, 50, 250)
        .text(`Email: ${invoiceData.customerEmail}`, 50, 268);

      if (invoiceData.customerPhone) {
        doc.text(`Phone: ${invoiceData.customerPhone}`, 50, 286);
      }

      // ==================== INVOICE DETAILS ====================
      const detailY = invoiceData.customerPhone ? 310 : 300;

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text(
          `Issue Date: ${formatDateForPDF(invoiceData.issuedDate)}`,
          350,
          232,
        )
        .text(`Due Date: ${formatDateForPDF(invoiceData.dueDate)}`, 350, 250);

      if (invoiceData.billingPeriod) {
        doc.text(
          `Billing Period: ${formatDateForPDF(invoiceData.billingPeriod.start)} - ${formatDateForPDF(invoiceData.billingPeriod.end)}`,
          350,
          268,
        );
      }

      if (invoiceData.isProRated && invoiceData.proRatedDays) {
        doc.text(`Pro-rated Days: ${invoiceData.proRatedDays} days`, 350, 286);
      }

      // ==================== ITEMS TABLE ====================
      const tableY = Math.max(detailY + 20, 340);

      // Table Header
      const col1 = 50;
      const col2 = 250;
      const col3 = 380;
      const col4 = 460;
      const col5 = 530;
      const rowHeight = 25;

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#fff")
        .rect(col1, tableY, 500, rowHeight)
        .fill("#1a237e")
        .fillColor("#fff")
        .text("Description", col1 + 10, tableY + 7)
        .text("Qty", col2 + 10, tableY + 7)
        .text("Rate", col3 + 10, tableY + 7)
        .text("Amount", col4 + 10, tableY + 7);

      // Table Rows
      let currentY = tableY + rowHeight;
      const maxItemsPerPage = 15;
      let itemCount = 0;

      for (const item of invoiceData.items) {
        if (itemCount >= maxItemsPerPage) {
          // Add new page if too many items
          doc.addPage();
          currentY = 80;

          // Recreate table header on new page
          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor("#fff")
            .rect(col1, currentY, 500, rowHeight)
            .fill("#1a237e")
            .fillColor("#fff")
            .text("Description", col1 + 10, currentY + 7)
            .text("Qty", col2 + 10, currentY + 7)
            .text("Rate", col3 + 10, currentY + 7)
            .text("Amount", col4 + 10, currentY + 7);

          currentY += rowHeight;
          itemCount = 0;
        }

        // Alternate row colors
        const bgColor = itemCount % 2 === 0 ? "#f8f9fa" : "#ffffff";
        doc.fillColor(bgColor).rect(col1, currentY, 500, rowHeight).fill();

        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#333")
          .text(item.description, col1 + 10, currentY + 7, { width: 140 })
          .text(item.quantity.toString(), col2 + 10, currentY + 7)
          .text(formatCurrency(item.rate), col3 + 10, currentY + 7)
          .text(formatCurrency(item.amount), col4 + 10, currentY + 7, {
            align: "right",
          });

        currentY += rowHeight;
        itemCount++;
      }

      // ==================== SUMMARY ====================
      const summaryY = currentY + 20;

      // Subtotal
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text("Subtotal:", 380, summaryY)
        .text(formatCurrency(invoiceData.subtotal), 480, summaryY, {
          align: "right",
        });

      // Discount
      if (invoiceData.discountAmount > 0) {
        doc
          .text(
            `Discount (${((invoiceData.discountAmount / invoiceData.subtotal) * 100).toFixed(0)}%)`,
            380,
            summaryY + 20,
          )
          .text(
            `-${formatCurrency(invoiceData.discountAmount)}`,
            480,
            summaryY + 20,
            { align: "right" },
          );
      }

      // Tax
      if (invoiceData.taxAmount > 0) {
        const taxY =
          invoiceData.discountAmount > 0 ? summaryY + 40 : summaryY + 20;
        doc
          .text(`Tax (${invoiceData.taxRate}%)`, 380, taxY)
          .text(formatCurrency(invoiceData.taxAmount), 480, taxY, {
            align: "right",
          });
      }

      // Total
      const totalY =
        summaryY +
        (invoiceData.discountAmount > 0
          ? 60
          : invoiceData.taxAmount > 0
            ? 40
            : 20);
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#1a237e")
        .text("TOTAL:", 380, totalY)
        .text(formatCurrency(invoiceData.total), 480, totalY, {
          align: "right",
        });

      // ==================== DIVIDER ====================
      doc
        .moveTo(50, totalY + 40)
        .lineTo(550, totalY + 40)
        .stroke("#ccc");

      // ==================== PAYMENT INSTRUCTIONS ====================
      const paymentY = totalY + 60;

      if (
        invoiceData.bankName &&
        invoiceData.accountName &&
        invoiceData.accountNumber
      ) {
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor("#333")
          .text("Payment Method (Bank Transfer):", 50, paymentY);

        doc
          .font("Helvetica")
          .fontSize(11)
          .fillColor("#333")
          .text(`Bank Name: ${invoiceData.bankName}`, 50, paymentY + 25)
          .text(`Account Name: ${invoiceData.accountName}`, 50, paymentY + 45)
          .text(
            `Account Number: ${invoiceData.accountNumber}`,
            50,
            paymentY + 65,
          );

        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#555")
          .text(
            `Kindly send your proof of payment via Viber ${invoiceData.companyContact} or at ${invoiceData.companyEmail} after completing the transaction.`,
            50,
            paymentY + 95,
            { width: 500 },
          );
      }

      // ==================== NOTES ====================
      let notesY = paymentY + 140;

      if (invoiceData.notes) {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#333")
          .text("Notes:", 50, notesY);

        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#555")
          .text(invoiceData.notes, 50, notesY + 20, { width: 500 });

        notesY += 60;
      }

      // ==================== TERMS AND CONDITIONS ====================
      if (invoiceData.termsAndConditions) {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#333")
          .text("IMPORTANT NOTICE:", 50, notesY + 20);

        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#dc3545")
          .text(invoiceData.termsAndConditions, 50, notesY + 42, {
            width: 500,
          });
      }

      // ==================== FOOTER ====================
      const pageHeight = doc.page.height;
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#666")
        .text("Thank you for choosing our service!", 50, pageHeight - 50, {
          align: "center",
          width: 500,
        })
        .text(
          "This is a computer-generated invoice. No signature required.",
          50,
          pageHeight - 35,
          { align: "center", width: 500 },
        );

      // ==================== FINALIZE ====================
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
