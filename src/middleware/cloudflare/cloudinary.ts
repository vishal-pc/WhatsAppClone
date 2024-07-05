import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.Cloudnary_Cloud_Name,
  api_key: process.env.Cloudnary_Api_Key,
  api_secret: process.env.Cloudnary_Secret_key,
});

export default cloudinary;
