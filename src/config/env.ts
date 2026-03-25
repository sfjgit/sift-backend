import { config } from "dotenv";

config();

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || "secret",
  AWS_BUCKET_NAME: process.env.S3_BUCKET_NAME,
  AWS_REGION: process.env.S3_REGION || "us-east-1",
  AWS_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  AWS_SECRET_KEY: process.env.S3_SECRET_KEY,
};
export default env;

console.log(env);
