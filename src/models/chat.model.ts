import mongoose, { Document, Schema } from "mongoose";

export interface IChat extends Document {
  participants: any;
  initiator: Schema.Types.ObjectId;
  responder: Schema.Types.ObjectId;
  isSuggestionActive: boolean;
  IsChatDeleted: any;
}

const chatSchema: Schema<IChat> = new mongoose.Schema({
  participants: [Schema.Types.ObjectId],
  initiator: { type: Schema.Types.ObjectId, ref: "User" },
  responder: { type: Schema.Types.ObjectId, ref: "User" },
  isSuggestionActive: {
    type: Boolean,
    default: true,
  },
  IsChatDeleted: [
    {
      userId: Schema.Types.ObjectId,
      deletedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});

const Chat = mongoose.model<IChat>("Chat", chatSchema);

export default Chat;
