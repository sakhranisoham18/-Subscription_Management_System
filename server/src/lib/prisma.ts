import { PrismaClient, Prisma } from '@prisma/client';
import { env } from '../config/env';

declare global {
   
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (!env.isProd) global.__prisma = prisma;

export type Tx = Prisma.TransactionClient;
export { Prisma };
