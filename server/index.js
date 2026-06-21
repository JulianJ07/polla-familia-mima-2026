import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { createApiRouter } from "./routes/api.js";
import { createFootballSyncService } from "./services/footballSync.js";

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

const footballSync = createFootballSyncService(io);
footballSync.start();

app.use("/api", createApiRouter(io, footballSync));

const distDir = path.join(rootDir, "client", "dist");
app.use(express.static(distDir));
app.get(/.*/, (_req, res, next) => {
  const indexPath = path.join(distDir, "index.html");
  res.sendFile(indexPath, (error) => {
    if (error) next();
  });
});

server.listen(port, host, () => {
  console.log(`Polla Familia Mima 2026 running on http://${host}:${port}`);
});
