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
  companyVat?: string; // kept optional for backward-compat but no longer rendered
  companyContact?: string; // kept optional for backward-compat but no longer rendered
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
  buildingName?: string;
  location?: string;
  status?: string;
  paidAt?: Date | string | null;
  isFree?: boolean;
}

// ==================== WILCONNECT BRAND RESOLUTION ====================
const WILCONNECT_BUILDINGS = ["el pueblo", "vitalez", "newport"];

const WORKSELPUEBLO_EMAIL = "workselpueblo@fyberblizz.com";

function isElPuebloBuilding(
  buildingName?: string,
  location?: string,
  customerAddress?: string,
): boolean {
  const hint = [buildingName, location, customerAddress]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hint.includes("el pueblo");
}

function isVitalezOrNewportBuilding(
  buildingName?: string,
  location?: string,
  customerAddress?: string,
): boolean {
  const hint = [buildingName, location, customerAddress]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hint.includes("vitalez") || hint.includes("newport");
}

interface BankAccountInfo {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

// ✅ Correct BDO account per building
// - Vitalez / Newport → 013448003703 / RANDY MANZANARES AND ANGELA TAPEL
// - El Pueblo         → 013448003711 / RANDY D MANZANARES AND ANGELA C TAPEL
// - Generic Wilconnect / Mister Fyber → default fallback
function getBankAccountForBuilding(
  buildingName?: string,
  location?: string,
  customerAddress?: string,
): BankAccountInfo {
  const hint = [buildingName, location, customerAddress]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (hint.includes("el pueblo")) {
    return {
      bankName: "BDO",
      accountName: "RANDY D MANZANARES AND ANGELA C TAPEL",
      accountNumber: "013448003711",
    };
  }

  if (hint.includes("vitalez") || hint.includes("newport")) {
    return {
      bankName: "BDO",
      accountName: "RANDY MANZANARES AND ANGELA TAPEL",
      accountNumber: "013448003703",
    };
  }

  const isWilconnect =
    hint.includes("wilconnect") ||
    WILCONNECT_BUILDINGS.some((b) => hint.includes(b));

  if (isWilconnect) {
    return {
      bankName: "BDO",
      accountName: "WILCONNECT NETWORK CORPORATION",
      accountNumber: "013448002421",
    };
  }

  return {
    bankName: "BDO",
    accountName: "FYBERBLIZZ NETWORK CORPORATION",
    accountNumber: "013448002421",
  };
}

interface PdfBrand {
  isWilconnect: boolean;
  companyName: string;
  companyAddress: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  // ✅ Footer-specific values
  supportEmail: string;
  collectionEmail: string;
  sentFromName: string;
  sentFromEmail: string;
}

function getBrandForPdf(invoiceData: InvoiceData): PdfBrand {
  const hint = [
    (invoiceData as any)?.buildingName,
    (invoiceData as any)?.location,
    invoiceData?.customerAddress,
    invoiceData?.companyName,
    invoiceData?.accountName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isWilconnect =
    hint.includes("wilconnect") ||
    WILCONNECT_BUILDINGS.some((b) => hint.includes(b));

  if (isWilconnect) {
    const bankAccount = getBankAccountForBuilding(
      (invoiceData as any)?.buildingName,
      (invoiceData as any)?.location,
      invoiceData?.customerAddress,
    );

    return {
      isWilconnect: true,
      companyName: "WILCONNECT NETWORK CORPORATION",
      companyAddress:
        "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
      bankName: bankAccount.bankName,
      accountName: bankAccount.accountName,
      accountNumber: bankAccount.accountNumber,
      supportEmail: WORKSELPUEBLO_EMAIL,
      collectionEmail: WORKSELPUEBLO_EMAIL,
      sentFromName: "Workselpueblo",
      sentFromEmail: WORKSELPUEBLO_EMAIL,
    };
  }

  return {
    isWilconnect: false,
    companyName: "FYBERBLIZZ NETWORK CORPORATION",
    companyAddress:
      "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
    bankName: "BDO",
    accountName: "FYBERBLIZZ NETWORK CORPORATION",
    accountNumber: "013448002421",
    supportEmail: "admin@misterfyber.com",
    collectionEmail: "admin@misterfyber.com",
    sentFromName: "Mister Fyber",
    sentFromEmail: "admin@misterfyber.com",
  };
}

// ==================== PAID / FREE DETECTION ====================
function isPaidInvoice(invoiceData: InvoiceData): boolean {
  if (!invoiceData) return false;
  if (invoiceData.isFree === true) return false;
  if (invoiceData.status && invoiceData.status.toLowerCase() === "free")
    return false;
  if (invoiceData.status && invoiceData.status.toLowerCase() === "paid") {
    return true;
  }
  if (invoiceData.paidAt) {
    return true;
  }
  return false;
}

function isFreeInvoice(invoiceData: InvoiceData): boolean {
  if (!invoiceData) return false;
  if (invoiceData.isFree === true) return true;
  if (invoiceData.status && invoiceData.status.toLowerCase() === "free")
    return true;
  if (
    invoiceData.paymentMethod &&
    invoiceData.paymentMethod.toLowerCase() === "free"
  )
    return true;
  if (
    invoiceData.invoiceType &&
    invoiceData.invoiceType.toLowerCase() === "free"
  )
    return true;
  return false;
}

function formatDateForPDF(date: Date | string | null | undefined): string {
  if (!date) return "N/A";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "N/A";
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatCurrency(amount: number): string {
  return `Php ${amount.toFixed(2)}`;
}

export async function generateInvoicePDF(
  invoiceData: InvoiceData,
): Promise<Buffer> {
  // ==================== RESOLVE BRAND & PAID/FREE STATE ====================
  const brand = getBrandForPdf(invoiceData);
  const free = isFreeInvoice(invoiceData);
  const paid = !free && isPaidInvoice(invoiceData);

  const bankName = invoiceData.bankName || brand.bankName;
  const accountName = invoiceData.accountName || brand.accountName;
  const accountNumber = invoiceData.accountNumber || brand.accountNumber;

  const resolvedCompanyName = brand.companyName;
  const resolvedCompanyAddress = brand.companyAddress;

  const resolvedSupportEmail = brand.supportEmail;
  const resolvedCollectionEmail = brand.collectionEmail;
  const resolvedSentFromName = brand.sentFromName;
  const resolvedSentFromEmail = brand.sentFromEmail;
  const resolvedBrandName = brand.isWilconnect ? "Wilconnect" : "Mister Fyber";

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      // ============================================================
      // WATERMARK (PAID or FREE)
      // ============================================================
      if (paid || free) {
        try {
          const watermarkText = free ? "FREE" : "PAID";
          const watermarkColor = free ? "#0ea5e9" : "#28a745";
          const fontSize = free ? 140 : 130;

          doc.save();
          doc.translate(pageWidth / 2, pageHeight / 2);
          doc.rotate(-30);
          doc
            .font("Helvetica-Bold")
            .fontSize(fontSize)
            .fillColor(watermarkColor)
            .opacity(0.13)
            .text(watermarkText, -320, -80, {
              width: 640,
              align: "center",
            });
          doc.restore();
          doc.opacity(1);
        } catch (wmErr) {
          console.error("Watermark draw error:", wmErr);
        }
      }

      // ==================== HEADER ====================
      // ⚠️ VAT-REG. / CONTACT NO. line REMOVED here.
      doc
        .font("Helvetica-Bold")
        .fontSize(22)
        .fillColor("#1a237e")
        .text(resolvedCompanyName, 50, 45, { align: "center" });

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text(resolvedCompanyAddress, 50, 75, { align: "center" });

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text(invoiceData.companyEmail, 50, 109, { align: "center" });

      // ==================== PAID / FREE BANNER (top-right) ====================
      if (paid || free) {
        try {
          const badgeX = 440;
          const badgeY = 138;
          const badgeW = 110;
          const badgeH = 26;
          const badgeBg = free ? "#0ea5e9" : "#28a745";
          const badgeStroke = free ? "#0369a1" : "#1e7e34";
          const badgeText = free ? "🎁 FREE" : "✅ PAID";

          doc.save();
          doc
            .roundedRect(badgeX, badgeY, badgeW, badgeH, 6)
            .fillAndStroke(badgeBg, badgeStroke);

          doc
            .font("Helvetica-Bold")
            .fontSize(13)
            .fillColor("#ffffff")
            .text(badgeText, badgeX, badgeY + 6, {
              width: badgeW,
              align: "center",
            });

          doc.restore();
        } catch (badgeErr) {
          console.error("Status badge draw error:", badgeErr);
        }
      }

      // ==================== DIVIDER ====================
      doc.moveTo(50, 130).lineTo(550, 130).stroke("#1a237e");

      // ==================== INVOICE TITLE ====================
      doc
        .font("Helvetica-Bold")
        .fontSize(24)
        .fillColor("#1a237e")
        .text("INVOICE", 50, 150);

      doc
        .font("Helvetica")
        .fontSize(12)
        .fillColor("#333")
        .text(`Invoice #: ${invoiceData.invoiceNumber}`, 400, 155, {
          align: "right",
        });

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

      if (paid && invoiceData.paidAt) {
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#28a745")
          .text(
            `Paid At: ${formatDateForPDF(invoiceData.paidAt)}`,
            350,
            invoiceData.isProRated && invoiceData.proRatedDays ? 304 : 286,
          );
      }

      if (free) {
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#0ea5e9")
          .text(
            "Fully Waived / Free of Charge",
            350,
            invoiceData.isProRated && invoiceData.proRatedDays ? 304 : 286,
          );
      }

      // ==================== ITEMS TABLE ====================
      const tableY = Math.max(detailY + 20, 340);

      const col1 = 50;
      const col2 = 250;
      const col3 = 380;
      const col4 = 460;
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

      let currentY = tableY + rowHeight;
      const maxItemsPerPage = 15;
      let itemCount = 0;

      for (const item of invoiceData.items) {
        if (itemCount >= maxItemsPerPage) {
          doc.addPage();
          currentY = 80;

          if (paid || free) {
            try {
              const watermarkText = free ? "FREE" : "PAID";
              const watermarkColor = free ? "#0ea5e9" : "#28a745";
              const fontSize = free ? 140 : 130;
              doc.save();
              doc.translate(pageWidth / 2, pageHeight / 2);
              doc.rotate(-30);
              doc
                .font("Helvetica-Bold")
                .fontSize(fontSize)
                .fillColor(watermarkColor)
                .opacity(0.13)
                .text(watermarkText, -320, -80, {
                  width: 640,
                  align: "center",
                });
              doc.restore();
              doc.opacity(1);
            } catch (wmErr) {
              console.error("Watermark draw error (new page):", wmErr);
            }
          }

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

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333")
        .text("Subtotal:", 380, summaryY)
        .text(formatCurrency(invoiceData.subtotal), 480, summaryY, {
          align: "right",
        });

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

      if (invoiceData.taxAmount > 0) {
        const taxY =
          invoiceData.discountAmount > 0 ? summaryY + 40 : summaryY + 20;
        doc
          .text(`Tax (${invoiceData.taxRate}%)`, 380, taxY)
          .text(formatCurrency(invoiceData.taxAmount), 480, taxY, {
            align: "right",
          });
      }

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

      if (paid) {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#28a745")
          .text("PAID", 380, totalY + 22)
          .text(formatCurrency(invoiceData.total), 480, totalY + 22, {
            align: "right",
          });
      } else if (free) {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#0ea5e9")
          .text("FREE", 380, totalY + 22)
          .text("Php 0.00", 480, totalY + 22, {
            align: "right",
          });
      }

      // ==================== DIVIDER ====================
      doc
        .moveTo(50, totalY + (paid || free ? 60 : 40))
        .lineTo(550, totalY + (paid || free ? 60 : 40))
        .stroke("#ccc");

      // ==================== PAYMENT STATUS SECTION ====================
      const paymentY = totalY + (paid || free ? 80 : 60);

      if (free) {
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor("#0ea5e9")
          .text("🎁 FREE OF CHARGE", 50, paymentY);

        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#333")
          .text(
            `This invoice has been marked as FREE (waived)${invoiceData.paidAt ? ` on ${formatDateForPDF(invoiceData.paidAt)}` : ""}.`,
            50,
            paymentY + 22,
            { width: 500 },
          );

        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#555")
          .text(
            "No payment is required. This document serves as your official receipt for the waived charge.",
            50,
            paymentY + 42,
            { width: 500 },
          );
      } else if (paid) {
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor("#28a745")
          .text("✅ PAYMENT RECEIVED", 50, paymentY);

        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#333")
          .text(
            `This invoice has been fully settled${invoiceData.paidAt ? ` on ${formatDateForPDF(invoiceData.paidAt)}` : ""}.`,
            50,
            paymentY + 22,
            { width: 500 },
          );

        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#555")
          .text(
            "Thank you for your payment. This document serves as your official receipt.",
            50,
            paymentY + 42,
            { width: 500 },
          );
      }

      // ==================== NOTES ====================
      let notesY = paymentY + (paid || free ? 90 : 40);

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
      // ⚠️ VAT-REG. / CONTACT NO. line REMOVED from footer as well.
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#666")
        .text(
          free
            ? `🎁 Free of charge — Thank you for choosing our service!`
            : paid
              ? `✅ Payment received — Thank you for choosing our service!`
              : `Thank you for choosing our service!`,
          50,
          pageHeight - 110,
          { align: "center", width: 500 },
        )
        .text(
          `${resolvedBrandName} - Your trusted internet provider`,
          50,
          pageHeight - 90,
          { align: "center", width: 500 },
        )
        .text(
          `Need help? Contact us at ${resolvedSupportEmail}`,
          50,
          pageHeight - 75,
          { align: "center", width: 500 },
        )
        .text(
          "This is a computer-generated invoice. No signature required.",
          50,
          pageHeight - 60,
          { align: "center", width: 500 },
        )
        .text(
          `Collection email: ${resolvedCollectionEmail}`,
          50,
          pageHeight - 45,
          { align: "center", width: 500 },
        )
        .text(
          `Sent from: ${resolvedSentFromName} (${resolvedSentFromEmail})`,
          50,
          pageHeight - 30,
          { align: "center", width: 500 },
        );

      // ==================== FINALIZE ====================
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
