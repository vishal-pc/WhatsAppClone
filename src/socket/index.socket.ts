import http from "http";
import socket from "socket.io";
import Logger from "../utils/logger";
import mongoose from "mongoose";
import redisClient from "../middleware/radis/index.redis";
import Message from "../models/message.model";
import Chat from "../models/chat.model";
import { updateUserDataInDatabase } from "../controller/user.controller";
import UserFCM from "../models/userfcm.model";
import {
  authorizeJWT,
  deleteUserStatusFromRedis,
  fetchPreviousMessages,
  getLatestmessages,
  getOnlineUsers,
  getUserSocketId,
  sendLatednumberMessage,
  storeUserSocketId,
  updateMessageStatus,
} from "../helper/socket.helper";
import dotenv from "dotenv";

dotenv.config();

let io: any;

// ---------------------------- Socket connection is start ----------------------------

export const initializeWebSocket = (server: http.Server) => {
  io = new socket.Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Socket connection
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
        // Notify all clients that a new user has connected
        io.emit("userConnected", {
          userId: user?.id,
          socketId: socket.id,
        });

        // Send list of currently online users to the newly connected user
        const onlineUsers = await getOnlineUsers();
        socket.emit("currentOnlineUsers", onlineUsers);
      }
    } catch (error) {
      socket.disconnect(true);
    }

    // Socket is connected
    socket.emit("connected", {
      test: "hi socket is connected",
    });

    //Check user is online
    socket.on(
      "onlineStatus",
      async (data: {
        token: string;
        chatId: string;
        senderId: string;
        receiverId: string;
        online_status: Boolean;
      }) => {
        const user = await authorizeJWT(data.token);
        if (user) {
          const user_id = user?.id;
          const Onlinestatus = data?.online_status;
          const upUserLoc = await updateUserDataInDatabase(user_id, {
            isOnline: Onlinestatus,
          });
          return upUserLoc;
        } else {
          Logger.error("Unauthorized Access");
        }
      }
    );

    // Join the room with user
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
            console.log(`User ${data.targetUserId} joining room ${roomName}`);

            // Confirm user is joined the chat with user
            io.to(roomName).emit("chatJoined", {
              message: "Please Save this chat id if you want!",
              conversation_id: chatId,
              target_user_id: data?.targetUserId,
              isSuggestionActive: existingChat?.isSuggestionActive,
            });
            if (data?.isNotification) {
              const messages = await getLatestmessages(chatId, user?.id);

              // Seen the previous room messages
              socket.emit("previousMsg", {
                messages: messages,
                conversation_id: chatId,
              });
              // Update message status to 'seen'
              await updateMessageStatus(user?.id, "seen", chatId);
            }

            await redisClient.set(`socketUserMap:${socket.id}`, user?.id);
            await redisClient.set(
              `userStatus:${user?.id}`,
              JSON.stringify({ currentChat: chatId, online: true })
            );

            if (existingChat?.isSuggestionActive) {
              const update_all_messages = await updateMessageStatus(
                user?.id,
                "seen",
                chatId
              );
              if (update_all_messages) {
                const user_socket_id = await getUserSocketId(
                  data?.targetUserId
                );
                if (user_socket_id) {
                  // See the user all messages in a room
                  io.to(user_socket_id).emit("allMessageSee", {
                    conversation_id: chatId,
                    other_user_id: data?.targetUserId,
                  });
                }
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

    // Left the chat event
    socket.on("leaveChat", async (data: { userId: string; chatId: string }) => {
      redisClient.set(
        `userStatus:${data?.userId}`,
        JSON.stringify({ currentChat: null, online: true })
      );
      socket.leave(data?.chatId);
      await redisClient.del(`socketUserMap:${socket.id}`);
    });

    // Block the user
    socket.on(
      "blockUser",
      async (data: {
        otherUserId: string;
        conversation_id: string;
        user_id: string;
      }) => {
        if (data?.conversation_id) {
          const Other_user_scoket_id = await getUserSocketId(data.otherUserId);

          // Confirm the user is blocked
          socket.to(Other_user_scoket_id).emit("GotBlocked", {
            conversation_id: data.conversation_id,
            user_id: data.user_id,
          });
        }
      }
    );

    // Unblock the user
    socket.on(
      "UnblockUser",
      async (data: {
        otherUserId: string;
        conversation_id: string;
        user_id: string;
      }) => {
        if (data?.conversation_id) {
          const Other_user_scoket_id = await getUserSocketId(data.otherUserId);

          // Confirm the user is unblocked
          socket.to(Other_user_scoket_id).emit("GotUnBlocked", {
            conversation_id: data.conversation_id,
            user_id: data.user_id,
          });
        }
      }
    );

    // Sending the private message to user in a joined room
    socket.on(
      "sendPrivateMessage",
      async (data: {
        token: string;
        sender_id: string;
        receiver_id: string;
        message: string;
        conversation_id: string;
        isFirstMsg: boolean;
        isReply?: boolean;
        message_id?: boolean;
        user_name: string;
        toWhichReplied?: {
          message?: string;
          messageOwner?: string;
        };
        changeSuggessionStatus?: boolean;
      }) => {
        try {
          if (data?.sender_id && data?.receiver_id) {
            const new_user_id = new mongoose.Types.ObjectId(data?.sender_id);
            const ChatId = new mongoose.Types.ObjectId(data.conversation_id);
            const user_scoket_id = await getUserSocketId(data?.receiver_id);
            const receiver_Object_id = new mongoose.Types.ObjectId(
              data?.receiver_id
            );
            const recipientStatus: any = await redisClient.get(
              `userStatus:${data?.receiver_id}`
            );

            if (recipientStatus) {
              const recipientStatusData = JSON.parse(recipientStatus);
              // If user is online and is not on the user chat screen i.e he is in the app
              if (
                recipientStatusData.currentChat != data.conversation_id &&
                recipientStatusData.online
              ) {
                const newMessage = new Message({
                  sender_id: new_user_id,
                  receiver_id: receiver_Object_id,
                  message: data?.message,
                  conversation_id: data?.conversation_id,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  message_state: "delivered",
                  toWhichReplied: data?.toWhichReplied?.message
                    ? {
                        message: data?.toWhichReplied?.message,
                        messageOwner: data?.toWhichReplied?.messageOwner
                          ? new mongoose.Types.ObjectId(
                              data?.toWhichReplied?.messageOwner
                            )
                          : "",
                      }
                    : {},
                  reaction: [
                    { user_id: new_user_id },
                    { user_id: data?.receiver_id },
                  ],
                });
                const savedMessage = await newMessage.save();
                const roomName = `chat-${data.conversation_id}`;
                io.to(roomName).emit("GetPrivateMessage", {
                  sender_id: data?.sender_id,
                  receiver_id: data?.receiver_id,
                  message: data?.message,
                  timestamp: savedMessage?.timestamp,
                  _id: savedMessage?._id,
                  conversation_id: data?.conversation_id,
                  reaction: savedMessage?.reaction,
                  message_state: "delivered",
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied
                    ? data?.toWhichReplied
                    : false,
                  changeSuggessionStatus: data?.changeSuggessionStatus,
                });
                if (data?.isFirstMsg && data?.receiver_id) {
                  io.to(user_scoket_id).emit("NewUserMsg");
                }
                const recieverDetails: any = await UserFCM.findOne({
                  user_id: data?.receiver_id,
                });
                if (recieverDetails?.fcm_token) {
                  let userchatAndMessage: any = await sendLatednumberMessage(
                    data.conversation_id,
                    recieverDetails?.fcm_token,
                    data?.user_name,
                    data?.message,
                    data.sender_id,
                    data?.user_name,
                    "chat"
                  );
                  return userchatAndMessage;
                } else {
                  console.error("user FCM not registered");
                }
              }
              // If user is online and is on the user chat screen
              else if (recipientStatusData.online) {
                const newMessage = new Message({
                  sender_id: new_user_id,
                  receiver_id: receiver_Object_id,
                  message: data?.message,
                  conversation_id: data?.conversation_id,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  message_state: "seen",
                  toWhichReplied: data?.toWhichReplied?.message
                    ? {
                        message: data?.toWhichReplied?.message,
                        messageOwner: data?.toWhichReplied?.messageOwner
                          ? new mongoose.Types.ObjectId(
                              data?.toWhichReplied?.messageOwner
                            )
                          : "",
                      }
                    : {},
                  reaction: [
                    { user_id: new_user_id },
                    { user_id: data?.receiver_id },
                  ],
                });
                const savedMessage = await newMessage.save();
                const roomName = `chat-${data.conversation_id}`;
                io.to(roomName).emit("GetPrivateMessage", {
                  sender_id: data?.sender_id,
                  receiver_id: data?.receiver_id,
                  message: data?.message,
                  timestamp: savedMessage?.timestamp,
                  _id: savedMessage?._id,
                  conversation_id: data?.conversation_id,
                  reaction: savedMessage?.reaction,
                  message_state: "seen",
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied
                    ? data?.toWhichReplied
                    : false,
                  changeSuggessionStatus: data?.changeSuggessionStatus,
                });
              }
              // If user is offline and is not in the app
              else {
                const newMessage = new Message({
                  sender_id: new_user_id,
                  receiver_id: receiver_Object_id,
                  message: data?.message,
                  conversation_id: data?.conversation_id,
                  message_state: "sent",
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied?.message
                    ? {
                        message: data?.toWhichReplied?.message,
                        messageOwner: data?.toWhichReplied?.messageOwner
                          ? new mongoose.Types.ObjectId(
                              data?.toWhichReplied?.messageOwner
                            )
                          : "",
                      }
                    : {},
                  reaction: [
                    { user_id: new_user_id },
                    { user_id: data?.receiver_id },
                  ],
                });
                const savedMessage = await newMessage.save();
                const roomName = `chat-${data.conversation_id}`;
                io.to(roomName).emit("GetPrivateMessage", {
                  sender_id: data?.sender_id,
                  receiver_id: data?.receiver_id,
                  message: data?.message,
                  timestamp: savedMessage?.timestamp,
                  _id: savedMessage?._id,
                  conversation_id: data?.conversation_id,
                  message_state: "sent",
                  reaction: savedMessage?.reaction,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied
                    ? data?.toWhichReplied
                    : false,
                  changeSuggessionStatus: data?.changeSuggessionStatus,
                });
                if (data?.isFirstMsg && data?.receiver_id) {
                  const user_scoket_id = await getUserSocketId(
                    data?.receiver_id
                  );
                  io.to(user_scoket_id).emit("NewUserMsg");
                }

                const recieverDetails: any = await UserFCM.findOne({
                  user_id: data?.receiver_id,
                });
                if (recieverDetails?.fcm_token) {
                  let userchatAndMessage: any = await sendLatednumberMessage(
                    data.conversation_id,
                    recieverDetails?.fcm_token,
                    data?.user_name,
                    data?.message,
                    data.sender_id,
                    data?.user_name,
                    "chat"
                  );
                  return userchatAndMessage;
                } else {
                  console.error("user FCM not registered");
                }
              }
            } else {
              /**
               * In any other case when we do not have user status then we consider him as offline
               * and app is closed for that case just send notification to the user
               */
              const newMessage = new Message({
                sender_id: new_user_id,
                receiver_id: receiver_Object_id,
                message: data?.message,
                conversation_id: data?.conversation_id,
                message_state: "sent",
                isReply: data?.isReply ? data?.isReply : false,
                message_id: data?.message_id,
                toWhichReplied: data?.toWhichReplied?.message
                  ? {
                      message: data?.toWhichReplied?.message,
                      messageOwner: data?.toWhichReplied?.messageOwner
                        ? new mongoose.Types.ObjectId(
                            data?.toWhichReplied?.messageOwner
                          )
                        : "",
                    }
                  : {},
                reaction: [
                  { user_id: new_user_id },
                  { user_id: data?.receiver_id },
                ],
              });
              const savedMessage = await newMessage.save();
              const roomName = `chat-${data.conversation_id}`;
              io.to(roomName).emit("GetPrivateMessage", {
                sender_id: data?.sender_id,
                receiver_id: data?.receiver_id,
                message: data?.message,
                timestamp: savedMessage?.timestamp,
                _id: savedMessage?._id,
                conversation_id: data?.conversation_id,
                message_state: "sent",
                reaction: savedMessage?.reaction,
                isReply: data?.isReply ? data?.isReply : false,
                message_id: data?.message_id,
                toWhichReplied: data?.toWhichReplied
                  ? data?.toWhichReplied
                  : false,
                changeSuggessionStatus: data?.changeSuggessionStatus,
              });
              const recieverDetails: any = await UserFCM.findOne({
                user_id: data?.receiver_id,
              });
              if (recieverDetails?.fcm_token) {
                let userchatAndMessage: any = await sendLatednumberMessage(
                  data.conversation_id,
                  recieverDetails?.fcm_token,
                  data?.user_name,
                  data?.message,
                  data.sender_id,
                  data?.user_name,
                  "chat"
                );
                console.log(
                  "notification send to user",
                  sendLatednumberMessage
                );
              } else {
                console.log("user FCM not registered");
                console.error("user FCM not registered");
              }
            }
            if (data?.isFirstMsg && data?.receiver_id) {
              const updatechat = await Chat.findOneAndUpdate(
                {
                  _id: new mongoose.Types.ObjectId(data.conversation_id),
                },
                {
                  initiator: data.sender_id,
                  responder: data.receiver_id,
                }
              );
              const user_scoket_id = await getUserSocketId(data?.receiver_id);
              io.to(user_scoket_id).emit("NewUserMsg");
            }
            if (data?.changeSuggessionStatus) {
              const update = await Chat.updateOne(
                {
                  _id: ChatId,
                },
                {
                  isSuggestionActive: false,
                }
              );
              return update;
            }
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    // Get user previous all message in a room
    socket.on(
      "getPreviousMessages",
      async (data: { last_message_id: string; conversation_id: string }) => {
        try {
          const messages = await fetchPreviousMessages(
            data?.conversation_id,
            data?.last_message_id
          );
          if (messages) {
            // Emit a typing event to the room
            socket.emit("recievePreviousMessages", {
              conversation_id: data.conversation_id,
              messages,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    // Checking user is typing the message in a room
    socket.on(
      "startTyping",
      async (data: { token: string; conversation_id: string }) => {
        try {
          const user = await authorizeJWT(data.token);
          if (user) {
            const userId = user.id;
            const roomName = `chat-${data.conversation_id}`;

            // Emit and confirm the user is start the typing
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

    // Checking user is stop typing the message in a room
    socket.on(
      "stopTyping",
      async (data: { token: string; conversation_id: string }) => {
        try {
          const user = await authorizeJWT(data.token);
          if (user) {
            const userId = user.id;
            const roomName = `chat-${data.conversation_id}`;

            // Emit and confirm the user is stop the typing
            io.to(roomName).emit("typingStop", {
              userId: userId,
              conversation_id: data.conversation_id,
              typing: false,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    // Update message
    socket.on("updateMessage", async (data: any) => {
      try {
        const { messageId, newMessage, sender_id } = data;
        if (!messageId || !newMessage || !sender_id) {
          return socket.emit("error", { message: "Invalid input" });
        }
        const message = await Message.findOne({
          _id: messageId,
          $or: [{ sender_id: sender_id }],
        });

        if (!message) {
          return socket.emit("error", {
            message: "Message not found or unauthorized",
          });
        }
        message.message = newMessage;
        const updatedMessage = await message.save();

        const roomName = `chat-${message.conversation_id}`;
        io.to(roomName).emit("messageUpdated", {
          messageId: updatedMessage._id,
          newMessage: updatedMessage.message,
          conversationId: updatedMessage.conversation_id,
        });
      } catch (error) {
        console.error("Error updating message:", error);
        socket.emit("error", { message: "Error updating message" });
      }
    });

    // Delete user message
    socket.on("deleteMessages", async (data: any) => {
      try {
        const { messageIds, conversationId, sender_id } = data;

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return socket.emit("error", {
            message: "No messages selected for deletion",
          });
        }

        const messages = await Message.find({
          _id: { $in: messageIds },
          $or: [{ sender_id: sender_id }],
        });

        if (messages.length !== messageIds.length) {
          return socket.emit("error", {
            message: "Some messages not found or unauthorized",
          });
        }

        await Message.deleteMany({ _id: { $in: messageIds } });

        const roomName = `chat-${conversationId}`;
        io.to(roomName).emit("messagesDeleted", { messageIds, conversationId });
      } catch (error) {
        console.error("Error deleting messages:", error);
        socket.emit("error", { message: "Error deleting messages" });
      }
    });

    // Socket connection is disconnected
    socket.on("disconnect", async () => {
      const userId = await redisClient.get(`socketUserMap:${socket?.id}`);
      if (userId) {
        await redisClient.set(
          `userStatus:${userId}`,
          JSON.stringify({ currentChat: null, online: false })
        );
        await deleteUserStatusFromRedis(userId);
        io.emit("userDisconnected", userId);
      }
    });
  });
};

export { io };
// ---------------------------- Socket connection is end ----------------------------
