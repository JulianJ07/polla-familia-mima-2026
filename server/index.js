import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { Server } from "socket.io";
import { createApiRouter } from "./routes/api.js";
import { insertLog } from "./db/supabase.js";
import { hasLiveMatches, syncExternalData } from "./services/syncService.js";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const configuredOrigins = process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
const corsOrigin = configuredOrigins?.length
  ? configuredOrigins
  : process.env.NODE_ENV === "production"
    ? true
    : "http://127.0.0.1:5173";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "2mb" }));

io.on("connection", (socket) => {
  socket.emit("connected", { ok: true });
});

app.use("/api", createApiRouter(io));

const distDir = path.join(rootDir, "client", "dist");
app.use(express.static(distDir));
app.get(/.*/, (_req, res, next) => {
  const indexPath = path.join(distDir, "index.html");
  res.sendFile(indexPath, (error) => {
    if (error) next();
  });
});

if (process.env.ENABLE_CRON === "true") {
  cron.schedule("*/2 * * * *", async () => {
    const now = new Date();
    const tournamentStart = new Date("2026-06-11T00:00:00.000Z");
    const tournamentEnd = new Date("2026-07-20T00:00:00.000Z");
    const inTournament = now >= tournamentStart && now <= tournamentEnd;
    const minute = now.getUTCMinutes();
    let live = false;
    try {
      live = await hasLiveMatches();
    } catch (error) {
      await insertLog("cron", "error", error.message);
    }
    const shouldRun = live || (inTournament && minute % 30 < 2) || (!inTournament && now.getUTCHours() === 8 && minute < 2);
    if (!shouldRun) return;
    await syncExternalData(io);
  });
}

server.listen(port, host, () => {
  console.log(`Polla Familia Mima 2026 running on http://${host}:${port}`);
});
