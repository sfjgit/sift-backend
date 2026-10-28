// File: s3.ts
// Path: src/lib/s3.ts

import { randomUUID } from "crypto";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import env from "../config/env";
import { config } from "dotenv";

// npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

config();

const BUCKET = process.env.AWS_BUCKET as string;

// process.env.S3_REGION;

const AWS_BUCKET_NAME = process.env.AWS_BUCKET;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;

if (!BUCKET) {
  console.warn("[s3] S3_BUCKET_NAME is not set — uploads will fail");
}

const s3Config: S3ClientConfig = {
  region: AWS_REGION,
  ...(AWS_ACCESS_KEY && AWS_SECRET_KEY
    ? {
        credentials: {
          accessKeyId: AWS_ACCESS_KEY,
          secretAccessKey: AWS_SECRET_KEY,
        },
      }
    : {}), // key omitted entirely → SDK falls back to instance / ADC credentials
};

export const s3 = new S3Client(s3Config);

/** safe, collision-free object key: clients/2026/08/uuid-file-name.pdf */
export const buildFileKey = (folder: string, fileName: string) => {
  const ext = path.extname(fileName).toLowerCase();
  const base = path
    .basename(fileName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");

  return `${folder}/${yyyy}/${mm}/${randomUUID()}-${base || "file"}${ext}`;
};

interface UploadArgs {
  folder: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
}

/** returns the S3 object key (store this, never a full URL) */
export const uploadToS3 = async ({
  folder,
  fileName,
  buffer,
  mimeType,
}: UploadArgs): Promise<string> => {
  const fileKey = buildFileKey(folder, fileName);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: buffer,
      ContentType: mimeType,
      ContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"`,
    })
  );

  return fileKey;
};

export const deleteFromS3 = async (fileKey: string): Promise<void> => {
  if (!fileKey) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey }));
};

/** temporary read URL, default 15 min */
export const getSignedUrl = async (
  fileKey: string,
  expiresIn = 60 * 15,
  downloadAs?: string // set → the browser saves the file under this name
): Promise<string | null> => {
  if (!fileKey) return null;

  try {
    return await presign(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: fileKey,
        ...(downloadAs && {
          ResponseContentDisposition: `attachment; filename="${downloadAs.replace(/["\\\r\n]/g, "_")}"`,
        }),
      }),
      { expiresIn }
    );
  } catch (err) {
    console.error("[s3] presign failed", fileKey, err);
    return null;
  }
};

/** presigned PUT — use this later if attachments get large (skips the app server) */
export const getUploadUrl = async (
  folder: string,
  fileName: string,
  mimeType: string,
  expiresIn = 60 * 5
) => {
  const fileKey = buildFileKey(folder, fileName);

  const url = await presign(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      ContentType: mimeType,
    }),
    { expiresIn }
  );

  return { fileKey, url };
};
