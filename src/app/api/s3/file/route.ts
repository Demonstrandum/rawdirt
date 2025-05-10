import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, ACCESS_POINT_ARN, getObjectUrl } from '@/config/aws';

// Simple in-memory cache with 1-hour expiry
interface CacheEntry {
  url: string;
  expiresAt: number;
}

const urlCache: Record<string, CacheEntry> = {};

// Clean the cache occasionally to prevent memory leaks
const CACHE_CLEANUP_INTERVAL = 1000 * 60 * 10; // 10 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(urlCache).forEach(key => {
    if (urlCache[key].expiresAt < now) {
      delete urlCache[key];
    }
  });
}, CACHE_CLEANUP_INTERVAL);

export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    if (!key) {
      return NextResponse.json(
        { error: 'File key is required' },
        { status: 400 }
      );
    }

    // Check if we have a valid cached URL
    const now = Date.now();
    if (urlCache[key] && urlCache[key].expiresAt > now) {
      console.log('Returning cached URL for file:', key);
      return NextResponse.json({ url: urlCache[key].url });
    }

    console.log('Getting URL for file:', key);

    try {
      // Option 1: If objects are publicly accessible, use a direct URL
      // This works if your bucket/access point policy allows public reads
      const directUrl = getObjectUrl(key);

      // Option 2: Use a pre-signed URL (works even if the bucket is private)
      // This requires AWS credentials but creates a temporary URL with access
      // Create the command for getting an object
      const command = new GetObjectCommand({
        Bucket: ACCESS_POINT_ARN,
        Key: key
      });

      // Generate a presigned URL that's valid for 1 hour (3600 seconds)
      const expiresIn = 3600;
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });

      console.log('Generated URL for file');

      // Cache the URL with a slightly shorter expiry (to be safe)
      urlCache[key] = {
        url: signedUrl,
        expiresAt: now + (expiresIn * 950) // 95% of the expiry time
      };

      // Choose which URL type to return - for now, let's try the presigned URL
      // since that works in both public and private scenarios
      return NextResponse.json({ url: signedUrl });
    } catch (fetchError: any) {
      console.error('AWS S3 error:', fetchError);
      return NextResponse.json(
        {
          error: `Error getting file URL: ${fetchError.message || 'Unknown error'}`,
          code: fetchError.Code || fetchError.code
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error getting file URL:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get file URL' },
      { status: 500 }
    );
  }
}
