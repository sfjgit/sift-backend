import nodemailer from "nodemailer";
import env from "@/config/env";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
}) {
  return transporter.sendMail({
    from: env.SMTP_FROM,
    ...options,
  });
}
