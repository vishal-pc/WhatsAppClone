import mongoose, { Document, Schema } from "mongoose";

interface IUserNotification extends Document {
  user_id: Schema.Types.ObjectId;
  fcm_token: string;
  device_id: string;
}

const UserFCMSchema = new Schema<IUserNotification>({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  fcm_token: {
    type: String,
    required: true,
  },
  device_id: {
    type: String,
    required: true,
    unique: true,
  },
});

const UserFCM = mongoose.model<IUserNotification>("UserFCM", UserFCMSchema);

export default UserFCM;
