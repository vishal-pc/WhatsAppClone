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
      return null;
    }
  } else {
    return {
      status: false,
      message: "Token missing!",
    };
  }
};

let io: any;
const roomData: Record<string, { lat: number; lon: number }> = {};
export function initializeWebSocket(server: http.Server) {
  io = new socket.Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", async (socket: any) => {
    //   "------------------------------socket getting connected--------------------------------------"
    const token = socket?.handshake?.query?.token;
    // console.log("tokentoken", token);
    try {
      const user = await authorizeJWT(token);
      if (user?.id) {
        // console.log("user?.id", user?.id);
        await (user?.id, socket.id);
        const userId = new mongoose.Types.ObjectId(user?.id);
        const blockedUserIds = (
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
          ])
        )?.map((block) => {
          const roomName = `chat-${block._id}`;
          socket.join(roomName);
        });
        storeUserSocketId(user?.id, socket.id);
        await redisClient.set(
          `userStatus:${user?.id}`,
          JSON.stringify({ currentChat: null, online: true })
        );
        await redisClient.set(`socketUserMap:${socket.id}`, user?.id);
        await sendOnlineEvent(user?.id);
      }
    } catch (error) {
      // console.log("Invalid token:", error);
      socket.disconnect(true);
    }
    socket.emit("connected", {
      test: "hello",
    });

    socket.on("consoleallrooms", async () => {
      // logRoomsAndClients()
    });
    socket.on(
      "onlineStatus",
      async (data: { token: string; online_status: Boolean }) => {
        const user = await authorizeJWT(data.token);
        // console.log("datadata", data);
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
      "joinChat",
      async (data: {
        targetUserId: string;
        token: string;
        isNotification?: boolean;
      }) => {
        try {
          // console.log("joinChat");
          // console.log("datadata", data);
          const user = await authorizeJWT(data?.token);
          if (user) {
            const new_user_id = new mongoose.Types.ObjectId(user?.id);
            const other_user_id = new mongoose.Types.ObjectId(
              data?.targetUserId
            );
            // Create or find chat room
            const participants = [new_user_id, other_user_id].sort();
            const existingChat = await Chat.findOne({ participants });
            // console.log("existingChat", existingChat);

            let chatId: any;
            if (!existingChat) {
              const newChat = new Chat({
                participants,
                requestStatus: "pending",
                // initiator: new_user_id,
                // responder: other_user_id,
              });
              const savedChat = await newChat.save();
              chatId = savedChat?._id;
            } else {
              chatId = existingChat?._id;
            }
            // Join socket room
            const roomName = `chat-${chatId}`;
            socket.join(roomName);
            // Emit a welcome message or any other necessary event
            io.to(roomName).emit("chatJoined", {
              message: "Please Save this chat id if you want!",
              conversation_id: chatId,
              target_user_id: data?.targetUserId,
              isSuggestionActive: existingChat?.isSuggestionActive,
              requestStatus: existingChat?.requestStatus
                ? existingChat?.requestStatus
                : "pending",
            });

            if (data?.isNotification) {
              const messages = await getLatestmessages(chatId, 20, user?.id);
              socket.emit("previous20", {
                messages: messages,
                conversation_id: chatId,
              });
            }
            await redisClient.set(`socketUserMap:${socket.id}`, user?.id);
            await redisClient.set(
              `userStatus:${user?.id}`,
              JSON.stringify({ currentChat: chatId, online: true })
            );
            // console.log("existingChat", existingChat);
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
                io.to(user_socket_id).emit("all_meesage_see", {
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
          // Handle error, emit an error event, or take appropriate action
        }
      }
    );

    socket.on("leaveChat", async (data: { userId: string; chatId: string }) => {
      // console.log("leaveChat");
      redisClient.set(
        `userStatus:${data?.userId}`,
        JSON.stringify({ currentChat: null, online: true })
      );
      socket.leave(data?.chatId);
      // console.log("leaveChat");
      await redisClient.del(`socketUserMap:${socket.id}`);
    });

    socket.on("leaveApp", async (data: { userId: string }) => {
      try {
        // console.log("leaveApp");
        redisClient.set(
          `userStatus:${data?.userId}`,
          JSON.stringify({ currentChat: null, online: false })
        );
        await redisClient.del(`socketUserMap:${socket.id}`);
        // console.log("leaveApp");
        if (data?.userId) {
          await sendOfflineEvent(data?.userId, socket.id);
        }
      } catch (err) {
        // console.log("leaveApperr", err);
      }
    });

    socket.on("OpenApp", async (data: { userId: string }) => {
      // console.log("OpenApp");
      redisClient.set(
        `userStatus:${data?.userId}`,
        JSON.stringify({ currentChat: null, online: true })
      );
      // console.log("OpenApp");
      UpdateAllMessageandSendStatus(data?.userId);
      await sendOnlineEvent(data?.userId);
    });

    // socket.on(
    //   "blockOtherUser",
    //   async (data: {
    //     otherUserId: string;
    //     conversation_id: string;
    //     user_id: string;
    //   }) => {
    //     if (data?.conversation_id) {
    //       const Other_user_scoket_id = await getUserSocketId(data.otherUserId);
    //       // console.log("OpenApp");
    //       socket.to(Other_user_scoket_id).emit("GotBlocked", {
    //         conversation_id: data.conversation_id,
    //         user_id: data.user_id,
    //       });
    //     }
    //   }
    // );

    // socket.on(
    //   "UnblockOtherUser",
    //   async (data: {
    //     otherUserId: string;
    //     conversation_id: string;
    //     user_id: string;
    //   }) => {
    //     if (data?.conversation_id) {
    //       const Other_user_scoket_id = await getUserSocketId(data.otherUserId);
    //       // console.log("OpenApp");
    //       socket.to(Other_user_scoket_id).emit("GotUnBlocked", {
    //         conversation_id: data.conversation_id,
    //         user_id: data.user_id,
    //         // answers: nextQuestionForSender?.currentQuestion?.answers,
    //       });
    //     }
    //   }
    // );

    // Private message to a user Starts
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
            const user_scoket_id = await getUserSocketId(data?.receiver_id);
            const receiver_Object_id = new mongoose.Types.ObjectId(
              data?.receiver_id
            );
            const recipientStatus: any = await redisClient.get(
              `userStatus:${data?.receiver_id}`
            );
            // console.log(
            //   "recipientStatus ------------------------------>>>>>>>>>>>>>>>>>>>> ",
            //   recipientStatus
            // );
            if (recipientStatus) {
              const recipientStatusData = JSON.parse(recipientStatus);
              //If user is online and is not on the user chat screen i.e he is in the app
              if (
                recipientStatusData.currentChat != data.conversation_id &&
                recipientStatusData.online
              ) {
                const newMessage = new Message({
                  sender: new_user_id,
                  receiver_id: receiver_Object_id,
                  message: data?.message,
                  conversationId: data?.conversation_id,
                  message_type: data?.message_type,
                  mediaUrl: data?.mediaUrl,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  message_state: "delivered",
                  toWhichReplied: data?.toWhichReplied?.message
                    ? {
                        message_type: data?.toWhichReplied?.message_type,
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
                  sender: data?.sender_id,
                  receiver: data?.receiver_id,
                  message: data?.message,
                  timestamp: savedMessage?.timestamp,
                  _id: savedMessage?._id,
                  conversationId: data?.conversation_id,
                  reaction: savedMessage?.reaction,
                  message_state: "delivered",
                  message_type: data?.message_type,
                  mediaUrl: data?.mediaUrl,

                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied
                    ? data?.toWhichReplied
                    : false,
                  changeSuggessionStatus: data?.changeSuggessionStatus,
                });
                // console.log("sendPrivateMessage1111111");
                if (data?.isFirstMsg && data?.receiver_id) {
                  io.to(user_scoket_id).emit("NewUserMsg");
                }

                if (
                  data.isQuestion &&
                  // data.nextQuestion &&
                  data.currentQuestionId
                ) {
                  // console.log("nextQuestionForSender", nextQuestionForSender);
                  // Update UserQuestionProgress for both sender and receiver
                }
                const recieverDetails: any = await UserFCM.findOne({
                  user_id: data?.receiver_id,
                });
                if (recieverDetails?.fcm_token) {
                  let userchatAndMessage: any = await sendLatednumberMessage(
                    data.conversation_id,
                    20,
                    recieverDetails?.fcm_token,
                    data?.user_name,
                    data?.message,
                    data.sender_id,
                    data?.user_name,
                    "chat"
                  );
                } else {
                  // console.log("user FCM not registered");
                }
              }
              //If user is online and is on the user chat screen
              else if (recipientStatusData.online) {
                // console.log("sendPrivateMessage22222222222");
                const newMessage = new Message({
                  sender: new_user_id,
                  receiver_id: receiver_Object_id,
                  message: data?.message,
                  conversationId: data?.conversation_id,
                  message_type: data?.message_type,
                  mediaUrl: data?.mediaUrl,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  message_state: "seen",
                  toWhichReplied: data?.toWhichReplied?.message
                    ? {
                        message_type: data?.toWhichReplied?.message_type,
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
                  sender: data?.sender_id,
                  receiver: data?.receiver_id,
                  message: data?.message,
                  timestamp: savedMessage?.timestamp,
                  _id: savedMessage?._id,
                  conversationId: data?.conversation_id,
                  reaction: savedMessage?.reaction,
                  message_state: "seen",
                  message_type: data?.message_type,
                  mediaUrl: data?.mediaUrl,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied
                    ? data?.toWhichReplied
                    : false,
                  changeSuggessionStatus: data?.changeSuggessionStatus,
                });
                // console.log("sendPrivateMessage333333333333");
                if (
                  data.isQuestion &&
                  // data.nextQuestion &&
                  data.currentQuestionId
                ) {
                  // Determine the next question for the sender
                  // console.log("sender_user_data", sender_user_data);
                  // console.log("receiver_user_data", receiver_user_data);
                  // Update UserQuestionProgress for both sender and receiver
                  // Emit event to sender with the next question
                }
              }
              //If user is offline and is not in the app
              else {
                const newMessage = new Message({
                  sender: new_user_id,
                  receiver_id: receiver_Object_id,
                  message: data?.message,
                  conversationId: data?.conversation_id,
                  message_type: data?.message_type,
                  mediaUrl: data?.mediaUrl,
                  message_state: "sent",
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied?.message
                    ? {
                        message_type: data?.toWhichReplied?.message_type,
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
                  sender: data?.sender_id,
                  receiver: data?.receiver_id,
                  message: data?.message,
                  timestamp: savedMessage?.timestamp,
                  _id: savedMessage?._id,
                  conversationId: data?.conversation_id,
                  message_state: "sent",
                  reaction: savedMessage?.reaction,
                  message_type: data?.message_type,
                  mediaUrl: data?.mediaUrl,
                  isReply: data?.isReply ? data?.isReply : false,
                  message_id: data?.message_id,
                  toWhichReplied: data?.toWhichReplied
                    ? data?.toWhichReplied
                    : false,
                  changeSuggessionStatus: data?.changeSuggessionStatus,
                });
                // console.log("sendPrivateMessage444444444444");
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
                    20,
                    recieverDetails?.fcm_token,
                    data?.user_name,
                    data?.message,
                    data.sender_id,
                    data?.user_name,
                    "chat"
                  );
                } else {
                  // console.log("user FCM not registered");
                }
                // console.log("sendPrivateMessage55555555555555555555");
              }
            }
            // In any other case when we do not have user status then we consider him as offline and app is closed for that case just send notification to the user
            else {
              const newMessage = new Message({
                sender: new_user_id,
                receiver_id: receiver_Object_id,
                message: data?.message,
                conversationId: data?.conversation_id,
                message_type: data?.message_type,
                mediaUrl: data?.mediaUrl,
                message_state: "sent",
                isReply: data?.isReply ? data?.isReply : false,
                message_id: data?.message_id,
                toWhichReplied: data?.toWhichReplied?.message
                  ? {
                      message_type: data?.toWhichReplied?.message_type,
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
                sender: data?.sender_id,
                receiver: data?.receiver_id,
                message: data?.message,
                timestamp: savedMessage?.timestamp,
                _id: savedMessage?._id,
                conversationId: data?.conversation_id,
                message_state: "sent",
                reaction: savedMessage?.reaction,
                message_type: data?.message_type,
                mediaUrl: data?.mediaUrl,
                isReply: data?.isReply ? data?.isReply : false,
                message_id: data?.message_id,
                toWhichReplied: data?.toWhichReplied
                  ? data?.toWhichReplied
                  : false,
                changeSuggessionStatus: data?.changeSuggessionStatus,
              });
              // console.log("sendPrivateMessage");
              const recieverDetails: any = await UserFCM.findOne({
                user_id: data?.receiver_id,
              });
              if (recieverDetails?.fcm_token) {
                let userchatAndMessage: any = await sendLatednumberMessage(
                  data.conversation_id,
                  20,
                  recieverDetails?.fcm_token,
                  data?.user_name,
                  data?.message,
                  data.sender_id,
                  data?.user_name,
                  "chat"
                );
                // SendPushToUser(
                //   data?.user_name ? data?.user_name : "New Message",
                //   data?.message && data?.message?.length >= 75
                //     ? data?.message?.slice(0, 75) + "..."
                //     : data?.message && data?.message?.length < 75
                //       ? data?.message
                //       : "New Message",
                //   recieverDetails.fcm_token
                // );
              } else {
                // console.log("user FCM not registered");
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
              // console.log(
              //   "data?.changeSuggessionStatus",
              //   data?.changeSuggessionStatus,
              //   ChatId,
              //   data.conversation_id
              // );
              const update = await Chat.updateOne(
                {
                  _id: ChatId,
                },
                {
                  isSuggestionActive: false,
                }
              );
              // console.log("update", update);
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
      "reactOnPrivateMessage",
      async (data: {
        token: string;
        message: string;
        message_id: string;
        conversation_id: string;
      }) => {
        try {
          const user = await authorizeJWT(data?.token);
          if (user) {
            const new_user_id = new mongoose.Types.ObjectId(user?.id);
            const message_id = new mongoose.Types.ObjectId(data?.message_id);

            const addReaction: any = await Message.updateOne(
              {
                _id: message_id,
                reaction: { $elemMatch: { user_id: new_user_id } },
              },
              { $set: { "reaction.$.reaction": data?.message } }
            );
            if (addReaction) {
              const roomName = `chat-${data?.conversation_id}`;
              const receiver_id = addReaction?.users?.participants.filter(
                (ele: any) => ele != user?.id
              )?.[0] as string;
              io.to(roomName).emit("sendReactOnPrivateMessage", {
                message_id: message_id,
                sender: user?.id,
                receiver: receiver_id,
                message: data.message,
                participants: addReaction?.users?.participants,
                timestamp: addReaction.timestamp,
                _id: addReaction._id,
                conversationId: data?.conversation_id,
                message_type: addReaction?.message_type,
                mediaUrl: addReaction?.mediaUrl,
                isReply: addReaction?.isReply ? addReaction?.isReply : false,
                toWhichReplied: addReaction?.toWhichReplied
                  ? addReaction?.toWhichReplied
                  : {},
              });
            }
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
        }
      }
    );
    // Private message to a user Ends

    //All message seen event start
    socket.on(
      "readAllMessages",
      async (data: { token: string; conversation_id: string }) => {
        try {
          // console.log("readAllMessages");
          const user = await authorizeJWT(data?.token);
          if (user) {
            const userId = user?.id;
            const roomName = `chat-${data?.conversation_id}`;

            // Emit a typing event to the room
            io.to(roomName).emit("AllMessagesRead", {
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
    //All message seen event ends

    //Typing event start
    socket.on(
      "startTyping",
      async (data: { token: string; conversation_id: string }) => {
        try {
          // console.log("User is typing...");
          const user = await authorizeJWT(data.token);
          if (user) {
            const userId = user.id;
            const roomName = `chat-${data.conversation_id}`;

            // Emit a typing event to the room
            io.to(roomName).emit("typing", {
              userId: userId,
              conversation_id: data.conversation_id,
              typing: true,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
          // Handle error or emit an error event as needed
        }
      }
    );
    //Typing event ends

    //Typing event start
    socket.on(
      "stopTyping",
      async (data: { token: string; conversation_id: string }) => {
        try {
          const user = await authorizeJWT(data.token);
          if (user) {
            const userId = user.id;
            const roomName = `chat-${data.conversation_id}`;
            // Emit a typing event to the room
            io.to(roomName).emit("typingstop", {
              userId: userId,
              conversation_id: data.conversation_id,
              typing: true,
            });
          } else {
            Logger.error("Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
          // Handle error or emit an error event as needed
        }
      }
    );

    //Accept Chat Socket Event Start
    socket.on(
      "acceptChat",
      async (data: {
        conversation_id: string;
        token: string;
        targetUserId: string;
        responderName: string;
      }) => {
        try {
          const user = await authorizeJWT(data?.token);
          if (user) {
            const chat = await Chat.findById(data?.conversation_id);
            if (
              chat &&
              chat?.responder &&
              chat?.responder.toString() == user?.id
            ) {
              chat.requestStatus = "accepted";
              await chat.save();
              io.to(`chat-${data.conversation_id}`).emit(
                "chatRequestAccepted",
                { conversation_id: data.conversation_id }
              );

              if ((data?.targetUserId, data?.responderName)) {
                const recieverDetails: any = await UserFCM.findOne({
                  user_id: new mongoose.Types.ObjectId(data?.targetUserId),
                });
                if (recieverDetails?.fcm_token) {
                  let userchatAndMessage: any = await sendLatednumberMessage(
                    data.conversation_id,
                    20,
                    recieverDetails?.fcm_token,
                    data?.responderName,
                    data?.responderName + " has accepted your chat request👍",
                    user?.id,
                    "Request accepted",
                    "chat"
                  );
                  // SendPushToUser(
                  //   "Request accepted",
                  //   data?.responderName + " has accepted your chat request👍",
                  //   recieverDetails.fcm_token
                  // );
                } else {
                  // console.log("user FCM not registered");
                }

                const otherParticipantSocketId = await getUserSocketId(
                  data.targetUserId
                );
                const sentTouser = io
                  .to(otherParticipantSocketId)
                  .emit("nextQuestion", {
                    conversation_id: data?.conversation_id,
                  });

                // console.log("sentTouser", sentTouser);
              } else {
                // console.log(
                //   "Data not recieved , targetUserId :",
                //   data?.targetUserId,
                //   "responderName",
                //   data?.responderName
                // );
              }
            } else {
              socket.emit("error", "Chat not found or unauthorized");
            }
          } else {
            socket.emit("error", "Unauthorized Access");
          }
          // const recipientStatus: any = await redisClient.get(
          //   `userStatus:${user?.id}`
          // );
          // console.log("userstatus", recipientStatus);

          // const recipientStatus2: any = await redisClient.get(
          //   `userStatus:${data?.targetUserId}`
          // );
          // console.log("recipientStatus4", recipientStatus2);
        } catch (error) {
          console.error(error);
          socket.emit("error", "An error occurred");
        }
      }
    );
    //Accept Chat Socket Event End

    //Reject Chat Socket Event Start
    socket.on(
      "rejectChat",
      async (data: { conversation_id: string; token: string }) => {
        try {
          const user = await authorizeJWT(data?.token);
          if (user) {
            const chat = await Chat.findById(data?.conversation_id);
            if (
              chat &&
              chat?.responder &&
              chat?.responder.toString() === user?.id
            ) {
              chat.requestStatus = "rejected";
              await chat.save();
              io.to(`chat-${data.conversation_id}`).emit(
                "chatRequestRejected",
                { conversation_id: data?.conversation_id }
              );
            } else {
              socket.emit("error", "Chat not found or unauthorized");
            }
          } else {
            socket.emit("error", "Unauthorized Access");
          }
        } catch (error) {
          console.error(error);
          socket.emit("error", "An error occurred");
        }
      }
    );

    socket.on("disconnect", async () => {
      // console.log("disconnected", socket?.id);
      const userId = await redisClient.get(`socketUserMap:${socket?.id}`);
      if (userId) {
        // Update Redis to indicate the user is no longer in the chat
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

const UpdateAllMessageandSendStatus = async (
  user_id: string,
  status?: string
) => {
  try {
    const new_user_id = new mongoose.Types.ObjectId(user_id);
    const conversations = await Message.aggregate([
      {
        $match: {
          receiver_id: new_user_id,
          message_state: "sent",
        },
      },
      {
        $group: {
          _id: "$conversationId",
          sender: { $first: "$sender" },
        },
      },
      {
        $project: {
          _id: 0,
          conversationId: "$_id",
          sender: 1,
        },
      },
    ]);
    if (conversations.length) {
      const MakemessageDelivered = await Message.updateMany(
        {
          receiver_id: new_user_id,
          message_state: { $in: ["sent"] },
        },
        { $set: { message_state: "delivered" } }
      );
      if (MakemessageDelivered) {
        conversations?.map(async (coversationObj: any) => {
          const user_scoket_id = await getUserSocketId(coversationObj.sender);
          if (user_scoket_id) {
            io.to(user_scoket_id).emit("all_meesage_delivered", {
              conversation_id: coversationObj?.conversationId,
              other_user_id: coversationObj?.sender,
            });
          }
        });
      }
    }
    return conversations;
  } catch (err) {
    // console.log("UpdateAllMessageandSendStatus", err);
  }
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
    // console.log("sendOnlineEvent Err----", err);
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
    // console.log("sendOnlineEvent Err----", err);
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

// export const SendUnblockedEvent = async (
//   conversation_id: any,
//   user_id: any,
//   otherUserId: any
// ) => {
//   // console.log("conversation_id", conversation_id);
//   const otherParticipantSocketId = await getUserSocketId(otherUserId);
//   io.to(otherParticipantSocketId).emit("GotUnBlocked", {
//     conversation_id: conversation_id,
//     user_id: user_id,
//   });
// };

const getLatestmessages = async (
  conversation_id: string,
  limit: number,
  user_id: string
) => {
  // console.log("conversation_id", conversation_id);

  // First, find the chat document to get the deletion time
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

  // Construct the query for messages based on the deletion time
  const query: any = {
    conversationId: conversation_id,
  };

  // If a deletion time was found, modify the query to exclude messages before that time
  if (deletedAt) {
    query["timestamp"] = { $gt: deletedAt };
  }

  // Now, find the messages according to the modified query
  const messages = await Message.find(query)
    .limit(limit)
    .sort({ timestamp: -1 });

  return messages;
};
