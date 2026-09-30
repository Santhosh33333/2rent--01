import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL
  const envPassword = process.env.ADMIN_PASSWORD

  const admin = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true, passwordHash: true },
  })
  if (!admin) {
    console.log('no user with email', email)
    return
  }
  const matches = await bcrypt.compare(envPassword, admin.passwordHash)
  console.log('env ADMIN_EMAIL   :', email)
  console.log('db role/status    :', admin.role, admin.status)
  console.log('hash looks like bcrypt:', /^\$2[aby]\$/.test(admin.passwordHash))
  console.log('env password matches stored hash:', matches)
  console.log('stored hash prefix:', admin.passwordHash.slice(0, 12) + '...')
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
