import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { saveBlob } from './download'

function inr(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  return `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-IN')
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-IN')
}

function labelRow(doc: jsPDF, y: number, label: string, value: string, x: number, _maxW: number): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(label, x, y)
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold')
  doc.text(value, x + 118, y)
  doc.setFont('helvetica', 'normal')
  return y + 14
}

export async function downloadInvoicePdf(receipt: any): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const L = 40
  const R = W - 40
  const b = receipt?.booking || {}
  const cust = receipt?.customer || {}
  const part = receipt?.partner || null
  const ch = receipt?.charges || {}
  const txns: any[] = Array.isArray(receipt?.transactions) ? receipt.transactions : []

  // Header band
  doc.setFillColor(216, 61, 39)
  doc.rect(0, 0, W, 76, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.text('NABRI', L, 48)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Invoice of service', L, 64)
  doc.setFontSize(9)
  doc.text(`Receipt No: ${receipt?.receiptNo || '-'}`, R, 34, { align: 'right' })
  doc.text(`Generated: ${fmtDateTime(receipt?.generatedAt)}`, R, 48, { align: 'right' })
  doc.text(`Booking: ${b.id || '-'}`, R, 62, { align: 'right' })
  doc.setTextColor(0)

  // Billed to / provided by
  let y = 100
  doc.setFillColor(218, 218, 224)
  doc.rect(L, y - 11, (R - L) / 2 - 8, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(216, 61, 39)
  doc.text('BILLED TO', L, y)
  doc.text('PROVIDED BY', L + (R - L) / 2, y)
  doc.setTextColor(0)
  y += 16

  const billingName = typeof cust === 'object' ? cust.nameMasked || cust.fullName || cust.name || '-' : '-'
  const billingEmail = typeof cust === 'object' ? cust.email || '-' : '-'

  y = labelRow(doc, y, 'Name', billingName, L, R - L)
  y = labelRow(doc, y, 'Email', billingEmail, L, R - L)

  const partnerName = part?.name || '-'
  const partnerId = part?.id || '-'
  y = labelRow(doc, y, 'Name', partnerName, L + (R - L) / 2, (R - L) / 2)
  y = labelRow(doc, y, 'Partner ID', String(partnerId), L + (R - L) / 2, (R - L) / 2)

  // Booking details
  y += 14
  doc.setFillColor(218, 218, 224)
  doc.rect(L, y - 11, R - L, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(216, 61, 39)
  doc.text('BOOKING DETAILS', L, y)
  doc.setTextColor(0)
  y += 16

  y = labelRow(doc, y, 'Service', serviceLabel(b.serviceType), L, R - L)
  y = labelRow(doc, y, 'Status', b.status || '-', L, R - L)
  y = labelRow(doc, y, 'Scheduled', fmtDateTime(b.scheduledAt), L, R - L)
  y = labelRow(doc, y, 'Started', fmtDateTime(b.startedAt), L, R - L)
  y = labelRow(doc, y, 'Completed', fmtDateTime(b.completedAt), L, R - L)
  y = labelRow(doc, y, 'Duration', b.durationMinutes ? `${b.durationMinutes} min` : '-', L, R - L)
  y = labelRow(doc, y, 'Pickup', b.startLocation || '-', L, R - L)
  y = labelRow(doc, y, 'Drop', b.endLocation || '-', L, R - L)

  // Charges
  y += 14
  doc.setFillColor(218, 218, 224)
  doc.rect(L, y - 11, R - L, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(216, 61, 39)
  doc.text('CHARGES', L, y)
  doc.setTextColor(0)
  y += 16

  y = labelRow(doc, y, 'Estimated amount', inr(ch.estimatedAmount), L, R - L)
  y = labelRow(doc, y, 'Final amount', inr(ch.finalAmount), L, R - L)
  y = labelRow(doc, y, 'Platform fee', inr(ch.platformFee), L, R - L)
  y = labelRow(doc, y, 'Partner earning', inr(ch.partnerEarning), L, R - L)
  if (ch.couponCode) y = labelRow(doc, y, `Coupon (${ch.couponCode})`, `- ${inr(ch.discountAmount)}`, L, R - L)
  y = labelRow(doc, y, 'Payment status', ch.paymentStatus || '-', L, R - L)
  if (ch.razorpayPaymentId) y = labelRow(doc, y, 'Payment ID', ch.razorpayPaymentId, L, R - L)

  // Final total banner
  doc.setFillColor(216, 61, 39)
  doc.rect(L, y - 10, R - L, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('TOTAL PAID', L + 12, y + 9)
  doc.text(inr(ch.finalAmount ?? ch.estimatedAmount), R - 12, y + 9, { align: 'right' })
  doc.setTextColor(0)
  y += 32

  // Transactions
  if (txns.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Type', 'Description', 'Amount', 'Status', 'Ref']],
      body: txns.map((t) => [
        fmtDate(t.createdAt),
        t.type || '-',
        t.description || '-',
        inr(t.amount),
        t.status || '-',
        t.referenceId || '-',
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
      margin: { left: L, right: R },
    })
    y = (doc as any).lastAutoTable.finalY + 20
  }

  // Refund
  if (receipt?.refund) {
    doc.setFillColor(218, 218, 224)
    doc.rect(L, y - 11, R - L, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(216, 61, 39)
    doc.text('REFUND', L, y)
    doc.setTextColor(0)
    y += 16
    y = labelRow(doc, y, 'Status', receipt.refund.status || '-', L, R - L)
    y = labelRow(doc, y, 'Amount', inr(receipt.refund.amount), L, R - L)
    y = labelRow(doc, y, 'Initiated', fmtDateTime(receipt.refund.initiatedAt), L, R - L)
    y += 14
  }

  doc.setFontSize(8)
  doc.setTextColor(150)
  doc.text('Thank you for using Nabri. This is a system-generated invoice.', L, doc.internal.pageSize.getHeight() - 24)

  // doc.save() is a no-op inside the Android WebView, so the PDF bytes are
  // produced here and handed to the cross-platform saver instead.
  const fileName = `Nabri-Invoice-${(receipt?.receiptNo || b.id || 'receipt').replace(/[^A-Za-z0-9-]/g, '')}.pdf`
  try {
    const outcome = await saveBlob(doc.output('blob'), fileName)
    toast.success(outcome === 'shared' ? 'Choose where to save the invoice' : 'Invoice downloaded')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not create the invoice PDF.')
  }
}

function serviceLabel(key: string | null | undefined): string {
  const labels: Record<string, string> = {
    WALKING: 'Walking Partner',
    CARRY: 'Luggage Carry',
    BOTH: 'Walking + Carry',
  }
  return labels[key || ''] || key || '-'
}