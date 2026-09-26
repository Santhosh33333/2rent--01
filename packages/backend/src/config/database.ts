import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Hostname of the configured database, or null when it cannot be parsed.
 *
 * Only the host is ever returned - never the credentials. The API and the
 * database are often in different regions, and that distance dominates
 * latency, so it is logged once at boot to make the mismatch obvious.
 */
export function databaseHost(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const match = /@([^/:?]+)/.exec(url);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function testConnection(): Promise<void> {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
