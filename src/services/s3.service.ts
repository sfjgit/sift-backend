// import env from "@/config/env";
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import { config } from "dotenv";
// import { v4 as uuidv4 } from "uuid";

// config();

// const s3 = new S3Client({
//   region: env.AWS_REGION!,
//   credentials: {
//     accessKeyId: env.AWS_ACCESS_KEY!,
//     secretAccessKey: env.AWS_SECRET_KEY!,
//   },
// });

// export const uploadToS3 = async (file: Express.Multer.File) => {
//   const fileKey = `requirements/${uuidv4()}-${file.originalname}`;

//   const command = new PutObjectCommand({
//     Bucket: env.AWS_BUCKET_NAME!,
//     Key: fileKey,
//     Body: file.buffer, // IMPORTANT: use buffer
//     ContentType: file.mimetype,
//   });

//   await s3.send(command);

//   const fileUrl = `https://${env.AWS_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`;

//   return {
//     fileUrl,
//     fileKey,
//   };
// };

// utils/s3.ts
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import { v4 as uuid } from "uuid";

export const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_BUCKET!;

// multer — memory storage, we stream directly to S3
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed"));
    }
  },
});

export async function uploadToS3(
  file: Express.Multer.File,
  folder: string,
): Promise<{ key: string; url: string }> {
  const ext = file.originalname.split(".").pop();
  const key = `${folder}/${uuid()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  // signed URL valid for 7 days
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 60 * 60 * 24 * 7 },
  );

  return { key, url };
}

export async function deleteFromS3(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

export async function getSignedDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 60 * 60 }, // 1 hour
  );
}
