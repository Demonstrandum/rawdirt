import { S3Client } from '@aws-sdk/client-s3';

// AWS configuration - with defaults from environment
export const AWS_REGION = process.env.AWS_REGION || '';
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

// Bucket and access point config
export const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || '';
export const BUCKET_NAME = process.env.AWS_BUCKET || '';
export const ACCESS_POINT_NAME = process.env.AWS_ACCESS_POINT_NAME || '';
export const ACCESS_POINT_ARN = process.env.AWS_ACCESS_POINT_ARN || '';
export const ACCESS_POINT_ALIAS = process.env.AWS_ACCESS_POINT_ALIAS || '';

// URL for direct access (if public)
export const PUBLIC_ACCESS_POINT_URL = `https://${ACCESS_POINT_ALIAS}.s3.amazonaws.com/`;

// Initialize S3 client
export const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
});

// Create a function to get the full URL for an object
export function getObjectUrl(key: string): string {
  return `${PUBLIC_ACCESS_POINT_URL}${encodeURIComponent(key)}`;
}
