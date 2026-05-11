// src/utils/crypto.ts
import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const SECRET = process.env.NAUKRI_CREDS_SECRET || "";

export function encrypt(text: string): string {
  if (!SECRET) throw new Error("NAUKRI_CREDS_SECRET not set in environment");
  const key = Buffer.from(SECRET, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(stored: string): string {
  if (!SECRET) throw new Error("NAUKRI_CREDS_SECRET not set in environment");
  const [ivHex, encryptedHex] = stored.split(":");
  const key = Buffer.from(SECRET, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}
