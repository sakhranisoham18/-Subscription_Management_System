import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { taxesRouter } from './modules/catalog/taxes.routes';
import { productsRouter } from './modules/catalog/products.routes';
import { plansRouter } from './modules/catalog/plans.routes';
import { discountsRouter } from './modules/catalog/discounts.routes';
import { templatesRouter } from './modules/catalog/templates.routes';
import { quotationsRouter } from './modules/quotations/quotations.routes';
import { subscriptionsRouter } from './modules/subscriptions/subscriptions.routes';
import { requestsRouter } from './modules/subscriptions/requests.routes';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { billingRouter } from './modules/billing/billing.routes';
import { dashboardRouter, reportsRouter } from './modules/reports/reports.routes';
import { portalRouter } from './modules/portal/portal.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { buildOpenApi } from './docs/openapi';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.clientOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));

  const api = Router();
  api.use(apiLimiter);
  api.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: 'ok', service: 'Brightloop Software — Subscription Management System', time: new Date().toISOString() } });
  });
  api.use('/auth', authRouter);

  // Everything below requires a valid access token; each router enforces its own permissions.
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/customers', customersRouter);
  api.use('/taxes', taxesRouter);
  api.use('/products', productsRouter);
  api.use('/plans', plansRouter);
  api.use('/discounts', discountsRouter);
  api.use('/templates', templatesRouter);
  api.use('/quotations', quotationsRouter);
  api.use('/subscriptions', subscriptionsRouter);
  api.use('/requests', requestsRouter);
  api.use('/invoices', invoicesRouter);
  api.use('/payments', paymentsRouter);
  api.use('/billing', billingRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/reports', reportsRouter);
  api.use('/portal', portalRouter);
  api.use('/settings', settingsRouter);

  const openapi = buildOpenApi();
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Brightloop API' }));
  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
