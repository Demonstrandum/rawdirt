import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { AWS_REGION, BUCKET_NAME } from '@/config/aws'; // Assuming BUCKET_NAME is your actual S3 bucket name

const s3Client = new S3Client({ region: AWS_REGION });
const INDEX_FILE_KEY = 'metadata/index.json';

interface IndexFileStructure {
  version: number;
  files: Record<string, Partial<RawFileFromIndex>>;
  // totalRawFiles?: number; // We can add this later if managed by a full scan
}

// Define what parts of RawFile we store in the index
interface RawFileFromIndex {
  s3LastModified?: string; // Store as ISO string
  size?: number;
  exifDate?: string;     // Store as ISO string
  thumbnailS3Key?: string;
  thumbnailDataUrl?: string; // May not want to store large data URLs in the index long-term
  width?: number;
  height?: number;
}

async function getIndexFile(): Promise<IndexFileStructure> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: INDEX_FILE_KEY,
    });
    const response = await s3Client.send(command);
    const str = await response.Body?.transformToString();
    if (str) {
      return JSON.parse(str) as IndexFileStructure;
    }
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      console.log('Metadata index file not found, returning new structure.');
    } else {
      console.error('Error fetching metadata index:', error);
    }
  }
  // Default structure if file doesn't exist or error occurs
  return { version: 1, files: {} };
}

async function putIndexFile(indexData: IndexFileStructure): Promise<boolean> {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: INDEX_FILE_KEY,
      Body: JSON.stringify(indexData, null, 2),
      ContentType: 'application/json',
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error writing metadata index:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const indexData = await getIndexFile();
    return NextResponse.json(indexData);
  } catch (error) {
    console.error('GET /api/metadata/index error:', error);
    return NextResponse.json({ error: 'Failed to fetch metadata index' }, { status: 500 });
  }
}

// This POST will update/add metadata for a single file
export async function POST(request: NextRequest) {
  try {
    const { fileKey, metadata } = await request.json();
    console.log('[API] Received metadata update for:', fileKey, 'with data:', metadata);

    if (!fileKey || !metadata) {
      return NextResponse.json({ error: 'Missing fileKey or metadata' }, { status: 400 });
    }

    const indexData = await getIndexFile();

    // Prepare metadata for storage: convert Dates to ISO strings if they are Date objects
    const storableMetadata: Partial<RawFileFromIndex> = { ...metadata };

    console.log('[API] Processing exifDate:', metadata.exifDate, 'type:', typeof metadata.exifDate);

    if (metadata.exifDate && typeof metadata.exifDate !== 'string') {
      storableMetadata.exifDate = new Date(metadata.exifDate).toISOString();
      console.log('[API] Converted exifDate to ISO string:', storableMetadata.exifDate);
    } else if (metadata.exifDate) {
      console.log('[API] Using existing exifDate string:', metadata.exifDate);
      // Make sure it's a valid date string
      try {
        const testDate = new Date(metadata.exifDate);
        if (isNaN(testDate.getTime())) {
          console.warn('[API] Invalid date string:', metadata.exifDate);
        } else {
          console.log('[API] Valid date string, ISO format:', testDate.toISOString());
        }
      } catch (e) {
        console.warn('[API] Error parsing date string:', e);
      }
    }

    if (metadata.s3LastModified && typeof metadata.s3LastModified !== 'string') {
      storableMetadata.s3LastModified = new Date(metadata.s3LastModified).toISOString();
    }

    // Get existing file metadata or create a new entry
    const existingMetadata = indexData.files[fileKey] || {};

    // Create a new metadata object that preserves existing fields
    // and only updates fields that are actually defined in the new metadata
    const updatedMetadata = { ...existingMetadata };

    // Loop through storableMetadata and only copy defined values
    Object.entries(storableMetadata).forEach(([key, value]) => {
      if (value !== undefined) {
        updatedMetadata[key] = value;
      } else {
        console.log(`[API] Preserving existing ${key} value for ${fileKey}`);
      }
    });

    // Log the final metadata we're about to save
    console.log('[API] Final metadata to store:', updatedMetadata);
    console.log('[API] Fields preserved from existing metadata:',
      Object.keys(existingMetadata).filter(key =>
        storableMetadata[key] === undefined && existingMetadata[key] !== undefined
      )
    );

    // Update the index with our carefully merged metadata
    indexData.files[fileKey] = updatedMetadata;

    const success = await putIndexFile(indexData);

    if (success) {
      console.log('[API] Successfully updated metadata for:', fileKey);
      return NextResponse.json({
        message: 'Metadata updated',
        updatedKey: fileKey,
        metadata: indexData.files[fileKey] // Return the updated metadata
      });
    } else {
      console.error('[API] Failed to write metadata index');
      return NextResponse.json({ error: 'Failed to write metadata index' }, { status: 500 });
    }
  } catch (error) {
    console.error('POST /api/metadata/index error:', error);
    return NextResponse.json({ error: 'Failed to update metadata' }, { status: 500 });
  }
}
