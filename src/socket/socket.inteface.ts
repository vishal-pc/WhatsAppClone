import mongoose from "mongoose";

export type UserUserQuestionProgressTypes = {
  conversation: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  currentQuestion: mongoose.Types.ObjectId;
  questionInitiator: mongoose.Types.ObjectId;
};
