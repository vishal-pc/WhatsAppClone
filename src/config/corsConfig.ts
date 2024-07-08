import { RequestHandler } from "express";
import cors, { CorsOptions } from "cors";

interface CorsConfig {
  origin?: string;
  methods?: string;
  credentials?: boolean;
}

export const configCors = ({
  origin = "*",
  methods = "GET, POST, PUT, DELETE, PATCH",
  credentials = true,
}: CorsConfig = {}): RequestHandler => {
  const corsOptions: CorsOptions = {
    origin,
    methods,
    credentials,
  };
  return cors(corsOptions);
};
