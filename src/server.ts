import express from "express";
import http from "http";
import DbConnection from "./config/db.config";
import { initializeWebSocket } from "./socket/index.socket";
import Logger from "./utils/logger";
import { configCors } from "./config/corsConfig";
import bodyParser from "body-parser";
import figlet from "figlet";
import dotenv from "dotenv";

dotenv.config();

import userRouter from "./routes/routes";
import { ErrorMessages, SuccessMessages } from "./validation/responseMessages";

const app = express();

app.use(configCors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/api/v1", userRouter);

app.get("/", (req, res) => {
  figlet.text(
    SuccessMessages.SampelResponse,
    {
      font: "Ghost",
    },
    function (err: any, data: any) {
      if (err) {
        res.send(ErrorMessages.SomethingWentWrong);
      }
      res.send(`<pre>${data}</pre>`);
    }
  );
});

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
