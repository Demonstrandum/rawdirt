import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { AWS_REGION, BUCKET_NAME } from '@/config/aws';

const s3Client = new S3Client({ region: AWS_REGION });
const INDEX_FILE_KEY = 'metadata/index.json';

interface IndexFileStructure {
  version: number;
  files: Record<string, Partial<any>>;
  lastUpdated?: string;
}

// Batch update route - takes multiple file metadata updates in a single request
export async function POST(request: NextRequest) {
  console.log('[Batch Update API] Received request');

  try {
    const requestData = await request.json();

    if (!requestData.files || typeof requestData.files !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid files data in request' },
        { status: 400 }
      );
    }

    const filesToUpdate = requestData.files;
    const fileKeys = Object.keys(filesToUpdate);

    if (fileKeys.length === 0) {
      return NextResponse.json(
        { message: 'No files to update', updatedCount: 0 },
        { status: 200 }
      );
    }

    console.log(`[Batch Update API] Processing ${fileKeys.length} files`);

    // Get current index
    console.log('[Batch Update API] Fetching current index file');
    let indexData: IndexFileStructure;

    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: INDEX_FILE_KEY,
      });

      const response = await s3Client.send(command);
      const str = await response.Body?.transformToString();

      if (str) {
        indexData = JSON.parse(str) as IndexFileStructure;
        console.log(`[Batch Update API] Successfully loaded existing index with ${Object.keys(indexData.files || {}).length} files`);
      } else {
        // Create a new index if it doesn't exist
        indexData = { version: 1, files: {} };
        console.log('[Batch Update API] Creating new index (empty response body)');
      }
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        // Create a new index if it doesn't exist
        indexData = { version: 1, files: {} };
        console.log('[Batch Update API] Creating new index (NoSuchKey error)');
      } else {
        console.error('[Batch Update API] Error fetching index:', error);
        return NextResponse.json(
          { error: `Failed to fetch index: ${error.message || 'Unknown error'}` },
          { status: 500 }
        );
      }
    }

    // Update the index with all file metadata
    let updatedCount = 0;

    for (const fileKey of fileKeys) {
      const fileMetadata = filesToUpdate[fileKey];

      if (!fileMetadata || typeof fileMetadata !== 'object') {
        console.warn(`[Batch Update API] Invalid metadata for ${fileKey}, skipping`);
        continue;
      }

      // Get existing metadata or create new entry
      const existingMetadata = indexData.files[fileKey] || {};

      console.log(`[Batch Update API] Processing file ${fileKey}`);
      console.log(`  - Existing metadata fields: ${Object.keys(existingMetadata).join(', ') || 'none'}`);
      console.log(`  - New metadata fields: ${Object.keys(fileMetadata).join(', ') || 'none'}`);

      // Create a clean object with only the fields that have values
      const cleanMetadata: Record<string, any> = {};

      // Process special fields like dates
      for (const [key, value] of Object.entries(fileMetadata)) {
        if (value === undefined) continue;

        if (key === 'exifDate' && value) {
          try {
            // Ensure value is a valid date input
            if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
              cleanMetadata[key] = new Date(value).toISOString();
            } else {
              console.warn(`[Batch Update API] Invalid date type for ${fileKey}.${key}:`, typeof value);
              cleanMetadata[key] = String(value);
            }
          } catch (e) {
            console.warn(`[Batch Update API] Invalid date for ${fileKey}.${key}:`, e);
            cleanMetadata[key] = String(value);
          }
        } else if (key === 's3LastModified' && value) {
          try {
            // Ensure value is a valid date input
            if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
              cleanMetadata[key] = new Date(value).toISOString();
            } else {
              console.warn(`[Batch Update API] Invalid date type for ${fileKey}.${key}:`, typeof value);
              cleanMetadata[key] = String(value);
            }
          } catch (e) {
            console.warn(`[Batch Update API] Invalid date for ${fileKey}.${key}:`, e);
            cleanMetadata[key] = String(value);
          }
        } else if (key === 'thumbnailDataUrl' && value) {
          // Ensure thumbnail data is preserved
          console.log(`[Batch Update API] Processing thumbnailDataUrl for ${fileKey} (length: ${typeof value === 'string' ? value.length : 'unknown'})`);
          cleanMetadata[key] = value;
        } else {
          cleanMetadata[key] = value;
        }
      }

      // Important: Check if we should preserve existing thumbnailDataUrl
      if (!cleanMetadata.thumbnailDataUrl && existingMetadata.thumbnailDataUrl) {
        console.log(`[Batch Update API] Preserving existing thumbnailDataUrl for ${fileKey}`);
        cleanMetadata.thumbnailDataUrl = existingMetadata.thumbnailDataUrl;
      }

      // Merge with existing metadata, preserving fields not in the update
      indexData.files[fileKey] = {
        ...existingMetadata,
        ...cleanMetadata
      };

      console.log(`[Batch Update API] Final metadata for ${fileKey}: ${Object.keys(indexData.files[fileKey]).join(', ')}`);
      console.log(`  - Has thumbnailDataUrl: ${!!indexData.files[fileKey].thumbnailDataUrl}`);

      updatedCount++;
    }

    // Update timestamp
    indexData.lastUpdated = new Date().toISOString();

    // Write updated index back to S3
    console.log(`[Batch Update API] Writing updated index with ${updatedCount} changed files`);

    try {
      const jsonBody = JSON.stringify(indexData, null, 2);
      console.log(`[Batch Update API] Index size: ${(jsonBody.length / 1024 / 1024).toFixed(2)}MB`);

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: INDEX_FILE_KEY,
        Body: jsonBody,
        ContentType: 'application/json',
      });

      await s3Client.send(command);
      console.log('[Batch Update API] Successfully wrote index file');

      return NextResponse.json({
        message: 'Metadata updated',
        updatedCount,
        timestamp: indexData.lastUpdated
      });
    } catch (error) {
      console.error('[Batch Update API] Error writing index:', error);
      return NextResponse.json(
        { error: `Failed to write index: ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[Batch Update API] Error processing request:', error);
    return NextResponse.json(
      { error: `Error processing request: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
