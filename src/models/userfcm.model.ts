import mongoose, { Document, Schema } from "mongoose";

interface IUserNotification extends Document {
  user_id: Schema.Types.ObjectId;
  fcm_token: string;
  device_id: string;
}

const userFCMSchema = new Schema<IUserNotification>({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    // unique: true,
  },
  fcm_token: {
    type: String,
    required: true,
    // unique: true,
  },
  device_id: {
    type: String,
    required: true,
    unique: true,
  },
});

const UserFCM = mongoose.model<IUserNotification>("UserFCM", userFCMSchema);

export default UserFCM;
