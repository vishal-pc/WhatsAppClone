import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const dbUrl = process.env.Mongo_DB_Uri || "http://localhost";
const dbConnection = mongoose.connect(dbUrl);

export default dbConnection;
