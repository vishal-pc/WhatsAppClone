import http from "http";
import socket from "socket.io";
import Logger from "../utils/logger";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import redisClient from "../helper/radis/index.redis";
import dotenv from "dotenv";
import Message from "../models/message.model";
import Chat from "../models/chat.model";
import UserFCM from "../models/userfcm.model";
import { updateUserDataInDatabase } from "../controller/user.controller";
dotenv.config();

export const storeUserSocketId = async (
  userId: string,
  socketId: string
): Promise<void> => {
  await redisClient.set(`socketId:${userId}`, socketId);
};
export const getUserSocketId = async (
  userId: string
): Promise<string | null> => {
  return await redisClient.get(`socketId:${userId}`);
};
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
let io: any;
export function initializeWebSocket(server: http.Server) {
  io = new socket.Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });
  io.on("connection", async (socket: any) => {
    const token = socket?.handshake?.query?.token;
    try {
      const user = await authorizeJWT(token);
      if (user?.id) {
        await (user?.id, socket.id);
        const userId = new mongoose.Types.ObjectId(user?.id);
        await Chat.aggregate([
          {
            $match: {
              participants: {
                $elemMatch: {
                  $eq: userId,
                },
              },
            },
          },
        ]);
        storeUserSocketId(user?.id, socket.id);
        await redisClient.set(
          `userStatus:${user?.id}`,
          JSON.stringify({ currentChat: null, online: true })
        );
        await redisClient.set(`socketUserMap:${socket.id}`, user?.id);
        await sendOnlineEvent(user?.id);
      }
    } catch (error) {
      socket.disconnect(true);
    }
    socket.emit("connected", {
      test: "hi socket is connected",
    });

    socket.on(
      "onlineStatus",
      async (data: { token: string; online_status: Boolean }) => {
        const user = await authorizeJWT(data.token);
        if (user) {
          const user_id = user?.id;
          const Onlinestatus = data?.online_status;
          const upUserLoc = await updateUserDataInDatabase(user_id, {
            isOnline: Onlinestatus,
          });
        } else {
          Logger.error("Unauthorized Access");
        }
      }
    );

    socket.on(
      "joinRoom",
      async (data: {
        targetUserId: string;
        token: string;
        isNotification?: boolean;
      }) => {
        try {
          const user = await authorizeJWT(data?.token);
          if (user) {
            const new_user_id = new mongoose.Types.ObjectId(user?.id);
            const other_user_id = new mongoose.Types.ObjectId(
              data?.targetUserId
            );
            const participants = [new_user_id, other_user_id].sort();
            const existingChat = await Chat.findOne({ participants });
            let chatId: any;
            if (!existingChat) {
              const newChat = new Chat({
                participants,
              });
              const savedChat = await newChat.save();
              chatId = savedChat?._id;
            } else {
              chatId = existingChat?._id;
            }
            const roomName = `chat-${chatId}`;
            socket.join(roomName);
            io.to(roomName).emit("chatJoined", {
              message: "Please Save this chat id if you want!",
              conversation_id: chatId,
              target_user_id: data?.targetUserId,
              isSuggestionActive: existingChat?.isSuggestionActive,
            });
            if (data?.isNotification) {
              const messages = await getLatestmessages(chatId, 20, user?.id);
              socket.emit("previousMsg", {
                messages: messages,
                conversation_id: chatId,
              });
            }
            await redisClient.set(`socketUserMap:${socket.id}`, user?.id);
            await redisClient.set(
              `userStatus:${user?.id}`,
              JSON.stringify({ currentChat: chatId, online: true })
            );
            if (existingChat?.isSuggestionActive) {
            }
            const update_all_messages = await updateMessageStatus(
              user?.id,
              "seen",
              chatId
            );
            if (update_all_messages) {
              const user_socket_id = await getUserSocketId(data?.targetUserId);
              if (user_socket_id) {
                io.to(user_socket_id).emit("allMessageSee", {
                  conversation_id: chatId,
                  other_user_id: data?.targetUserId,
                });
              }
            }
          } else {
            Logger.error("Unauthorized access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on("leaveChat", async (data: { userId: string; chatId: string }) => {
      redisClient.set(
        `userStatus:${data?.userId}`,
        JSON.stringify({ currentChat: null, online: true })
      );
      socket.leave(data?.chatId);
      await redisClient.del(`socketUserMap:${socket.id}`);
    });

    socket.on(
      "blockUser",
      async (data: {
        otherUserId: string;
        conversation_id: string;
        user_id: string;
      }) => {
        if (data?.conversation_id) {
          const Other_user_scoket_id = await getUserSocketId(data.otherUserId);
          socket.to(Other_user_scoket_id).emit("GotBlocked", {
            conversation_id: data.conversation_id,
            user_id: data.user_id,
          });
        }
      }
    );

    socket.on(
      "UnblockUser",
      async (data: {
        otherUserId: string;
        conversation_id: string;
        user_id: string;
      }) => {
        if (data?.conversation_id) {
          const Other_user_scoket_id = await getUserSocketId(data.otherUserId);
          socket.to(Other_user_scoket_id).emit("GotUnBlocked", {
            conversation_id: data.conversation_id,
            user_id: data.user_id,
          });
        }
      }
    );

    socket.on(
      "sendPrivateMessage",
      async (data: {
        token: string;
        sender_id: string;
        receiver_id: string;
        message: string;
        conversation_id: string;
        isFirstMsg: boolean;
        message_type?: string;
        mediaUrl?: boolean;
        isReply?: boolean;
        message_id?: boolean;
        isQuestion?: boolean;
        nextQuestion?: string;
        currentQuestionId?: string;
        user_name: string;
        toWhichReplied?: {
          message_type?: string;
          message?: string;
          messageOwner?: string;
        };
        changeSuggessionStatus?: boolean;
      }) => {
        try {
          if (data?.sender_id && data?.receiver_id) {
            const new_user_id = new mongoose.Types.ObjectId(data?.sender_id);
            const ChatId = new mongoose.Types.ObjectId(data.conversation_id);
            const user_socket_id = await getUserSocketId(data?.receiver_id);
            const receiver_Object_id = new mongoose.Types.ObjectId(
              data?.receiver_id
            );
            const recipientStatus = await redisClient.get(
              `userStatus:${data?.receiver_id}`
            );

            // Create the message data
            const messageData = {
              sender_id: new_user_id,
              receiver_id: receiver_Object_id,
              message: data?.message,
              conversation_id: ChatId,
              message_type: data?.message_type,
              mediaUrl: data?.mediaUrl,
              isReply: data?.isReply || false,
              message_id: data?.message_id,
              message_state: "",
              toWhichReplied: data?.toWhichReplied?.message
                ? {
                    message_type: data?.toWhichReplied?.message_type,
                    message: data?.toWhichReplied?.message,
                    messageOwner: data?.toWhichReplied?.messageOwner
                      ? new mongoose.Types.ObjectId(
                          data?.toWhichReplied?.messageOwner
                        )
                      : null,
                  }
                : {},
              reaction: [
                { user_id: new_user_id },
                { user_id: receiver_Object_id },
              ],
            };

            // Determine message state based on recipient status
            if (recipientStatus) {
              const recipientStatusData = JSON.parse(recipientStatus);
              if (
                recipientStatusData.currentChat != data.conversation_id &&
                recipientStatusData.online
              ) {
                messageData.message_state = "delivered";
              } else if (recipientStatusData.online) {
                messageData.message_state = "seen";
              } else {
                messageData.message_state = "sent";
              }
            } else {
              messageData.message_state = "sent";
            }

            // Save the message to the database
            const newMessage = new Message(messageData);
            const savedMessage = await newMessage.save();

            // Emit the message to the room
            const roomName = `chat-${data.conversation_id}`;
            io.to(roomName).emit("GetPrivateMessage", {
              ...messageData,
              timestamp: savedMessage?.timestamp,
              _id: savedMessage?._id,
            });

            // Emit newUserMsg if it is the first message
            if (data?.isFirstMsg && data?.receiver_id) {
              io.to(user_socket_id).emit("newUserMsg");
            }

            // Send FCM notification if receiver has a token
            const receiverDetails = await UserFCM.findOne({
              user_id: data?.receiver_id,
            });
            if (receiverDetails?.fcm_token) {
              await sendLatednumberMessage(
                data.conversation_id,
                20,
                receiverDetails?.fcm_token,
                data?.user_name,
                data?.message,
                data.sender_id,
                data?.user_name,
                "chat"
              );
            }

            // Update chat if it is the first message
            if (data?.isFirstMsg && data?.receiver_id) {
              await Chat.findOneAndUpdate(
                { _id: ChatId },
                { initiator: data.sender_id, responder: data.receiver_id }
              );
              io.to(user_socket_id).emit("newUserMsg");
            }

            // Update suggestion status if needed
            if (data?.changeSuggessionStatus) {
              await Chat.updateOne(
                { _id: ChatId },
                { isSuggestionActive: false }
              );
            }
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on(
      "readAllMessages",
      async (data: { token: string; conversation_id: string }) => {
        try {
          const user = await authorizeJWT(data?.token);
          if (user) {
            const userId = user?.id;
            const roomName = `chat-${data?.conversation_id}`;
            io.to(roomName).emit("messageRead", {
              userId: userId,
              conversation_id: data.conversation_id,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on(
      "startTyping",
      async (data: { token: string; conversation_id: string }) => {
        try {
          const user = await authorizeJWT(data.token);
          if (user) {
            const userId = user.id;
            const roomName = `chat-${data.conversation_id}`;
            io.to(roomName).emit("typingStart", {
              userId: userId,
              conversation_id: data.conversation_id,
              typing: true,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on(
      "stopTyping",
      async (data: { token: string; conversation_id: string }) => {
        try {
          const user = await authorizeJWT(data.token);
          if (user) {
            const userId = user.id;
            const roomName = `chat-${data.conversation_id}`;
            io.to(roomName).emit("typingStop", {
              userId: userId,
              conversation_id: data.conversation_id,
              typing: true,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on("disconnect", async () => {
      const userId = await redisClient.get(`socketUserMap:${socket?.id}`);
      if (userId) {
        await redisClient.set(
          `userStatus:${userId}`,
          JSON.stringify({ currentChat: null, online: false })
        );
        await redisClient.del(`socketUserMap:${socket.id}`);
        await sendOfflineEvent(userId, socket.id);
      }
    });
  });
}

const getLatestmessages = async (
  conversation_id: string,
  limit: number,
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
  const messages = await Message.find(query)
    .limit(limit)
    .sort({ timestamp: -1 });

  return messages;
};

const updateMessageStatus = async (
  receiverId: string,
  newStatus: string,
  chatId: string
) => {
  try {
    const receiver_id = new mongoose.Types.ObjectId(receiverId);
    const chatIdNew = new mongoose.Types.ObjectId(chatId);
    const result = await Message.updateMany(
      {
        receiver_id: receiver_id,
        message_state: { $in: ["sent", "delivered"] },
        conversationId: chatIdNew,
      },
      { $set: { message_state: newStatus } }
    );
    return true;
  } catch (error) {
    console.error("Error updating message status:", error);
  }
};

const sendLatednumberMessage = async (
  conversation_id: string,
  limit: number,
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
};

const sendOnlineEvent: any = async (userId: string) => {
  try {
    const userMongooseId = new mongoose.Types.ObjectId(userId);
    const chats: any = await Chat.find({
      participants: { $in: [userMongooseId] },
    });
    if (chats.length) {
      chats?.map(async (chatObj: any) => {
        const receiver_id = chatObj?.participants?.filter(
          (ele: any) => ele != userId
        )?.[0] as string;
        const otherParticipantSocketId = await getUserSocketId(receiver_id);
        io.to(otherParticipantSocketId).emit("userOnline", {
          chatId: chatObj._id,
        });
      });
    }
    const upUserLoc = await updateUserDataInDatabase(userMongooseId, {
      isOnline: true,
    });
  } catch (err) {
    return "Error to send user is online";
  }
};

export const sendOfflineEvent: any = async (
  userId: string,
  socket_id?: string
) => {
  try {
    const userMongooseId = new mongoose.Types.ObjectId(userId);
    const chats: any = await Chat.find({
      participants: { $in: [userMongooseId] },
    });
    if (chats.length) {
      chats?.map(async (chatObj: any) => {
        const receiver_id = chatObj?.participants?.filter(
          (ele: any) => ele != userId
        )?.[0] as string;
        const otherParticipantSocketId = await getUserSocketId(receiver_id);
        io.to(otherParticipantSocketId).emit("userOffline", {
          chatId: chatObj._id,
        });
      });
    }
    if (socket_id) {
      await redisClient.set(
        `userStatus:${userId}`,
        JSON.stringify({ currentChat: null, online: false })
      );
      await redisClient.del(`socketUserMap:${socket_id}`);
    }
    const upUserLoc = await updateUserDataInDatabase(userMongooseId, {
      isOnline: false,
    });
  } catch (err) {
    return "Error to send user is offline";
  }
};
