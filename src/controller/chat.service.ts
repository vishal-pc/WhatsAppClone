import mongoose from "mongoose";
import Chat from "../models/chat.model";

export const MakeChat = async (body: any, user_id: string) => {
  try {
    const userId = new mongoose.Types.ObjectId(user_id);
    const chatHistoryWithMessages = await Chat.aggregate([
      {
        $match: {
          participants: {
            $elemMatch: {
              $eq: userId,
            },
          },
          // IsChatDeleted: { $ne: userId },
        },
      },
      {
        $lookup: {
          from: "users", // The name of the users collection
          localField: "participants",
          foreignField: "_id",
          as: "participantsDetails",
        },
      },
      {
        $unwind: "$participantsDetails",
      },
      {
        $match: {
          "participantsDetails._id": {
            $ne: new mongoose.Types.ObjectId(userId),
          },
        },
      },
      {
        $lookup: {
          from: "messages", // The name of the messages collection
          let: {
            conversationId: "$_id",
            deletedAt: {
              $ifNull: [
                {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$IsChatDeleted",
                        as: "chatDelete",
                        cond: { $eq: ["$$chatDelete.userId", userId] },
                      },
                    },
                    0,
                  ],
                },
                null,
              ],
            },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$conversationId", "$$conversationId"] },
                    {
                      $gt: [
                        "$timestamp",
                        { $ifNull: ["$$deletedAt.deletedAt", new Date(0)] },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $sort: {
                timestamp: -1,
              },
            },
            {
              $limit: 20,
            },
          ],
          as: "recentMessages",
        },
      },
      {
        $addFields: {
          latestMessageTimestamp: { $max: "$recentMessages.timestamp" },
        },
      },
      {
        $sort: {
          latestMessageTimestamp: -1,
        },
      },
      {
        $lookup: {
          from: "messages",
          let: {
            conversationId: "$_id",
            deletedAt: {
              $ifNull: [
                {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$IsChatDeleted",
                        as: "chatDelete",
                        cond: { $eq: ["$$chatDelete.userId", userId] },
                      },
                    },
                    0,
                  ],
                },
                null,
              ],
            },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$conversationId", "$$conversationId"] },
                    { $in: ["$message_state", ["delivered", "sent"]] },
                    { $eq: ["$receiver_id", userId] },
                    {
                      $gt: [
                        "$timestamp",
                        { $ifNull: ["$$deletedAt.deletedAt", new Date(0)] },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $count: "deliveredMessagesCount",
            },
          ],
          as: "deliveredMessagesInfo",
        },
      },
      {
        $addFields: {
          deliveredMessagesCount: {
            $ifNull: [
              {
                $arrayElemAt: [
                  "$deliveredMessagesInfo.deliveredMessagesCount",
                  0,
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $lookup: {
          from: "blocks", // Use the correct collection name for blocks
          let: { userId: userId, participantId: "$participantsDetails._id" },
          pipeline: [
            {
              $match: {
                $or: [
                  {
                    $expr: {
                      $and: [
                        { $eq: ["$blockerUserId", "$$userId"] },
                        { $eq: ["$blockedUserId", "$$participantId"] },
                      ],
                    },
                  },
                  {
                    $expr: {
                      $and: [
                        { $eq: ["$blockerUserId", "$$participantId"] },
                        { $eq: ["$blockedUserId", "$$userId"] },
                      ],
                    },
                  },
                ],
              },
            },
          ],
          as: "blockInfo",
        },
      },
      {
        $addFields: {
          isUserBlocked: {
            $cond: {
              if: { $gt: [{ $size: "$blockInfo" }, 0] },
              then: true,
              else: false,
            },
          },
        },
      },
      {
        $project: {
          participants: 1,
          requestStatus: 1,
          initiator: 1,
          responder: 1,
          user: {
            _id: "$participantsDetails._id",
            first_name: "$participantsDetails.first_name",
            last_name: "$participantsDetails.last_name",
            isOnline: "$participantsDetails.isOnline",
          },
          messages: "$recentMessages",
          deliveredMessagesCount: 1,
          deletedAt: 1,
          userDeletedAt: 1,
          isUserBlocked: 1,
          blockInfo: 1,
          isSuggestionActive: 1,
        },
      },
      {
        $match: {
          $and: [
            { initiator: { $exists: true } }, // Ensures initiator exists
            { responder: { $exists: true } }, // Ensures responder exists
          ],
        }, // Allows documents where requestStatus is not "pending"
      },
    ]);

    // console.log("MakeChat", chatHistoryWithMessages);
    return {
      status: true,
      chats: chatHistoryWithMessages,
    };
  } catch (err) {
    // console.log("chatHistoryWithMessages errr---->", err);
    return {
      status: false,
      message: "Some message",
    };
  }
};

export const DeleteChats = async (user_id: string, body: any) => {
  try {
    const chatObjectIdArray = body.chatIds.map(
      (id: string) => new mongoose.Types.ObjectId(id)
    );
    const userObjectId = new mongoose.Types.ObjectId(user_id);

    const bulkOps: any = [];

    chatObjectIdArray.forEach((chatId: mongoose.Types.ObjectId) => {
      // Operation to update existing entries
      bulkOps.push({
        updateOne: {
          filter: { _id: chatId, "IsChatDeleted.userId": userObjectId },
          update: {
            $set: { "IsChatDeleted.$.deletedAt": new Date() },
          },
        },
      });

      // Operation to add new entry if userId does not exist in IsChatDeleted
      bulkOps.push({
        updateOne: {
          filter: {
            _id: chatId,
            "IsChatDeleted.userId": { $ne: userObjectId },
          },
          update: {
            $push: {
              IsChatDeleted: { userId: userObjectId, deletedAt: new Date() },
            },
          },
        },
      });
    });

    await Chat.bulkWrite(bulkOps);

    return { status: true, message: "Chats updated successfully." };
  } catch (err) {
    // console.log("logout err", err);
    return {
      status: false,
      message: "Error while getting data",
      error: err,
    };
  }
};
