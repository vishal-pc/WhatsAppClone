import Redis from "ioredis";
import Logger from "../../utils/logger";
import dotenv from "dotenv";

dotenv.config();

const redisPort = parseInt(process.env.Redis_Port as string, 10);
const redisHost = process.env.Redis_Host || "localhost";

// Configure Redis client
const redisClient = new Redis({
  host: redisHost,
  port: redisPort,
  password: "", // Redis password, if set
});

// Handle connection error
redisClient.on("error", (err: any) => {
  Logger.error("Unabel to connect redis server...😮‍💨", err);
});

redisClient.on("connect", () => {
  Logger.info("Connected to redis server...🛸");
});

export default redisClient;
