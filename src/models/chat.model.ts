import mongoose, { Document, Schema } from "mongoose";

export interface IChat extends Document {
  participants: any;
  requestStatus: string;
  initiator: Schema.Types.ObjectId;
  responder: Schema.Types.ObjectId;
  isSuggestionActive: boolean;
  IsChatDeleted: any;
}

const chatSchema: Schema<IChat> = new mongoose.Schema({
  participants: [Schema.Types.ObjectId],
  requestStatus: { type: String, default: "pending" },
  initiator: { type: Schema.Types.ObjectId },
  responder: { type: Schema.Types.ObjectId },
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
