import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __db?: PrismaClient;
};

export const db = globalForPrisma.__db ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__db = db;
}
