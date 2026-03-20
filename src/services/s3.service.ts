import env from "@/config/env";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import { v4 as uuidv4 } from "uuid";

config();

const s3 = new S3Client({
  region: env.AWS_REGION!,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY!,
    secretAccessKey: env.AWS_SECRET_KEY!,
  },
});

export const uploadToS3 = async (file: Express.Multer.File) => {
  const fileKey = `requirements/${uuidv4()}-${file.originalname}`;

  const command = new PutObjectCommand({
    Bucket: env.AWS_BUCKET_NAME!,
    Key: fileKey,
    Body: file.buffer, // IMPORTANT: use buffer
    ContentType: file.mimetype,
  });

  await s3.send(command);

  const fileUrl = `https://${env.AWS_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${fileKey}`;

  return {
    fileUrl,
    fileKey,
  };
};
