import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // These identifiers were created through the PRODUCTION API in this session.
  // If they are here, this DATABASE_URL is the production database.
  const order = await prisma.paymentOrder.findFirst({
    where: { cashfreeOrderId: 'topup_c0fba33923ea' },
    select: { cashfreeOrderId: true, status: true, amount: true, createdAt: true },
  })
  console.log('order created via live API found here:', order ?? 'NOT FOUND -> this is a different database')

  const harness = await prisma.paymentOrder.findFirst({
    where: { cashfreeOrderId: { contains: '43891003' } },
    select: { cashfreeOrderId: true, status: true },
  })
  console.log('harness top-up order (TOPUP-43891003):', harness ?? 'NOT FOUND')

  const counts = {
    users: await prisma.user.count(),
    paymentOrders: await prisma.paymentOrder.count(),
    transactions: await prisma.transaction.count(),
  }
  console.log('row counts:', counts)

  const newest = await prisma.paymentOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { cashfreeOrderId: true, status: true, createdAt: true },
  })
  console.log('most recent payment orders:')
  for (const o of newest) console.log('  ', o.cashfreeOrderId, o.status, o.createdAt.toISOString())

  const dbs = await prisma.$queryRaw`select current_database() as db, current_user as usr, inet_server_addr()::text as host`
  console.log('connected to:', dbs[0])
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
