// Global vitest setup for environment variables
// Sets required environment variables before any code is imported

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';
process.env.CASHFREE_APP_ID = 'test_cashfree_app_id';
process.env.CASHFREE_SECRET_KEY = 'test_cashfree_secret_key';
// CASHFREE_API_ENV is deliberately NOT set here. It defaults to production, and
// cashfreeVerification asserts the live orders endpoint is the one called; forcing
// 'test' globally made it resolve the sandbox host and fail. A test that needs
// the sandbox sets it in its own hoisted block, which runs later and wins.
process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_USER = 'test@test.com';
process.env.SMTP_PASS = 'testpass';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"type":"service_account","project_id":"test"}';
