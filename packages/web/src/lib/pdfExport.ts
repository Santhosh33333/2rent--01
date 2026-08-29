import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface PdfExportOptions {
  title: string
  subtitle?: string
  columns: string[]
  rows: (string | number | null | undefined)[][]
  fileName: string
  landscape?: boolean
}

export function exportTableToPdf({ title, subtitle, columns, rows, fileName, landscape }: PdfExportOptions): void {
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('RentBuddy Admin', 40, 40)
  doc.setFontSize(11)
  doc.text(title, 40, 58)
  doc.setFont('helvetica', 'normal')
  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(subtitle, 40, 73)
    doc.setTextColor(0)
  }
  doc.setFontSize(8)
  doc.setTextColor(140)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageWidth - 40, 40, { align: 'right' })
  doc.setTextColor(0)

  autoTable(doc, {
    head: [columns],
    body: rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))),
    startY: subtitle ? 88 : 76,
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 246, 251] },
    margin: { left: 40, right: 40, top: 50 },
    didDrawPage: () => {
      const pageCount = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(
        `Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`,
        pageWidth - 40,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'right' }
      )
      doc.setTextColor(0)
    },
  })

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
}
