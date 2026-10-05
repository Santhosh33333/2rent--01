/**
 * TEMPORARY: seeds a referrer, a user whose referral failed, and a pending
 * referral code in the browser's localStorage equivalent - used to verify the
 * ReferralCard retry affordance in a real browser. Removed afterwards.
 */
import bcrypt from 'bcryptjs'
import http from 'node:http'
import { prisma } from '../src/config/database'

const REFERRER = { email: 'tmp.ref.a@example.com', phone: '+919876500111', name: 'Ref A' }
const PENDING = { email: 'tmp.ref.b@example.com', phone: '+919876500222', name: 'Ref B' }
const BAD_CODE = 'RB-DEADBEEF'
const PASSWORD = 'TestPass!2026x'

function call(method: string, path: string, body?: unknown, token?: string) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : ''
    const req = http.request(
      {
        host: 'localhost',
        port: 5000,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode ?? 0, json: JSON.parse(d) })
          } catch {
            resolve({ status: r.statusCode ?? 0, json: { raw: d.slice(0, 200) } })
          }
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function signup(u: typeof REFERRER) {
  return call('POST', '/api/auth/register', {
    fullName: u.name,
    email: u.email,
    phone: u.phone,
    password: PASSWORD,
    dateOfBirth: '1992-05-05',
    gender: 'OTHER',
    accountType: 'USER',
    role: 'USER',
    legalConsent: { accepted: true, signatureValue: u.name },
  })
}

async function main(): Promise<void> {
  const a = await signup(REFERRER)
  const refId: string = a.json.data.user.id
  const refToken: string = a.json.data.accessToken
  const goodCode = `RB-${refId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
  console.log('referrer code:', goodCode)

  const b = await signup(PENDING)
  const bToken: string = b.json.data.accessToken

  // Simulate the registration-time failure exactly as the page now does.
  const apply = await call('POST', '/api/referrals/apply', { code: BAD_CODE }, bToken)
  console.log('bad-code apply ->', apply.status, apply.json?.error)
  console.log('RETRY_CODE_FOR_BROWSER=' + BAD_CODE)
  console.log('VALID_CODE_FOR_BROWSER=' + goodCode)
  console.log('PENDING_USER_EMAIL=' + PENDING.email)
  console.log('PENDING_PASSWORD=' + PASSWORD)
  console.log('REFERRER_EMAIL=' + REFERRER.email)
  console.log('REFERRER_TOKEN_LEN=' + refToken.length)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error('failed:', e instanceof Error ? e.message : e)
    await prisma.$disconnect()
    process.exit(1)
  })