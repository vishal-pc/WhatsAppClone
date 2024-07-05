import { Request, Response } from "express";
import * as chatServices from "./chat.service";
import { ErrorMessages, StatusCodes } from "../validation/responseMessages";

export const MakeChat = async (req: any, res: Response) => {
  try {
    const result = await chatServices.MakeChat(req.body, req.user.id);
    res.status(200).send(result);
  } catch (error) {
    console.error("Error in make chat", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};

export const DeleteChats = async (req: any, res: Response) => {
  try {
    const result = await chatServices.DeleteChats(req?.user?.id, req.body);
    res.status(200).send(result);
  } catch (error) {
    console.error("Error in delete chat", error);
    return res.json({
      message: ErrorMessages.SomethingWentWrong,
      success: false,
      status: StatusCodes.ServerError.InternalServerError,
    });
  }
};
