require("dotenv").config();

const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");

const { env } = require("./config/env");
const { connectToMongo, getRawDb } = require("./db/mongo");
const { ApiError } = require("./lib/api-error");
const { errorHandler, notFoundHandler } = require("./middleware/error.middleware");
const authRoutes = require("./routes/auth.routes");
const contentRoutes = require("./routes/content.routes");
const draftingRoutes = require("./routes/drafting.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const editorialRoutes = require("./routes/editorial.routes");
const imageRoutes = require("./routes/images");
const inviteRoutes = require("./routes/invite.routes");
const reviewRoutes = require("./routes/review.routes");
const { ensureInviteIndexes } = require("./services/invite.service");
const { startDraftWorker } = require("./services/draftJob.service");
const profileRoutes = require("./routes/profile.routes");

const app = express();

app.set("trust proxy", 1);

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
/* Mounted at /api so the public claim path is /api/invites/:token and the
   service path is /api/internal/invites — one prefix, two auth models. */
app.use("/api", inviteRoutes);
app.use("/api", reviewRoutes);
app.use("/api/profile", profileRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await connectToMongo();
  /* Invitation indexes: unique on token_hash so a collision cannot create two
     live invitations, and {profile_id,status} so superseding an outstanding one
     does not scan. sd-api owns this collection, so it may create them. */
  await ensureInviteIndexes();
  /* The drafting queue. Off with DRAFTING_ENABLED=false (kill switch) or
     DRAFTING_WORKER=false (serve the API, run no jobs). */
  startDraftWorker();

  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
