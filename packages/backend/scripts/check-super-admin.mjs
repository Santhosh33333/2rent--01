import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

function loadDotEnv() {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()

const prisma = new PrismaClient()
const email = (process.env.ADMIN_EMAIL ?? '').toLowerCase()

const rows = await prisma.user.findMany({
  where: { OR: [{ email: { equals: email, mode: 'insensitive' } }, { role: 'SUPER_ADMIN' }] },
  select: {
    id: true, email: true, role: true, activeRole: true, status: true,
    suspendedUntil: true, suspensionReason: true, emailVerified: true, mobileVerified: true,
  },
})
console.log('ADMIN_EMAIL env =', email || '(unset)')
for (const r of rows) {
  console.log('---')
  console.log('  id            ', r.id)
  console.log('  email         ', r.email)
  console.log('  role          ', r.role)
  console.log('  activeRole    ', r.activeRole)
  console.log('  status        ', r.status)
  console.log('  suspendedUntil', r.suspendedUntil?.toISOString() ?? 'null')
  console.log('  reason        ', r.suspensionReason ?? 'null')
  console.log('  emailVerified ', r.emailVerified, ' mobileVerified', r.mobileVerified)
}
await prisma.$disconnect()
