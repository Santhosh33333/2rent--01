import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma, testConnection, disconnect } from "./config/database";
import { initializeFirebase } from "./services/notificationService";
import { initializeFirebaseAuth } from "./services/firebaseAuthService";
import { initializeSocket } from "./services/socketService";
import { processTimeoutBookings } from "./services/bookingEngine";

const TIMEOUT_SWEEP_INTERVAL_MS = 30_000;
let timeoutSweeper: ReturnType<typeof setInterval> | null = null;

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
      "\n❌ CRITICAL: Could not connect to the database after multiple attempts.\n" +
      "   The server will NOT start in 'no DB' mode. Verify PostgreSQL is running\n" +
      "   (e.g. Start-Service postgresql-x64-17) and DATABASE_URL is correct, then restart.\n"
    );
    process.exit(1);
  }

  initializeFirebase();
  initializeFirebaseAuth();

  const server = createApp();

  const io = initializeSocket(server);

  startTimeoutSweeper();

  server.listen(env.PORT, () => {
    console.log(`RentBuddy API server listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    if (timeoutSweeper) {
      clearInterval(timeoutSweeper);
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
