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

  // Runtime reconciliation for the event discovery rebuild (migration
  // 20260921_event_cover_category). Same pattern as above: Render builds do
  // not reliably run `migrate deploy`, so ensure the columns idempotently.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "category" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "privacy" TEXT NOT NULL DEFAULT 'PUBLIC'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "Event_status_startTime_idx" ON "Event"("status", "startTime")`
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Event_category_idx" ON "Event"("category")`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "subcategory" TEXT`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "Event_category_subcategory_idx" ON "Event"("category", "subcategory")`
    );
    console.log("Schema reconciliation: Event discovery columns ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (Event):", (err as Error)?.message);
  }

  // Hot-path indexes for throughput (migration 20260922_hotpath_indexes).
  // CREATE INDEX IF NOT EXISTS never blocks writers and is safe to re-run.
  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Booking_userId_status_idx" ON "Booking"("userId", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Booking_partnerId_status_idx" ON "Booking"("partnerId", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Booking_status_scheduledAt_idx" ON "Booking"("status", "scheduledAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BookingTimeout_isProcessed_timeoutAt_idx" ON "BookingTimeout"("isProcessed", "timeoutAt")`);
    console.log("Schema reconciliation: hot-path indexes ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (indexes):", (err as Error)?.message);
  }

  // OTP records table (migration 20260922_otp_codes). Idempotent.
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "OtpCode" (
        "id" TEXT NOT NULL,
        "userId" TEXT,
        "identifier" TEXT NOT NULL,
        "channel" TEXT NOT NULL,
        "purpose" TEXT NOT NULL,
        "codeHash" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "attemptCount" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 5,
        "status" TEXT NOT NULL DEFAULT 'CREATED',
        "requestIp" TEXT,
        "userAgent" TEXT,
        "provider" TEXT,
        "providerMessageId" TEXT,
        "deliveryStatus" TEXT,
        "failureReason" TEXT,
        "verifiedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
      )`
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OtpCode_identifier_purpose_status_idx" ON "OtpCode"("identifier", "purpose", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OtpCode_createdAt_idx" ON "OtpCode"("createdAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt")`);
    console.log("Schema reconciliation: OtpCode ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (OtpCode):", (err as Error)?.message);
  }

  // Chat replies + reactions (migration 20260922_message_reply_react).
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyToId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "reactions" JSONB`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId")`);
    console.log("Schema reconciliation: Message reply/react ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (Message):", (err as Error)?.message);
  }

  // Movie watchlist (migration 20260922_movie_watchlist). Idempotent.
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "MovieWatchlist" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "tmdbId" INTEGER NOT NULL,
        "title" TEXT NOT NULL,
        "posterUrl" TEXT,
        "releaseDate" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MovieWatchlist_pkey" PRIMARY KEY ("id")
      )`
    );
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MovieWatchlist_userId_tmdbId_key" ON "MovieWatchlist"("userId", "tmdbId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MovieWatchlist_userId_idx" ON "MovieWatchlist"("userId")`);
    console.log("Schema reconciliation: MovieWatchlist ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (MovieWatchlist):", (err as Error)?.message);
  }

  // UPI payment proof screenshot (migration 20260922_upi_proof). Idempotent.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "UpiPayment" ADD COLUMN IF NOT EXISTS "proofImageUrl" TEXT`);
    console.log("Schema reconciliation: UpiPayment proof ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (UpiPayment):", (err as Error)?.message);
  }

  // Manual-UPI wallet top-ups (migration 20260922_topup_requests). Idempotent.
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "TopupRequest" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "amount" DECIMAL(65,30) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "referenceNumber" TEXT NOT NULL,
        "proofImageUrl" TEXT,
        "status" TEXT NOT NULL DEFAULT 'VERIFICATION_PENDING',
        "verifiedByAdminId" TEXT,
        "verificationNote" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TopupRequest_pkey" PRIMARY KEY ("id")
      )`
    );
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TopupRequest_referenceNumber_key" ON "TopupRequest"("referenceNumber")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TopupRequest_status_idx" ON "TopupRequest"("status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TopupRequest_userId_idx" ON "TopupRequest"("userId")`);
    console.log("Schema reconciliation: TopupRequest ensured.");
  } catch (err) {
    console.warn("Schema reconciliation warning (TopupRequest):", (err as Error)?.message);
  }

  initializeFirebase();
  initializeFirebaseAuth();

  const server = createApp();

  const io = initializeSocket(server);

  // Realtime + push fan-out for EVERY in-app notification row (spec: OTP and
  // arrival alerts must reach the user live, not sit silently in the DB).
  // Installed once on the shared singleton — covers all creators, so no
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
    console.log(`Side Bud API server listening on port ${env.PORT} [${env.NODE_ENV}]`);
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
