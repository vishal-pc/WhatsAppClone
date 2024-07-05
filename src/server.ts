import express from "express";
import http from "http";
import DbConnection from "./config/db.config";
import { initializeWebSocket } from "./socket/index.socket";
import Logger from "./utils/logger";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = parseInt(process.env.Port as string, 10);
const server: http.Server = http.createServer(app);

function startServer(port: number) {
  try {
    DbConnection.then(() => {
      Logger.info("Connected to MongoDB Database...🔥");
      server.listen(port, () => {
        Logger.info(`Connected to Server on http://localhost:${port} ...🚀`);
      });
      initializeWebSocket(server);
    }).catch((err) => {
      Logger.error("Unable to connect to MongoDB...🥱", err);
    });
  } catch (error) {
    Logger.error("Something went wrong...🥲", error);
  }
}

if (!isNaN(port)) {
  startServer(port);
} else {
  Logger.error("Invalid port number...😴");
}
