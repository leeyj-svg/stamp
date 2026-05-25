import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __db?: PrismaClient;
  __dbCacheKey?: string;
};

const PRISMA_CACHE_KEY = "space-theme-appearances-v1";

if (!globalForPrisma.__db || globalForPrisma.__dbCacheKey !== PRISMA_CACHE_KEY) {
  void globalForPrisma.__db?.$disconnect().catch(() => undefined);
  globalForPrisma.__db = new PrismaClient();
  globalForPrisma.__dbCacheKey = PRISMA_CACHE_KEY;
}

export const db = globalForPrisma.__db;
