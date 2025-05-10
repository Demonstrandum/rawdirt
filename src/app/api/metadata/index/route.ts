import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { AWS_REGION, BUCKET_NAME } from '@/config/aws'; // Assuming BUCKET_NAME is your actual S3 bucket name

const s3Client = new S3Client({ region: AWS_REGION });
const INDEX_FILE_KEY = 'metadata/index.json';

interface IndexFileStructure {
  version: number;
  files: Record<string, Partial<RawFileFromIndex>>;
  // totalRawFiles?: number; // We can add this later if managed by a full scan
  lastUpdated?: string; // Add a timestamp for tracking changes
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

// Add a mutex implementation for optimistic locking
let indexUpdateInProgress = false;
let updateQueue: Array<() => Promise<void>> = [];
let lastIndexUpdate = 0;

// Helper function to wait for a random backoff time (to prevent thundering herd)
const randomBackoff = (min = 100, max = 500) => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
};

// Helper function to process the update queue
async function processUpdateQueue() {
  if (indexUpdateInProgress || updateQueue.length === 0) return;

  indexUpdateInProgress = true;
  try {
    const updateFn = updateQueue.shift();
    if (updateFn) {
      await updateFn();
    }
  } finally {
    indexUpdateInProgress = false;
    // Process next item in queue if any
    if (updateQueue.length > 0) {
      processUpdateQueue();
    }
  }
}

async function getIndexFile(): Promise<IndexFileStructure> {
  try {
    console.log('[S3 Index] Getting index file from S3...');
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: INDEX_FILE_KEY,
    });

    console.time('[S3 Index] S3 GetObject request time');
    const response = await s3Client.send(command);
    console.timeEnd('[S3 Index] S3 GetObject request time');

    console.log('[S3 Index] Got response, content-length:', response.ContentLength);

    let str;
    try {
      console.time('[S3 Index] Body transformation time');
      str = await response.Body?.transformToString();
      console.timeEnd('[S3 Index] Body transformation time');

      if (str) {
        console.time('[S3 Index] JSON parse time');
        const parsed = JSON.parse(str) as IndexFileStructure;
        console.timeEnd('[S3 Index] JSON parse time');

        const fileCount = Object.keys(parsed.files || {}).length;
        const totalSize = str.length;
        console.log(`[S3 Index] Successfully loaded index with ${fileCount} files, size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);

        return parsed;
      }
    } catch (parseError) {
      console.error('[S3 Index] Error parsing index file:', parseError);
      console.log('[S3 Index] First 500 characters of response:', str?.substring(0, 500));
      throw new Error(`Failed to parse index file: ${parseError}`);
    }
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      console.log('[S3 Index] Metadata index file not found, returning new structure.');
    } else {
      console.error('[S3 Index] Error fetching metadata index:', error);
    }
  }
  // Default structure if file doesn't exist or error occurs
  return { version: 1, files: {} };
}

async function putIndexFile(indexData: IndexFileStructure): Promise<boolean> {
  try {
    console.log('[S3 Index] Preparing to write index file...');

    // Serialize to JSON with pretty formatting
    console.time('[S3 Index] JSON stringify time');
    const jsonBody = JSON.stringify(indexData, null, 2);
    console.timeEnd('[S3 Index] JSON stringify time');

    const sizeInMB = jsonBody.length / 1024 / 1024;
    console.log(`[S3 Index] Index file size: ${sizeInMB.toFixed(2)}MB with ${Object.keys(indexData.files).length} files`);

    // If the file is very large, warn about it
    if (sizeInMB > 5) {
      console.warn(`[S3 Index] WARNING: Index file is very large (${sizeInMB.toFixed(2)}MB). This may cause performance issues.`);
    }

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: INDEX_FILE_KEY,
      Body: jsonBody,
      ContentType: 'application/json',
    });

    console.time('[S3 Index] S3 PutObject request time');
    await s3Client.send(command);
    console.timeEnd('[S3 Index] S3 PutObject request time');

    console.log('[S3 Index] Successfully wrote index file to S3');
    return true;
  } catch (error) {
    console.error('[S3 Index] Error writing metadata index:', error);
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

// Update the POST function to use the queue
export async function POST(request: NextRequest) {
  return new Promise<NextResponse>(async (resolve) => {
    try {
      const { fileKey, metadata } = await request.json();
      console.log('[API] Received metadata update for:', fileKey, 'with data:', metadata);

      if (!fileKey || !metadata) {
        resolve(NextResponse.json({ error: 'Missing fileKey or metadata' }, { status: 400 }));
        return;
      }

      // Create an update function to put in the queue
      const performUpdate = async () => {
        try {
          // Rate limit S3 requests to prevent throttling
          const now = Date.now();
          const timeSinceLastUpdate = now - lastIndexUpdate;
          if (timeSinceLastUpdate < 500) {
            const waitTime = 500 - timeSinceLastUpdate;
            console.log(`[API] Rate limiting, waiting ${waitTime}ms before updating index`);
            await new Promise(r => setTimeout(r, waitTime));
          }

          // Get the latest index data
          console.log(`[API] Getting latest index file for update to ${fileKey}`);
          const indexData = await getIndexFile();

          // Set timestamp for tracking changes
          indexData.lastUpdated = new Date().toISOString();

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

          console.log(`[API] Writing updated index with ${Object.keys(indexData.files).length} files`);
          lastIndexUpdate = Date.now();
          const success = await putIndexFile(indexData);

          if (success) {
            console.log('[API] Successfully updated metadata for:', fileKey);
            resolve(NextResponse.json({
              message: 'Metadata updated',
              updatedKey: fileKey,
              metadata: indexData.files[fileKey] // Return the updated metadata
            }));
          } else {
            console.error('[API] Failed to write metadata index');
            resolve(NextResponse.json({ error: 'Failed to write metadata index' }, { status: 500 }));
          }
        } catch (updateError) {
          console.error('[API] Error during queued update:', updateError);
          resolve(NextResponse.json({ error: `Failed to update metadata: ${updateError}` }, { status: 500 }));
        }
      };

      // Add to queue and try to process
      updateQueue.push(performUpdate);
      await randomBackoff(); // Random delay to prevent all requests hitting at once
      processUpdateQueue();

    } catch (error) {
      console.error('POST /api/metadata/index error:', error);
      resolve(NextResponse.json({ error: 'Failed to update metadata' }, { status: 500 }));
    }
  });
}
