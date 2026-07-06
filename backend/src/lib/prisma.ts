import { PrismaClient } from "@prisma/client";

/**
 * A single long-lived Node process (this backend) can still open more Postgres connections
 * than expected once you count: concurrent web requests, the hourly job triggers, and Prisma's
 * own internal pool growth under load. Railway's managed Postgres has a hard connection cap
 * shared across everything hitting that database — without an explicit limit here, a traffic
 * spike can exhaust it and start failing requests with cryptic "too many connections" errors.
 *
 * If DATABASE_URL doesn't already specify one, we cap this client's pool to a conservative
 * default. For real horizontal scaling (multiple backend instances), put pgbouncer in front of
 * Postgres instead of just raising this number — connection_limit only bounds *this* process.
 */
const DEFAULT_CONNECTION_LIMIT = 10;

function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw; // let validateEnv() handle the missing-var case; don't duplicate that check here

  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", String(DEFAULT_CONNECTION_LIMIT));
      console.log(`[prisma] DATABASE_URL has no connection_limit — defaulting to ${DEFAULT_CONNECTION_LIMIT}`);
    }
    return url.toString();
  } catch {
    // Non-standard connection string format — use as-is rather than risk corrupting it.
    return raw;
  }
}

export const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
});
