import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { AWS_REGION, BUCKET_NAME } from '@/config/aws';

const s3Client = new S3Client({ region: AWS_REGION });
const INDEX_FILE_KEY = 'metadata/index.json';

interface IndexFileStructure {
  version: number;
  files: Record<string, Partial<any>>;
  lastUpdated?: string;
  lastCleanup?: string;
}

/**
 * API route to run memory cleanup operations
 * This only checks the index size for reporting and DOES NOT remove thumbnails
 */
export async function POST(request: NextRequest) {
  console.log('[Cleanup API] Starting memory cleanup...');

  try {
    // Get current index to check size only
    let indexData: IndexFileStructure;

    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: INDEX_FILE_KEY,
      });

      console.time('[Cleanup API] Fetch index');
      const response = await s3Client.send(command);
      console.timeEnd('[Cleanup API] Fetch index');

      const str = await response.Body?.transformToString();

      if (!str) {
        return NextResponse.json({
          message: 'Index file is empty',
          success: false
        });
      }

      // Log index size
      const sizeInMB = str.length / 1024 / 1024;
      console.log(`[Cleanup API] Current index size: ${sizeInMB.toFixed(2)}MB`);

      indexData = JSON.parse(str) as IndexFileStructure;

      // Count files with thumbnails for reporting only
      const fileKeys = Object.keys(indexData.files);
      let filesWithThumbnails = 0;
      let thumbnailsSizeInMB = 0;

      fileKeys.forEach(key => {
        const fileData = indexData.files[key];
        if (fileData?.thumbnailDataUrl) {
          filesWithThumbnails++;
          // Estimate size (base64 size is about 4/3 of the binary size + header)
          const sizeInBytes = (fileData.thumbnailDataUrl.length - 22) / 4 * 3;
          thumbnailsSizeInMB += sizeInBytes / 1024 / 1024;
        }
      });

      console.log(`[Cleanup API] Found ${filesWithThumbnails} files with thumbnails, total size: ${thumbnailsSizeInMB.toFixed(2)}MB`);

      // Return stats without modifying anything
      return NextResponse.json({
        message: 'Memory cleanup complete',
        indexSize: sizeInMB.toFixed(2),
        thumbnailCount: filesWithThumbnails,
        thumbnailsSize: thumbnailsSizeInMB.toFixed(2),
        success: true
      });

    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        return NextResponse.json({
          message: 'Index file not found',
          success: false
        });
      } else {
        console.error('[Cleanup API] Error fetching index:', error);
        return NextResponse.json({
          error: `Failed to fetch index: ${error.message || 'Unknown error'}`,
          success: false
        }, { status: 500 });
      }
    }
  } catch (error) {
    console.error('[Cleanup API] Unexpected error during cleanup:', error);
    return NextResponse.json({
      error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      success: false
    }, { status: 500 });
  }
}
