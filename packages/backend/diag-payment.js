require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
const Razorpay = require('razorpay')

async function main() {
  const b = await p.booking.findUnique({ where: { id: 'cc2bcb77-1934-45c5-a793-e16bcdc0769e' }, select: { id: true, status: true, estimatedAmount: true, durationMinutes: true } })
  console.log('BOOKING ROW:', JSON.stringify(b))

  const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  try {
    const o = await rz.orders.create({ amount: b.estimatedAmount * 100, currency: 'INR', receipt: 'diag2_' + Date.now() })
    console.log('ORDER OK:', o.id)

    const upd = await p.booking.update({ where: { id: b.id }, data: { razorpayOrderId: o.id } })
    console.log('BOOKING UPDATE OK:', upd.razorpayOrderId)

    const al = await p.auditLog.create({ data: { actorId: (await p.user.findFirst({ select: { id: true } })).id, actorType: 'USER', action: 'DIAG_TEST', entityType: 'Booking', entityId: b.id, metadata: JSON.stringify({ t: 1 }) } })
    console.log('AUDITLOG OK:', al.id)
    await p.auditLog.delete({ where: { id: al.id } })
  } catch (e) {
    console.log('STEP FAILED:', (e.error && e.error.description) || e.message)
    console.log('STACK HEAD:', String(e.stack).split('\n').slice(0, 4).join(' | '))
  }
}
main().finally(() => p.$disconnect())
