import "dotenv/config";
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import http from "http";

import { env } from "./config/env";
import { generalRateLimiter } from "./middleware/rateLimiter";
import { requireDocumentAccess } from "./middleware/fileAccess";
import { blobFileHandler } from "./middleware/blobHandler";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { sendError } from "./utils/response";

import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import { SERVICE_CATALOG } from "./services/serviceCatalog";
import verificationRoutes from "./routes/verificationRoutes";
import walkingPartnerRoutes from "./routes/walkingPartnerRoutes";
import walletRoutes from "./routes/walletRoutes";
import walkingRequestRoutes from "./routes/walkingRequestRoutes";
import communityRoutes from "./routes/communityRoutes";
import eventRoutes from "./routes/eventRoutes";
import messageRoutes from "./routes/messageRoutes";
import adminRoutes from "./routes/adminRoutes";
import adminRbacRoutes from "./routes/adminRbacRoutes";
import pricingRoutes from "./routes/pricingRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import settingsRoutes from "./routes/settingsRoutes";
import appContentRoutes from "./routes/appContentRoutes";
import callRoutes from "./routes/callRoutes";
import carryBuddyRoutes from "./routes/carryBuddyRoutes";
import friendshipRoutes from "./routes/friendshipRoutes";
import roleRoutes from "./routes/roleRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import roleApplicationsRoutes from "./routes/roleApplicationsRoutes";
import locationRoutes from "./routes/locationRoutes";
import chatRequestRoutes from "./routes/chatRequestRoutes";
import privacyRoutes from "./routes/privacyRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import bookingRoutes from "./routes/bookingRoutes";
import partnerRoutes from "./routes/partnerRoutes";
import searchRoutes from "./routes/searchRoutes";
import discoveryRoutes from "./routes/discoveryRoutes";
import referralRoutes from "./routes/referralRoutes";

