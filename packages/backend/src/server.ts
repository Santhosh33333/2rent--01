import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma, testConnection, disconnect } from "./config/database";
import { initializeFirebase } from "./services/notificationService";
import { sendPushNotification } from "./services/notificationService";
import { initializeFirebaseAuth } from "./services/firebaseAuthService";
import { initializeSocket } from "./services/socketService";
import { emitToUser } from "./services/socketService";
import { processTimeoutBookings, sendUpcomingReminders } from "./services/bookingEngine";

const TIMEOUT_SWEEP_INTERVAL_MS = 30_000;
const REMINDER_SWEEP_INTERVAL_MS = 60_000;
let timeoutSweeper: ReturnType<typeof setInterval> | null = null;
let reminderSweeper: ReturnType<typeof setInterval> | null = null;

function startTimeoutSweeper(): void {
  // Recovers bookings stuck in PARTNER_SEARCHING/PARTNER_ASSIGNED past their
  // offer window: auto-cancel + refund record. Runs every 30s.
  timeoutSweeper = setInterval(() => {
    processTimeoutBookings().catch((err) =>
      console.error("[TIMEOUT] Sweeper run failed:", err)
    );
  }, TIMEOUT_SWEEP_INTERVAL_MS);
  timeoutSweeper.unref?.();
}

function startReminderSweeper(): void {
  // Upcoming-job reminders (accepted jobs starting within 30 min), once each.
  reminderSweeper = setInterval(() => {
    sendUpcomingReminders().catch((err) =>
      console.error("[REMINDER] Sweeper run failed:", err)
    );
  }, REMINDER_SWEEP_INTERVAL_MS);
  reminderSweeper.unref?.();
}

async function main(): Promise<void> {
  // The entire API depends on the database. Running "without DB" only produces
  // 500s on every route (and silently breaks things like the payment gateway),
  // which is misleading and hard to diagnose. Require a live DB connection at
  // startup: retry a few times (covers slow-starting Postgres), then hard-fail
  // loudly so the operator knows immediately instead of discovering it via 500s.
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 2000;
  let dbAvailable = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await testConnection();
      dbAvailable = true;
      console.log("Database connection established.");
      break;
    } catch (err) {
      console.warn(`Database connection attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error)?.message ?? err}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
      }
    }
  }

if (!dbAvailable) {
    console.error(
      "\nâ\x9DŒ CRITICAL: Could not connect to the database after multiple attempts.\n" +
      "   The server will NOT start in 'no DB' mode. Verify PostgreSQL is running\n" +
      "   (e.g. Start-Service postgresql-x64-17) and DATABASE_URL is correct, then restart.\n"
    );
    process.exit(1);
  }

  // Runtime schema reconciliation. The UploadedFile table (Postgres blob
  // storage) was added via migration, but one production DB recorded the
  // migration without applying the DDL, so uploads 500'd ("table does not
  // exist"). Create it idempotently at boot to match the migration exactly.
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "UploadedFile" (
        "id" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "filename" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "data" BYTEA NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
      )`
    );
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UploadedFile_key_key" ON "UploadedFile"("key")`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "UploadedFile_createdAt_idx" ON "UploadedFile"("createdAt")`
    );
    // If Prisma had recorded this migration as FAILED (finished_at IS NULL),
    // the next `migrate deploy` would re-run the (now idempotent) DDL and
    // could fail on the already-created table, aborting deploys. Resolve the
    // row as applied, mirroring `prisma migrate resolve --applied` once the
    // table is guaranteed to exist. No-op when the row is already finished
    // or absent.
    await prisma.$executeRawUnsafe(
      `UPDATE "_prisma_migrations"
       SET finished_at = COALESCE(finished_at, NOW()),
           applied_steps_count = 1,
           logs = NULL,
           rolled_back_at = NULL
       WHERE migration_name = '20260906_uploaded_files'
         AND finished_at IS NULL`
    );
    console.log("Schema reconciliation: UploadedFile ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning:", (err as Error)?.message);
  }

  initializeFirebase();
  initializeFirebaseAuth();

  const server = createApp();

  const io = initializeSocket(server);

  // Realtime + push fan-out for EVERY in-app notification row (spec: OTP and
  // arrival alerts must reach the user live, not sit silently in the DB).
  // Installed once on the shared singleton â€” covers all creators, so no
  // call site can forget to emit. Never throws into the write path.
  prisma.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === "Notification" && params.action === "create") {
      try {
        const n = result as { id: string; userId: string; title: string; body: string; data?: string | null };
        if (n?.userId) {
          emitToUser(n.userId, "notification", { id: n.id, title: n.title, body: n.body, data: n.data });
          let pushData: Record<string, string> | undefined;
          try {
            const parsed = n.data ? JSON.parse(n.data) : null;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              pushData = Object.fromEntries(
                Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
              );
            }
          } catch {
            pushData = undefined;
          }
          void sendPushNotification(n.userId, n.title, n.body, pushData);
        }
      } catch (err) {
        console.error("[NOTIFY] fan-out failed:", err);
      }
    }
    return result;
  });

  startTimeoutSweeper();
  startReminderSweeper();

  server.listen(env.PORT, () => {
    console.log(`Sidebud API server listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    if (timeoutSweeper) {
      clearInterval(timeoutSweeper);
    }
    if (reminderSweeper) {
      clearInterval(reminderSweeper);
    }
    server.close(() => {
      console.log("HTTP server closed.");
    });
    io.close(() => {
      console.log("Socket.IO server closed.");
    });
    try {
      await disconnect();
      console.log("Database disconnected.");
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

void main();
