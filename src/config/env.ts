import { config } from "dotenv";

config();

const { NODE_ENV } = process.env;
const env: any = {
  NODE_ENV: NODE_ENV || "development",
  PORT: process.env.PORT || 3000,
};
export default env;

console.log(env);
