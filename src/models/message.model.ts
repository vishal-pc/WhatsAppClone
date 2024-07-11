import mongoose, { Document, Schema } from "mongoose";

export interface IMessage extends Document {
  sender_id: Schema.Types.ObjectId;
  receiver_id: Schema.Types.ObjectId;
  message: string;
  message_state: "sent" | "delivered" | "seen";
  timestamp: Date;
  isReply: boolean;
  toWhichReplied: any;
  conversation_id: Schema.Types.ObjectId;
  reaction: any;
  message_id: string;
}

const messageSchema: Schema<IMessage> = new mongoose.Schema({
  sender_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  receiver_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  message: { type: String, required: true },
  message_state: { type: String, default: "sent" },
  isReply: { type: Boolean, default: false },
  message_id: { type: String },
  toWhichReplied: {
    message_type: { type: String },
    message: { type: String },
    messageOwner: { type: Schema.Types.ObjectId },
  },
  reaction: [
    {
      user_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
      reaction: { type: String },
    },
  ],
  timestamp: { type: Date, default: Date.now },
  conversation_id: {
    type: Schema.Types.ObjectId,
    ref: "Chat",
    required: false,
  },
});

const Message = mongoose.model<IMessage>("Message", messageSchema);

export default Message;
