import 'dotenv/config';

// Integration tests run against TEST_DATABASE_URL (wiped between suites). Never point this at real data.
process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-test-refresh-secret-0123456789';
process.env.BILLING_SCHEDULER_ENABLED = 'false';
process.env.SMTP_HOST = '';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
