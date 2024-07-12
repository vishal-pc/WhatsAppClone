import express from "express";
import multer from "multer";
import { auth } from "../middleware/token/authMiddleware";
import * as userController from "../controller/user.controller";

const authRouter = express.Router();

// Configure multer for uploading files
const storage = multer.diskStorage({
  filename: (req, file, cb) => {
    const name = Date.now() + "_" + file.originalname;
    cb(null, name);
  },
});

// Uploading files into storage
const upload = multer({ storage: storage });

// User routes
authRouter.post("/register", userController.userRegister);
authRouter.post("/login", userController.userLogin);
authRouter.get("/get-user/:id", [auth], userController.getUserById);
authRouter.get("/get-all-users", [auth], userController.getAllUsers);
authRouter.post("/logout/:id", [auth], userController.logout);
authRouter.post("/forget-password", userController.forgetPassword);
authRouter.post("/reset-password", userController.resetPassword);
authRouter.patch("/change-password/:id", [auth], userController.changePassword);
authRouter.patch(
  "/update-profile/:id",
  [auth],
  upload.single("profileImg"),
  userController.updateUserProfile
);
authRouter.post("/save_user_fcm", [auth], userController.SaveUserFcm);

export default authRouter;
