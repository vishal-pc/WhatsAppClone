import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User, { IUser } from "../models/user.model";
import {
  ErrorMessages,
  StatusCodes,
  SuccessMessages,
} from "../validation/responseMessages";
import {
  emailValidate,
  passwordRegex,
  validateMobileNumber,
} from "../helper/helper";
import { transporter } from "../middleware/mail/transPorter";
import { sendMailForPassword } from "../template/forgetPassMail";
import cloudinary from "../middleware/cloudflare/cloudinary";
import redisClient from "../helper/radis/index.redis";
import mongoose from "mongoose";
import UserFCM from "../models/userfcm.model";
import { getUserSocketId, sendOfflineEvent } from "../socket/index.socket";

async function removeToken(userId: string) {
  await redisClient.del(`user_${userId}`);
}

const otpStore: any = {};

// User Register
export const userRegister = async (req: Request, res: Response) => {
  const { fullName, email, password } = req.body;
  try {
    const requiredFields = ["fullName", "email", "password"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      const missingFieldsMessage = missingFields.join(", ");
      return res.json({
        message: ErrorMessages.MissingFields(missingFieldsMessage),
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }

    if (!emailValidate(email)) {
      return res.json({
        message: ErrorMessages.EmailInvalid,
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.json({
        message: ErrorMessages.UserExists(email),
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }

    if (!passwordRegex.test(password)) {
      return res.json({
        message: ErrorMessages.PasswordRequirements,
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = {
      fullName,
      email,
      password: hashedPassword,
      userLogin: false,
      IsAdmin: false,
    };

    const userSaved = await User.create(newUser);
    if (userSaved.id) {
      return res.json({
        message: SuccessMessages.RegisterSuccess,
        status: StatusCodes.Success.Created,
        success: true,
      });
    } else {
      return res.json({
        message: ErrorMessages.RegisterError,
        success: false,
        status: StatusCodes.ServerError.InternalServerError,
      });
    }
  } catch (error) {
    console.error("Error in user register", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

// User Login
export const userLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const requiredFields = ["email", "password"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      const missingFieldsMessage = missingFields.join(", ");
      return res.json({
        message: ErrorMessages.MissingFields(missingFieldsMessage),
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }
    const auth = await User.findOne({ email });
    if (!auth) {
      return res.json({
        message: ErrorMessages.UserNotFound,
        success: false,
        status: StatusCodes.ClientError.NotFound,
      });
    }

    const isPasswordValid = await bcrypt.compare(password, auth.password || "");
    if (!isPasswordValid) {
      return res.json({
        message: ErrorMessages.IncorrectCredentials,
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }
    await User.findByIdAndUpdate(auth._id, { userLogin: true }, { new: true });
    const updatedAuth = await User.findById(auth._id);
    const jwtSecret = process.env.Jwt_Secret || "defaultSecreteKey";

    const token = jwt.sign(
      {
        userId: updatedAuth?._id,
        fullName: updatedAuth?.fullName,
        email: updatedAuth?.email,
        userLogin: updatedAuth?.userLogin,
      },
      jwtSecret,
      { expiresIn: process.env.Jwt_Expiry_Hours }
    );
    await redisClient.set(`user_${updatedAuth?._id}`, token);
    return res.json({
      message: SuccessMessages.SignInSuccess,
      status: StatusCodes.Success.Ok,
      success: true,
      token,
      user: updatedAuth,
    });
  } catch (error) {
    console.error("Error in user login", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

// Get user user By id
export const getUserById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const foundedUser = await User.findById({ _id: id });
    if (!foundedUser) {
      return res.status(StatusCodes.ClientError.NotFound).json({
        message: ErrorMessages.UserNotFound,
        success: false,
      });
    }
    const userData = {
      _id: foundedUser.id,
      fullName: foundedUser.fullName,
      email: foundedUser.email,
      mobileNumber: foundedUser.mobileNumber || "null",
      // profileImg: foundedUser.profileImg || "null",
      createdAt: foundedUser.createdAt,
      updatedAt: foundedUser.updatedAt,
    };
    return res.status(StatusCodes.Success.Ok).json({
      message: SuccessMessages.UserFound,
      success: true,
      userData,
    });
  } catch (error) {
    console.error("Error in getting user by id", error);
    return res.status(StatusCodes.ServerError.InternalServerError).json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
    });
  }
};

// Get all user
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { searchQuery } = req.query;
    const loggedInUserId = (req as any).user.userId;
    let filter: any = { _id: { $ne: loggedInUserId } };

    if (searchQuery) {
      filter.$or = [
        { fullName: { $regex: searchQuery, $options: "i" } },
        { email: { $regex: searchQuery, $options: "i" } },
      ];
      const searchNumber = Number(searchQuery);
      if (!isNaN(searchNumber)) {
        filter.$or.push({ mobileNumber: searchNumber });
      }
    }

    const users = await User.find(filter);
    if (!users) {
      return res.json({
        message: ErrorMessages.UserNotFound,
        success: false,
        status: StatusCodes.ClientError.NotFound,
      });
    }

    const userData = users.map((user: IUser) => ({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      mobileNumber:
        user.mobileNumber !== undefined ? user.mobileNumber.toString() : "null",
      profileImg: user.profileImg || "null",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    const totalCount = users.length;

    return res.json({
      message: SuccessMessages.UserFound,
      status: StatusCodes.Success.Ok,
      success: true,
      totalCount,
      userData,
    });
  } catch (error) {
    console.error("Error in getting users", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      status: StatusCodes.ServerError.InternalServerError,
      success: false,
    });
  }
};

// logout user
export const logout = async (req: Request, res: Response) => {
  try {
    const user_id = req.params.id;
    const user_mongoose_id = new mongoose.Types.ObjectId(user_id);
    await User.findByIdAndUpdate(
      { _id: user_id },
      { $set: { userLogin: false } }
    );

    await UserFCM.deleteMany({
      user_id: user_mongoose_id,
    });
    const user_soket_id = await getUserSocketId(user_id);
    await sendOfflineEvent(user_id, user_soket_id);
    await removeToken(user_id);
    return res.json({
      message: SuccessMessages.Logout,
      status: StatusCodes.Success.Ok,
      success: true,
    });
  } catch (error) {
    console.error("Error in logout users", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      status: StatusCodes.ServerError.InternalServerError,
      success: false,
    });
  }
};

// Forget password
export const forgetPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const generateOTP = () => {
      const otp = Math.floor(1000 + Math.random() * 9000);
      return otp.toString();
    };
    const otpExpire = 5 * 60 * 1000;

    const getUser = await User.findOne({ email: email });
    if (!getUser) {
      return res.json({
        message: ErrorMessages.EmalNotFound,
        status: StatusCodes.ClientError.NotFound,
        success: false,
      });
    }
    const otp = generateOTP();
    otpStore[email] = { otp, expiresAt: Date.now() + otpExpire };

    const emailContant = sendMailForPassword(getUser.fullName, otp);
    const mailOptions = {
      from: process.env.Mail_From,
      to: getUser.email || "",
      subject: "Reset Password",
      html: emailContant,
    };

    transporter.sendMail(mailOptions, (err: any) => {
      if (err) {
        return res.json({
          message: ErrorMessages.EmailNotSend,
          status: StatusCodes.ClientError.BadRequest,
          success: false,
        });
      }
    });

    return res.json({
      message: SuccessMessages.ForgotPasswordSuccess,
      status: StatusCodes.Success.Ok,
      success: true,
    });
  } catch (error) {
    console.error("Error in forget user password", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

// Reset password
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;
    const requiredFields = ["otp", "email", "newPassword", "confirmPassword"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      const missingFieldsMessage = missingFields.join(", ");
      return res.json({
        message: ErrorMessages.MissingFields(missingFieldsMessage),
        success: false,
        status: StatusCodes.ClientError.BadRequest,
      });
    }
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.json({
        message: ErrorMessages.EmalNotFound,
        status: StatusCodes.ClientError.NotFound,
        success: false,
      });
    }
    const storedOTP = otpStore[email];
    if (!storedOTP || storedOTP.otp !== otp) {
      return res.json({
        message: ErrorMessages.OtpError,
        status: StatusCodes.ClientError.NotFound,
        success: false,
      });
    }
    if (newPassword !== confirmPassword) {
      return res.json({
        message: ErrorMessages.PasswordSameError,
        status: StatusCodes.ClientError.NotFound,
        success: false,
      });
    }
    if (!passwordRegex.test(confirmPassword)) {
      return res.json({
        message: ErrorMessages.PasswordRequirements,
        status: StatusCodes.ClientError.NotFound,
        success: false,
      });
    }
    const saltRounds = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(confirmPassword, saltRounds);

    existingUser.password = hashedPassword;
    await existingUser.save();
    delete otpStore[email];

    return res.json({
      message: SuccessMessages.ResetPasswordSuccess,
      status: StatusCodes.Success.Ok,
      success: true,
    });
  } catch (error) {
    console.error("Error in reset user password", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

// Change password for user and admin
export const changePassword = async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const id = req.params.id;
    if (!id) {
      return res.json({
        message: ErrorMessages.IdNotFound,
        success: false,
        status: StatusCodes.ClientError.NotFound,
      });
    }
    const findUser = await User.findById({ _id: id });
    if (findUser) {
      const requiredFields = ["oldPassword", "newPassword", "confirmPassword"];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        const missingFieldsMessage = missingFields.join(", ");
        return res.json({
          message: ErrorMessages.MissingFields(missingFieldsMessage),
          success: false,
          status: StatusCodes.ClientError.BadRequest,
        });
      }
      if (newPassword !== confirmPassword) {
        return res.json({
          message: ErrorMessages.PasswordSameError,
          success: false,
          status: StatusCodes.ClientError.BadRequest,
        });
      }
      if (!passwordRegex.test(confirmPassword)) {
        return res.json({
          message: ErrorMessages.PasswordRequirements,
          status: StatusCodes.ClientError.NotFound,
          success: false,
        });
      }
      const isMatch = await bcrypt.compare(oldPassword, findUser.password);
      if (!isMatch) {
        return res.json({
          message: ErrorMessages.IncorrectOldPassword,
          success: false,
          status: StatusCodes.ClientError.Unauthorized,
        });
      }
      const isSamePassword = await bcrypt.compare(
        newPassword,
        findUser.password
      );
      if (isSamePassword) {
        return res.json({
          message: ErrorMessages.SamePasswordError,
          success: false,
          status: StatusCodes.ClientError.BadRequest,
        });
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(confirmPassword, salt);

      findUser.password = hashedPassword;
      await findUser.save();
      return res.json({
        message: SuccessMessages.ChangePasswordSuccess,
        status: StatusCodes.Success.Ok,
        success: true,
      });
    }
  } catch (error) {
    console.error("Error in change password", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

// update user profile
export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.json({
        message: ErrorMessages.IdNotFound,
        success: false,
        status: StatusCodes.ClientError.NotFound,
      });
    }
    const { fullName, mobileNumber, address } = req.body;
    const file = req.file;

    if (mobileNumber && !validateMobileNumber(mobileNumber)) {
      return res.json({
        message: ErrorMessages.InvalidMobileNumber,
        status: StatusCodes.ClientError.BadRequest,
        success: false,
      });
    }

    const updateData: any = {};

    if (file) {
      const tempPath = file.path;
      const uploadResult = await cloudinary.uploader.upload(tempPath);
      const secure_url = uploadResult.secure_url;
      updateData.profileImg = secure_url;
    }

    if (fullName) updateData.fullName = fullName;
    if (mobileNumber) updateData.mobileNumber = mobileNumber;
    if (address) updateData.address = address;

    const updatedUser = await User.findByIdAndUpdate({ _id: id }, updateData, {
      new: true,
    });
    if (updatedUser) {
      return res.json({
        message: SuccessMessages.UserUpdatedSuccess,
        success: true,
        status: StatusCodes.Success.Ok,
        data: updatedUser,
      });
    } else {
      return res.json({
        message: ErrorMessages.ProfileUpdateError,
        success: false,
        status: StatusCodes.ServerError.InternalServerError,
      });
    }
  } catch (error) {
    console.error("Error in update user profile", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

// Update user in db
export const updateUserDataInDatabase = async (user_id: any, changes: any) => {
  try {
    const findUser = await User.findOneAndUpdate({ _id: user_id }, changes);
    if (findUser) {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    return false;
  }
};
