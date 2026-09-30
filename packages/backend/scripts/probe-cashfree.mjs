/**
 * Read-only probe: does the configured Cashfree credential authenticate, and is
 * it a test-mode or live-mode key? Creates a real order on the account, so it is
 * run deliberately, not as part of the test suite.
 */
import { readFileSync } from 'node:fs';

function loadDotEnv() {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const appId = process.env.CASHFREE_APP_ID;
const secret = process.env.CASHFREE_SECRET_KEY;
const mode = process.env.CASHFREE_API_ENV;
const base = mode === 'test' ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';

console.log('mode    :', mode);
console.log('host    :', base);
console.log('app_id  :', appId ? `${appId.slice(0, 6)}...${appId.slice(-4)} (len ${appId.length})` : '(empty)');
console.log('secret  :', secret ? `${secret.slice(0, 6)}... (len ${secret.length})` : '(empty)');

if (!appId || !secret) {
  console.log('\nRESULT: no credentials configured.');
  process.exit(0);
}

const orderId = `probe_${Date.now()}`;
const body = {
  order_id: orderId,
  order_amount: '10.00',
  order_currency: 'INR',
  customer_details: {
    customer_id: 'probe_user',
    customer_name: 'Probe User',
    customer_phone: '9876543210',
  },
};

const auth = Buffer.from(`${appId}:${secret}`).toString('base64');

const res = await fetch(`${base}/orders`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-client-id': appId,
    'x-client-secret': secret,
    'x-api-version': '2025-01-01',
    Authorization: `Basic ${auth}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }

console.log('\nHTTP', res.status);
if (parsed.order_status) {
  console.log('order_status       :', parsed.order_status);
  console.log('order_id           :', parsed.order_id);
  console.log('payment_session_id :', parsed.payment_session_id ?? '(none)');
  const links = parsed.payment_links ?? {};
  for (const [k, v] of Object.entries(links)) console.log(`payment_links.${k.padEnd(5)}:`, v);
  console.log('\nRESULT: credentials are VALID for this host.');
} else {
  console.log('message:', parsed.message ?? parsed.raw);
  if (parsed.message && /auth|credential|app id|secret/i.test(parsed.message)) {
    console.log('\nRESULT: credentials REJECTED on this host.');
    console.log('If these are test keys, set CASHFREE_API_ENV=test;');
    console.log('if they are live keys, set CASHFREE_API_ENV=production.');
  } else {
    console.log('\nRESULT: request reached Cashfree but was refused for another reason.');
  }
}
