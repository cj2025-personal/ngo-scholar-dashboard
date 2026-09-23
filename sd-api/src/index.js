require("dotenv").config();

const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

const { env } = require("./config/env");
const { connectToMongo, closeMongo, getRawDb } = require("./db/mongo");
const { ApiError } = require("./lib/api-error");
const { errorHandler, notFoundHandler } = require("./middleware/error.middleware");
const authRoutes = require("./routes/auth.routes");
const contentRoutes = require("./routes/content.routes");
const draftingRoutes = require("./routes/drafting.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const editorialRoutes = require("./routes/editorial.routes");
const imageRoutes = require("./routes/images");
const inviteRoutes = require("./routes/invite.routes");
const podcastRoutes = require("./routes/podcasts.routes");
const standingRoutes = require("./routes/standing.routes");
const reviewRoutes = require("./routes/review.routes");
const { ensureInviteIndexes } = require("./services/invite.service");
const { startDraftWorker, stopDraftWorker } = require("./services/draftJob.service");
const profileRoutes = require("./routes/profile.routes");

const app = express();

app.set("trust proxy", 1);
/* The version and platform of the server are not the caller's business. */
app.disable("x-powered-by");

/**
 * Security headers.
 *
 * Two departures from the defaults, both because of what this service serves:
 *
 * `crossOriginResourcePolicy` is cross-origin because the API serves story
 * images that the UI embeds from a different origin. The default, same-origin,
 * would leave every illustration broken — and broken in a way that looks like
 * a storage fault rather than a header.
 *
 * HSTS is production-only. It is a no-op over plain HTTP anyway, but pinning a
 * hostname to HTTPS from a developer's machine is a slow thing to undo, so it
 * is not sent from one.
 */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: env.isProduction ? undefined : false,
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new ApiError(403, "CORS origin is not allowed."));
    },
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "sd-api",
    message: "Scholar Dashboard API is running",
  });
});

/* A health check that can fail. The previous one returned ok unconditionally,
   which is a liveness probe pretending to be a readiness one: a deploy with a
   bad Mongo URI passed it and served 500s. Two seconds is longer than any
   healthy ping and shorter than a load balancer's patience. */
app.get("/health", async (req, res) => {
  try {
    const db = await getRawDb();
    await Promise.race([
      db.command({ ping: 1 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ping timed out")), 2000)),
    ]);
    res.status(200).json({ status: "ok", db: "ok" });
  } catch (error) {
    res.status(503).json({ status: "degraded", db: "unreachable", error: error.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/drafting", draftingRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/editorial-stories", editorialRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/podcasts", podcastRoutes);
app.use("/api/standing", standingRoutes);
/* Mounted at /api so the public claim path is /api/invites/:token and the
   service path is /api/internal/invites — one prefix, two auth models. */
app.use("/api", inviteRoutes);
app.use("/api", reviewRoutes);
app.use("/api/profile", profileRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

/**
 * How long to let in-flight requests finish before connections are cut.
 *
 * Shorter than the 30s a container runtime typically allows between SIGTERM
 * and SIGKILL, so the process chooses its own ending rather than being killed
 * mid-write.
 */
const SHUTDOWN_GRACE_MS = 10_000;

let server = null;
let shuttingDown = false;

/**
 * Stop in an order that loses nothing.
 *
 *   1. Stop claiming jobs. A job already running is not waited for: it can
 *      take minutes, and it does not need to be. The worker holds a 120s
 *      lease, so an interrupted job is reclaimed and retried by whichever
 *      instance is alive — the recovery path the queue was built around.
 *   2. Stop accepting connections, and let the ones in flight finish.
 *   3. Cut what is left. The job event stream holds a connection open for up
 *      to ten minutes by design, so waiting for every socket would hang the
 *      shutdown until the runtime killed it. Idle sockets go immediately;
 *      the rest get the grace period and are then closed.
 *   4. Close the database pool, so no write is left half-issued.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received; draining`);

  stopDraftWorker();

  const closed = server
    ? new Promise((resolve) => server.close(resolve))
    : Promise.resolve();
  if (server?.closeIdleConnections) server.closeIdleConnections();

  const forced = setTimeout(() => {
    console.warn(`[shutdown] still busy after ${SHUTDOWN_GRACE_MS}ms; closing remaining connections`);
    if (server?.closeAllConnections) server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS);
  /* The timer must not itself keep the process alive. */
  forced.unref();

  await closed;
  clearTimeout(forced);
  await closeMongo();
  console.log("[shutdown] done");
  process.exit(0);
}

async function start() {
  await connectToMongo();
  /* Invitation indexes: unique on token_hash so a collision cannot create two
     live invitations, and {profile_id,status} so superseding an outstanding one
     does not scan. sd-api owns this collection, so it may create them. */
  await ensureInviteIndexes();
  /* The drafting queue. Off with DRAFTING_ENABLED=false (kill switch) or
     DRAFTING_WORKER=false (serve the API, run no jobs). */
  startDraftWorker();

  server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      shutdown(signal).catch((error) => {
        console.error("[shutdown] failed:", error);
        process.exit(1);
      });
    });
  }
}

/* A rejection nobody handled is a bug, and Node's own default is to end the
   process. It is logged here first, because the default prints something a
   great deal harder to act on, and then drained rather than dropped. */
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled promise rejection:", reason);
  shutdown("unhandledRejection").catch(() => process.exit(1));
});

/* After this the process state is not trustworthy, so nothing is drained:
   log it and go. The runtime restarts us; an instance limping on with
   corrupt state serves wrong answers instead of no answers. */
process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaught exception:", error);
  process.exit(1);
});

start().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
