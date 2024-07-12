import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const bullRedisOptions = {
  host: process.env.Redis_Host || "localhost",
  port: Number(process.env.Redis_Port) || 6379,
  password: process.env.REDIS_Pass || "",
  // Adjust these options for Bull compatibility
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

const createBullRedisClient = (type: "client" | "subscriber" | "bclient") => {
  return new Redis(bullRedisOptions);
};
export { createBullRedisClient };
