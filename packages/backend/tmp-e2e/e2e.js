require('dotenv').config()
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
const BASE = 'http://localhost:5000/api'

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await res.json() } catch {}
  return { status: res.status, ok: res.ok, json: j }
}
function assert(cond, label, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (extra !== undefined ? ' | ' + JSON.stringify(extra).slice(0, 300) : ''))
  if (!cond) process.exitCode = 1
}

async function main() {
  // ---- Provision partner (test fixture) ----
  const pEmail = 'e2e-partner@rentbuddy.app'
  const hash = await bcrypt.hash('partner123', 10)
  const partnerUser = await p.user.upsert({
    where: { email: pEmail },
    update: { passwordHash: hash },
    create: { email: pEmail, phone: '+919000000001', fullName: 'E2E Partner', passwordHash: hash, role: 'USER', activeRole: 'PARTNER', status: 'ACTIVE', emailVerified: true, dateOfBirth: new Date('1995-01-01') },
  })
  await p.wallet.upsert({ where: { userId: partnerUser.id }, update: {}, create: { userId: partnerUser.id, balance: 0 } })
  const partner = await p.partner.upsert({
    where: { userId: partnerUser.id },
    update: { status: 'APPROVED', providesWalking: true },
    create: { userId: partnerUser.id, status: 'APPROVED', providesWalking: true, isAvailable: true, latitude: 13.05, longitude: 80.28 },
  })
  console.log('Partner ready:', partnerUser.email, '| Partner.status:', partner.status)

  // ---- User login ----
  let r = await api('POST', '/auth/login', { email: 'testuser@example.com', password: 'user123' })
  const userTok = r.json?.data?.accessToken
  assert(!!userTok, 'user login')
  const userId = r.json.data.user.id

  // ---- Create booking ----
  r = await api('POST', '/bookings', { serviceType: ['WALKING'], startLocation: 'Marina Beach, Chennai', endLocation: 'Phoenix Mall, Chennai', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), durationMinutes: 45 }, userTok)
  const bk = r.json?.data
  assert(r.status === 201 && !!bk?.id, 'create booking', { id: bk?.id, amount: bk?.estimatedAmount })

  // ---- Initiate payment ----
  r = await api('POST', '/bookings/' + bk.id + '/pay', null, userTok)
  const order = r.json?.data
  assert(r.status === 200 && !!order?.orderId, 'initiate payment (Razorpay order)', order)

  // ---- Simulate gateway capture (browser checkout is the only real path in test mode).
  // Mirror EXACTLY what verifyPayment's transaction writes ----
  const payId = 'pay_SIM_' + crypto.randomBytes(6).toString('hex')
  const walletU = await p.wallet.findUnique({ where: { userId } })
  const claimed = await p.$transaction(async (tx) => {
    const c = await tx.booking.updateMany({ where: { id: bk.id, status: 'PAYMENT_INITIATED' }, data: { status: 'PARTNER_SEARCHING', paymentVerifiedAt: new Date(), finalAmount: bk.estimatedAmount, razorpayPaymentId: payId } })
    if (c.count !== 1) return false
    await tx.transaction.create({ data: { walletId: walletU.id, userId, type: 'DEBIT', status: 'COMPLETED', amount: bk.estimatedAmount, description: 'Booking payment for WALKING', referenceId: payId, bookingId: bk.id } })
    await tx.paymentOrder.updateMany({ where: { razorpayOrderId: order.orderId }, data: { razorpayPaymentId: payId, status: 'COMPLETED', completedAt: new Date() } })
    return true
  })
  assert(claimed, 'simulate captured payment -> PARTNER_SEARCHING')

  // ---- Partner sees request ----
  r = await api('POST', '/auth/login', { email: pEmail, password: 'partner123' })
  const partTok = r.json?.data?.accessToken
  assert(!!partTok, 'partner login')
  r = await api('GET', '/partner/nearby-bookings', null, partTok)
  const found = JSON.stringify(r.json || {}).includes(bk.id)
  assert(found, 'booking visible in nearby requests', { count: r.json?.data?.length ?? r.json?.data?.bookings?.length ?? 'n/a' })

  // ---- Partner accepts (race-safe claim) ----
  r = await api('POST', '/partner/bookings/' + bk.id + '/accept', {}, partTok)
  assert(r.ok, 'partner accept', r.json)

  // ---- OTP generate -> verify -> complete ----
  r = await api('POST', '/partner/bookings/' + bk.id + '/otp/generate', {}, partTok)
  assert(r.ok, 'generate OTP', r.json)
  const nres = await api('GET', '/notifications?page=1&limit=5', null, userTok)
  const notifBody = JSON.stringify(nres.json || {})
  const m = notifBody.match(/verification code is (\d{6})/)
  const otp = m ? m[1] : null
  assert(!!otp, 'user received OTP via notification', { otp })
  r = await api('POST', '/partner/bookings/' + bk.id + '/otp/verify', { otp }, partTok)
  assert(r.ok, 'verify OTP -> IN_PROGRESS', r.json)
  r = await api('POST', '/partner/bookings/' + bk.id + '/complete', {}, partTok)
  assert(r.ok, 'complete booking', r.json?.message)

  // ---- Assert money moved ----
  const bkFinal = await p.booking.findUnique({ where: { id: bk.id } })
  assert(bkFinal.status === 'COMPLETED' && Number(bkFinal.partnerEarning) > 0, 'booking COMPLETED with earnings', { status: bkFinal.status, earn: String(bkFinal.partnerEarning), fee: String(bkFinal.platformFee) })
  const walletP = await p.wallet.findUnique({ where: { userId: partnerUser.id } })
  const credits = await p.transaction.count({ where: { userId: partnerUser.id, type: { in: ['PARTNER_EARNING', 'CREDIT'] }, bookingId: bk.id } })
  assert(Number(walletP.balance) >= Number(bkFinal.partnerEarning) && credits === 1, 'partner wallet credited exactly once', { bal: String(walletP.balance), creditRows: credits })

  // ---- Histories ----
  r = await api('GET', '/bookings?status=COMPLETED', null, userTok)
  assert(JSON.stringify(r.json?.data || r.json).includes(bk.id), 'user history shows COMPLETED booking')
  r = await api('GET', '/partner/bookings', null, partTok)
  assert(JSON.stringify(r.json || {}).includes(bk.id), 'partner history shows booking')
  r = await api('GET', '/admin/bookings?page=1', null, process.env.ADMIN_TOK)
  // admin checked separately below
  console.log('NOTE: admin check via separate token')

  // ---- Admin sees booking + real PaymentOrder ----
  const adm = await api('POST', '/auth/login', { email: 'santhoshkrishna958@gmail.com', password: '300703S#s' })
  const admTok = adm.json?.data?.accessToken
  assert(!!admTok, 'admin login')
  r = await api('GET', '/admin/bookings?page=1', null, admTok)
  console.log('ADMIN BOOKINGS RESPONSE:', r.status, JSON.stringify(r.json).slice(0, 400))
  assert(JSON.stringify(r.json || {}).includes(bk.id), 'admin bookings list contains booking')
  const po = await p.paymentOrder.findUnique({ where: { razorpayOrderId: order.orderId } })
  assert(po && po.type === 'BOOKING' && po.status === 'COMPLETED' && po.razorpayPaymentId === payId, 'PaymentOrder record settled', { type: po?.type, status: po?.status })

  // ---- Switch-role probes ----
  r = await api('POST', '/auth/switch-role', { role: 'USER' }, partTok)
  assert(r.ok && r.json?.data?.user?.activeRole === 'USER', 'approved partner switches to USER', r.json)
  const uTok2 = userTok
  r = await api('POST', '/auth/switch-role', { role: 'PARTNER' }, uTok2)
  assert(!r.ok, 'non-partner cannot switch to PARTNER (403)', { status: r.status })
  r = await api('POST', '/auth/switch-role', { role: 'PARTNER' }, partTok)
  assert(r.ok && r.json?.data?.user?.activeRole === 'PARTNER', 'partner switches back to PARTNER', r.json)

  // ---- Duplicate protection probes ----
  r = await api('POST', '/partner/bookings/' + bk.id + '/accept', {}, partTok)
  assert(!r.ok, 'double accept rejected', { status: r.status })
  r = await api('POST', '/partner/bookings/' + bk.id + '/complete', {}, partTok)
  assert(!r.ok, 'double complete rejected', { status: r.status })
}
main().catch(e => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => p.$disconnect())





