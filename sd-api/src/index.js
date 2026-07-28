require("dotenv").config();

const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");

const { env } = require("./config/env");
const { connectToMongo } = require("./db/mongo");
const { ApiError } = require("./lib/api-error");
const { errorHandler, notFoundHandler } = require("./middleware/error.middleware");
const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const editorialRoutes = require("./routes/editorial.routes");
const imageRoutes = require("./routes/images");
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

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/editorial-stories", editorialRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/profile", profileRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await connectToMongo();

  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
