import jwt, { JwtPayload } from "jsonwebtoken";
import { Request, Response, NextFunction, RequestHandler } from "express";
import redisClient from "../radis/index.redis";
import dotenv from "dotenv";
dotenv.config();

export const jwtSecret = process.env.Jwt_Secret || "defaultSecreteKey";

export interface CustomRequest extends Request {
  token: string | JwtPayload;
  user: string | JwtPayload;
}

export const auth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ message: "No Token Found" });
    }
    const decoded: any = jwt.verify(token, jwtSecret);
    if (decoded && decoded?.id) {
      const redisToken = await redisClient.get(`user_${decoded.id}`);
      if (token === redisToken) {
        (req as CustomRequest).user = decoded;
        next();
      } else {
        return res.status(401).json({ message: "Session Expired" });
      }
    } else {
      return res.status(401).json({ message: "Token expired" });
    }
  } catch (err) {
    console.error("Error in authorization middleware:", err);
    res.status(401).send({
      message: "Unauthorized Access / Token expired",
      status: false,
    });
  }
};
