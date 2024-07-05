import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

export const transporter = nodemailer.createTransport({
  host: process.env.Mail_Host,
  port: parseInt(process.env.Mail_Port as string, 10),
  secure: true, // true for port 465, false for other ports
  auth: {
    user: process.env.Mail_Username,
    pass: process.env.Mail_Password,
  },
});
