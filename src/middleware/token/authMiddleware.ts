import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { StatusCodes, ErrorMessages } from "../../validation/responseMessages";
import dotenv from "dotenv";

dotenv.config();

const jwtSecret = process.env.Jwt_Secret || "defaultSecreteKey";

// Define a new interface that extends the Express Request interface
export interface CustomRequest extends Request {
  file: any;
  user?: userType;
}

export interface userType {
  exp: number;
  userId: string | JwtPayload;
  fullName: string | JwtPayload;
}

export const verifyAuthToken =
  (allowedRoles: string[]) =>
  (req: CustomRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(StatusCodes.ClientError.NotFound).json({
        message: ErrorMessages.AuthorizeError,
        success: false,
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(StatusCodes.ClientError.BadRequest).json({
        message: ErrorMessages.AuthenticatError,
        success: false,
      });
    }

    try {
      const decodedToken = jwt.verify(token, jwtSecret);

      if (typeof decodedToken !== "object" || decodedToken === null) {
        return res.status(StatusCodes.ClientError.NotFound).json({
          message: ErrorMessages.TokenError,
          success: false,
        });
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (decodedToken.exp && decodedToken.exp < currentTime) {
        return res.status(StatusCodes.ClientError.BadRequest).json({
          message: ErrorMessages.TokenExpire,
          success: false,
        });
      }

      req.user = decodedToken as userType;

      next();
    } catch (error) {
      return res.status(StatusCodes.ClientError.NotFound).json({
        message: ErrorMessages.TokenError,
        success: false,
      });
    }
  };
