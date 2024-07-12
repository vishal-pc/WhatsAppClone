import Bull from "bull";
import { createBullRedisClient } from "../radis/bullRedis";

interface FcmJobData {
  title: string;
  body: string;
  userFcmToken: string;
  data?: any;
}

const fcmQueue = new Bull<FcmJobData>("fcmQueue", {
  createClient: createBullRedisClient,
});

fcmQueue.on("completed", (job, result) => {
  console.log(`Notification job ${job.id} completed`);
});

fcmQueue.on("failed", (job, err) => {
  console.error(`Notification job ${job.id} failed: ${err.message}`);
});

export const addFcmJob = async (data: FcmJobData) => {
  await fcmQueue.add(data);
};

export default fcmQueue;
