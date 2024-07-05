import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  fullName: string;
  email: string;
  password: string;
  mobileNumber: number;
  profileImg: string;
  address: string;
  IsAdmin: boolean;
  role: Schema.Types.ObjectId;
  stripeUserId: string;
  userLogin: boolean;
  provider: string;
  uid: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
    },
    email: {
      type: String,
    },
    password: {
      type: String,
    },
    mobileNumber: {
      type: Number,
    },
    profileImg: {
      type: String,
    },
    userLogin: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const User = mongoose.model<IUser>("User", userSchema);
export default User;
