import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EMAIL = process.env.ADMIN_EMAIL

async function main() {
  const admin = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      activeRole: true,
      status: true,
      suspendedUntil: true,
      suspensionReason: true,
      emailVerified: true,
      mobileVerified: true,
      phone: true,
      lastLoginAt: true,
    },
  })
  console.log('=== admin row ===')
  console.log(admin ?? 'NOT FOUND by email')

  const allAdmins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    select: { email: true, role: true, status: true, suspendedUntil: true },
  })
  console.log('\n=== every privileged account ===')
  for (const a of allAdmins) console.log(' ', a.role, a.status, a.suspendedUntil ?? '-', a.email)

  const blocked = await prisma.user.findMany({
    where: { OR: [{ status: { not: 'ACTIVE' } }, { suspendedUntil: { gt: new Date() } }] },
    select: { email: true, role: true, status: true, suspendedUntil: true, suspensionReason: true },
  })
  console.log(`\n=== blocked/suspended accounts (${blocked.length}) ===`)
  for (const b of blocked)
    console.log(' ', b.status, b.suspendedUntil?.toISOString() ?? '-', b.role, b.email, '|', b.suspensionReason ?? '')
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