export function createApp(): http.Server {
  const app = express();
  // Render runs behind its own proxy; without this express treats every request
  // as coming from the single proxy IP, so per-IP rate limits apply to ALL users
  // at once. Trusting the nearest proxy lets req.ip resolve the real client.
  app.set("trust proxy", 1);
  const allowedOrigins = (env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const isLocalDevOrigin = (origin: string): boolean => {
    try {
      const url = new URL(origin);
      return (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") && url.protocol === "http:";
    } catch {
      return false;
    }
  };

  // Vercel deploys get fresh subdomains on every push (web-<hash>.*.vercel.app);
  // allow any *.vercel.app origin so the app keeps working across redeploys
  // without editing CORS_ORIGIN, while env.CORS_ORIGIN still gates custom domains.
  const isVercelOrigin = (origin: string): boolean => {
    try {
      const url = new URL(origin);
      return url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app");
    } catch {
      return false;
    }
  };

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://accounts.google.com", "https://js.clerk.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://*.clerk.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://*.clerk.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.clerk.com", "https://*.razorpay.com"],
        frameSrc: ["'self'", "https://checkout.razorpay.com", "https://accounts.google.com", "https://*.clerk.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin(origin) || isVercelOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(morgan(env.isProduction ? "combined" : "dev"));
  app.use(generalRateLimiter);

  // KYC documents under uploads/private require ownership or an admin role;
  // everything else (e.g. avatars) is publicly served. Files are stored in
  // Postgres (UploadedFile) so they survive ephemeral-host redeploys.
  app.use("/uploads", requireDocumentAccess, blobFileHandler);

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { status: "ok", timestamp: new Date().toISOString() } });
  });

  // Public privacy policy (Play Console / app store link requirement).
  app.get("/privacy", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Robots-Tag", "index, follow");
    res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Sidebud Privacy Policy" />
<title>Sidebud — Privacy Policy</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; background: #f9fafb; line-height: 1.6; }
  header { background: #4f46e5; color: #fff; padding: 2.2rem 1.2rem; text-align: center; }
  header h1 { margin: 0 0 .3rem; font-size: 1.7rem; }
  header p { margin: 0; opacity: .85; font-size: .95rem; }
  main { max-width: 780px; margin: 2rem auto; padding: 0 1.2rem 3rem; }
  section { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.4rem 1.6rem; margin-bottom: 1.2rem; }
  h2 { font-size: 1.15rem; margin: 0 0 .6rem; color: #111827; }
  ul { margin: .4rem 0 .2rem; padding-left: 1.2rem; }
  li { margin-bottom: .25rem; }
  a { color: #4f46e5; }
  .muted { color: #6b7280; font-size: .85rem; }
  .contact { background: #eef2ff; border-color: #c7d2fe; }
</style>
</head>
<body>
<header>
  <h1>Sidebud Privacy Policy</h1>
  <p>Effective date: September 7, 2026</p>
</header>
<main>
  <section>
    <h2>1. Introduction</h2>
    <p>Sidebud ("we", "our", or "us") provides a peer-assistance marketplace that connects people who request help with local verified partners. This policy explains what information we collect, why we collect it, how it is used, and the choices you have.</p>
  </section>
  <section>
    <h2>2. Information We Collect</h2>
    <ul>
      <li><strong>Account information:</strong> name, email address, phone number, date of birth, gender, and password (stored hashed) when you register.</li>
      <li><strong>Profile details:</strong> city, bio, profile photo, and optional verification documents needed to become a partner (e.g. government ID, address proof).</li>
      <li><strong>Location:</strong> your device location is used to match you with nearby partners and to allow partners to provide services. You can disable location at any time through your device settings.</li>
      <li><strong>Usage data:</strong> booking and chat history, wallet transactions, service requests, and app interaction data used to operate and improve the service.</li>
      <li><strong>Payment data:</strong> payments are processed by our payment provider (Razorpay). We do not store full card numbers.</li>
      <li><strong>Authentication data:</strong> sign-in providers (Clerk / Google) may share a profile identifier so we can recognise you across logins.</li>
    </ul>
  </section>
  <section>
    <h2>3. How We Use Information</h2>
    <ul>
      <li>Provide, operate, and maintain the Sidebud marketplace.</li>
      <li>Verify partner applicants and keep the platform safe.</li>
      <li>Process bookings, payments, chat, and support requests.</li>
      <li>Send transactional notifications (booking updates, verification results, wallet alerts).</li>
      <li>Prevent fraud, abuse, and prohibited activity, and enforce our terms.</li>
      <li>Comply with legal obligations.</li>
    </ul>
  </section>
  <section>
    <h2>4. Sharing of Information</h2>
    <p>We do not sell your personal data. We share information only with:</p>
    <ul>
      <li><strong>Service providers</strong> who help us operate the app (hosting, push notifications, payments, authentication, analytics), under confidentiality obligations.</li>
      <li><strong>Other users</strong> only when needed to provide the service (e.g. a partner sees the request details needed to complete a job).</li>
      <li><strong>Authorities</strong>, if required by law.</li>
    </ul>
  </section>
  <section>
    <h2>5. Data Security</h2>
    <p>We use encryption in transit (HTTPS), hashed passwords, access controls, and regular security reviews. No method of transmission is 100% secure, but we work to protect your data.</p>
  </section>
  <section>
    <h2>6. Data Retention</h2>
    <p>We keep your data only as long as necessary for the purposes described, or as required by law. You may request deletion as described below.</p>
  </section>
  <section>
    <h2>7. Your Rights</h2>
    <p>Depending on your jurisdiction, you may have the right to access, correct, export (portability), restrict, or delete your personal data. You can update most profile information directly in the app. To exercise any other right, contact us using the details below.</p>
  </section>
  <section>
    <h2>8. Children</h2>
    <p>Sidebud is not directed at children under 13, and we do not knowingly collect their personal information. If you believe a child has provided us data, contact us and we will delete it.</p>
  </section>
  <section>
    <h2>9. Contact</h2>
    <p>For privacy questions or data requests, contact us at: <a href="mailto:${env.ADMIN_EMAIL}">${env.ADMIN_EMAIL}</a>.</p>
  </section>
  <section class="contact">
    <p class="muted">Last updated: September 7, 2026</p>
  </section>
</main>
</body>
</html>`);
  });

  // Self-contained admin console (static SPA served from the backend).
  app.use("/admin-console", (req, res, next) => {
    if (req.method === "GET" && !req.path.includes(".") && req.path !== "/") {
      // SPA fallback to index.html for client-side routes.
      req.url = "/";
    }
    next();
  }, express.static(path.resolve(process.cwd(), "public/admin")));

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/verification", verificationRoutes);
  app.use("/api/walking-partner", walkingPartnerRoutes);
  app.use("/api/walking-requests", walkingRequestRoutes);
  app.use("/api/communities", communityRoutes);
  app.use("/api/events", eventRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/admin", adminRbacRoutes);
  app.use("/api/pricing", pricingRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/content", appContentRoutes);
  app.use("/api/calls", callRoutes);
  app.use("/api/carry-buddy", carryBuddyRoutes);
  app.use("/api/friendships", friendshipRoutes);
  app.use("/api/roles", roleRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/role-applications", roleApplicationsRoutes);
  app.use("/api/location", locationRoutes);
  app.use("/api/chat-requests", chatRequestRoutes);
  app.use("/api/privacy", privacyRoutes);
  app.use("/api/payments", idempotencyMiddleware, paymentRoutes);
  app.use("/api/bookings", idempotencyMiddleware, bookingRoutes);
  app.use("/api/wallet", idempotencyMiddleware, walletRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/discovery", discoveryRoutes);
  // Public service catalog (Expanded Partner Ecosystem) — registered BEFORE the
  // /api search router (which applies auth globally) so it stays unauthenticated.
  app.get("/api/services", (_req: Request, res: Response) => {
    res.json({ success: true, data: SERVICE_CATALOG });
  });

  app.use("/api", searchRoutes);
  app.use("/api/referrals", referralRoutes);

  app.use((req: Request, res: Response) => {
    sendError(res, `Route not found: ${req.method} ${req.path}`, 404, "NOT_FOUND");
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    if (err.type === "entity.too.large") {
      sendError(res, "Payload too large.", 413, "PAYLOAD_TOO_LARGE");
      return;
    }
    if (err.message && /image/i.test(err.message)) {
      sendError(res, err.message, 400, "FILE_UPLOAD_ERROR");
      return;
    }
    sendError(res, "Internal server error.", 500, "INTERNAL_ERROR");
  });

  const server = http.createServer(app);
  return server;
}
