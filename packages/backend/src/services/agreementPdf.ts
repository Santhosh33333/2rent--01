// Generates a branded, single-/multi-page PDF attachment for agreements.
// Pure-JS pdfkit (no native deps) so it works identically on Render/web hosts.
import PDFDocument from "pdfkit";

export function buildAgreementPdf(title: string, plainText: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      bufferPages: true,
      info: { Title: title, Author: "Nabri", Subject: "Agreement" },
    });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header band
    doc.rect(0, 0, doc.page.width, 86).fill("#0D378B");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(17).text("NABRI", 50, 26, { characterSpacing: 6 });
    doc.font("Helvetica").fontSize(9.5).fillColor("#CDE0FF").text("YOUR PARTNER FOR EVERY SIDE OF LIFE", 50, 54, { characterSpacing: 2.4 });
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#1C1917");
    doc.y = 120;
    doc.text(title, { characterSpacing: 0.2 });
    doc.moveDown(0.6);

    doc.font("Helvetica").fontSize(9.8).fillColor("#4B453D");
    for (const line of plainText.split("\n")) {
      if (line.trim() === "") {
        doc.moveDown(0.35);
        continue;
      }
      const isHeading = /^\d+\.\s/.test(line) || /^-+$/.test(line) || line === line.toUpperCase();
      if (isHeading) {
        doc.moveDown(0.25);
        doc.font("Helvetica-Bold").fillColor("#1C1917");
      } else {
        doc.font("Helvetica").fillColor("#4B453D");
      }
      doc.text(line, { lineGap: 3 });
      doc.moveDown(0.05);
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8.5).fillColor("#8C8577").text(`Nabri · ${i + 1} of ${pages.count}`, 50, doc.page.height - 42, { align: "center" });
    }
    doc.end();
  });
}