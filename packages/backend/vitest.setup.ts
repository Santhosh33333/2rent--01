// Global vitest setup for environment variables
// Sets required environment variables before any code is imported

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook';
process.env.CLERK_SECRET_KEY = 'sk_test_placeholder';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_placeholder';
process.env.CLERK_JWKS_URL = 'https://test.clerk.accounts.dev/.well-known/jwks.json';
process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_USER = 'test@test.com';
process.env.SMTP_PASS = 'testpass';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"type":"service_account","project_id":"test"}';
