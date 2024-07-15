import { RedisKey } from "ioredis";
import redisClient from "../middleware/radis/index.redis";
import Chat from "../models/chat.model";
import mongoose from "mongoose";
import Message from "../models/message.model";
import { addFcmJob } from "../middleware/Queues/pushQueue";
import jwt from "jsonwebtoken";

// Store the user socket id
export const storeUserSocketId = async (
  userId: string,
  socketId: string
): Promise<void> => {
  await redisClient.set(`socketId:${userId}`, socketId);
};

// Get the store user socket id
export const getUserSocketId = async (
  userId: string
): Promise<string | null> => {
  return await redisClient.get(`socketId:${userId}`);
};

// Authorize the user token
export const authorizeJWT = async (token: string) => {
  const authHeader = token;
  if (authHeader) {
    const token = authHeader;
    const decoded: any = jwt.verify(token, `${process.env.Jwt_Secret}`);
    if (decoded?.id) {
      return decoded;
    } else {
      return "Token is wrong";
    }
  } else {
    return {
      status: false,
      message: "Token missing!",
    };
  }
};

// Get all the user is online
export async function getOnlineUsers(): Promise<
  { userId: string; online: boolean }[]
> {
  return new Promise((resolve, reject) => {
    redisClient.keys("userStatus:*", (err, keys) => {
      if (err) {
        reject(err);
        return;
      }

      if (!keys || keys.length === 0) {
        resolve([]);
        return;
      }

      redisClient.mget(keys as RedisKey[], async (err, statuses: any) => {
        if (err) {
          reject(err);
          return;
        }

        // Parse and filter online users
        const onlineUsers: { userId: string; online: boolean }[] = [];

        for (let i = 0; i < statuses.length; i++) {
          const status = statuses[i];
          if (status) {
            const userId = keys[i].split(":")[1];
            const userStatus = JSON.parse(status);
            const token = await redisClient.get(`user_${userId}`);
            if (userStatus.online && token) {
              onlineUsers.push({
                userId: userId,
                online: true,
              });
            }
          }
        }

        resolve(onlineUsers);
      });
    });
  });
}

// Delete userStatus from Redis on user disconnect
export const deleteUserStatusFromRedis = async (
  userId: string,
  socket_id?: any
) => {
  try {
    if (socket_id) {
      await redisClient.set(
        `userStatus:${userId}`,
        JSON.stringify({ currentChat: null, online: false })
      );
    }
    await redisClient.del(`userStatus:${userId}`);
    await redisClient.del(`socketUserMap:${socket_id}`);
  } catch (error) {
    console.error("Error deleting userStatus from Redis:", error);
  }
};

// Get latest messages function
export const getLatestmessages = async (
  conversation_id: string,
  user_id: string
) => {
  const chat = await Chat.findOne({
    _id: conversation_id,
    "IsChatDeleted.userId": new mongoose.Types.ObjectId(user_id),
  });
  let deletedAt = null;
  if (chat) {
    const deletionRecord = chat.IsChatDeleted.find((deletion: any) =>
      deletion.userId.equals(user_id)
    );
    if (deletionRecord) {
      deletedAt = deletionRecord.deletedAt;
    }
  }
  const query: any = {
    conversation_id: conversation_id,
  };
  if (deletedAt) {
    query["timestamp"] = { $gt: deletedAt };
  }
  const messages = await Message.find(query).sort({ timestamp: -1 });

  return messages;
};

// Updating the message status
export const updateMessageStatus = async (
  receiverId: string,
  newStatus: string,
  chatId: mongoose.Types.ObjectId
) => {
  try {
    // Convert receiverId to ObjectId
    const receiverObjectId = new mongoose.Types.ObjectId(receiverId);

    // // Log the details for debugging
    // console.log("Updating message status", {
    //   receiverId,
    //   newStatus,
    //   chatId,
    // });

    // Find messages to update and log them
    const messagesToUpdate = await Message.find({
      receiver_id: receiverObjectId,
      message_state: { $in: ["sent", "delivered"] },
      conversationId: chatId,
    });

    // console.log("Messages to update:", messagesToUpdate);

    // Update message status
    const result = await Message.updateMany(
      {
        receiver_id: receiverObjectId,
        message_state: { $in: ["sent", "delivered"] },
        conversationId: chatId,
      },
      { $set: { message_state: newStatus } }
    );

    // Log the result for debugging
    // console.log("Update result:", result);

    // Return whether any documents were modified
    return result.modifiedCount > 0;
  } catch (error) {
    console.error("Error updating message status:", error);
    throw error;
  }
};

// Get the previous user message
export async function fetchPreviousMessages(
  conversationId: string,
  lastMessageId: string
) {
  try {
    const messages = await Message.find({
      conversationId: conversationId,
      _id: { $lt: lastMessageId },
    })
      .sort({ _id: -1 })
      .limit(20);

    return messages;
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    throw error;
  }
}

// Sending the lated message notification to user
export const sendLatednumberMessage = async (
  conversation_id: string,
  user_fcm: string,
  user_name: string | undefined,
  message: string | undefined,
  sender_id: string,
  title: string,
  type?: string
) => {
  const userchatAndMessage: any = await Chat.findById(conversation_id).lean(
    true
  );
  userchatAndMessage.user_name = user_name;
  userchatAndMessage.sender_id = sender_id;

  let notificationData = {
    title: title ? title : "New Message",
    body:
      message && message?.length >= 75
        ? message?.slice(0, 75) + "..."
        : message && message?.length < 75
        ? message
        : "New Message",
    userFcmToken: user_fcm,
    data: {
      type: type,
      message_details: JSON.stringify(userchatAndMessage),
    },
  };
  addFcmJob(notificationData).then(() => {});
};
