import { RawFile } from '@/types';

// Singleton to hold the LibRaw instance
let libRawInstance: any = null;

/**
 * Process a RAW file to extract metadata and generate a thumbnail
 */
export async function processRawFile(
  file: RawFile,
  callbacks: {
    onProgress?: (stage: string, progress?: number) => void;
    onComplete?: (metadata: any) => void;
    onError?: (error: Error) => void;
    skipIndexUpdate?: boolean; // Add option to skip index update if needed
  } = {}
): Promise<{
  metadata: any;
  thumbnailDataUrl?: string;
  exifDate?: Date;
  dimensions?: { width: number; height: number; originalWidth?: number; originalHeight?: number };
  imageData?: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colors: number;
  };
}> {
  const { onProgress, onComplete, onError, skipIndexUpdate = false } = callbacks;

  try {
    // Load LibRaw if not already loaded
    if (!libRawInstance) {
      onProgress?.('Loading LibRaw...');
      const LibRawModule = await import('libraw-wasm');
      libRawInstance = LibRawModule.default;
    }

    // Ensure we have a URL to the file
    if (!file.url) {
      throw new Error('No URL available for the file');
    }

    // Fetch the file
    onProgress?.('Fetching file...');
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    // Get the file data as ArrayBuffer
    const imageArrayBuffer = await response.arrayBuffer();

    // Process with LibRaw
    onProgress?.('Decoding RAW file...');
    const rawProcessor = new libRawInstance();
    await rawProcessor.open(new Uint8Array(imageArrayBuffer));

    // Extract image data
    onProgress?.('Processing image data...');
    const decodedImage = await rawProcessor.imageData();
    if (!decodedImage || !decodedImage.data) {
      throw new Error('No image data from LibRaw');
    }

    // Extract metadata
    onProgress?.('Extracting metadata...');
    const metadata = await rawProcessor.metadata();
    console.log('[RAW Processor] Metadata:', metadata);

    // Process the timestamp correctly
    let exifDate: Date | undefined;
    if (metadata && metadata.timestamp) {
      const secondsSinceEpoch = metadata.timestamp.valueOf();
      const millisecondsSinceEpoch = secondsSinceEpoch * 1000;
      exifDate = new Date(millisecondsSinceEpoch);
      console.log('[RAW Processor] Extracted date:', exifDate.toISOString());
    }

    // Generate a thumbnail using an offscreen canvas
    onProgress?.('Generating thumbnail...');
    let thumbnailDataUrl: string | undefined;

    // Prepare image data for return - convert to RGBA if needed
    let processedImageData: Uint8ClampedArray;

    if (decodedImage.colors === 4) {
      // Already in RGBA format
      processedImageData = new Uint8ClampedArray(decodedImage.data);
    } else if (decodedImage.colors === 3) {
      // Convert RGB to RGBA
      const numPixels = decodedImage.width * decodedImage.height;
      processedImageData = new Uint8ClampedArray(numPixels * 4);
      for (let i = 0; i < numPixels; i++) {
        processedImageData[i * 4 + 0] = decodedImage.data[i * 3 + 0]; // R
        processedImageData[i * 4 + 1] = decodedImage.data[i * 3 + 1]; // G
        processedImageData[i * 4 + 2] = decodedImage.data[i * 3 + 2]; // B
        processedImageData[i * 4 + 3] = 255; // Alpha
      }
    } else {
      throw new Error(`Unsupported image color components: ${decodedImage.colors}`);
    }

    try {
      // First create a full-size canvas with the image data
      const offscreenCanvas = new OffscreenCanvas(decodedImage.width, decodedImage.height);
      const ctx = offscreenCanvas.getContext('2d');

      if (ctx) {
        // Create image data
        const imgData = new ImageData(processedImageData, decodedImage.width, decodedImage.height);
        ctx.putImageData(imgData, 0, 0);

        // Create a higher quality thumbnail - increased size for better quality
        const thumbSize = 240; // Increased from 120 for better quality
        const aspectRatio = decodedImage.width / decodedImage.height;
        let thumbWidth, thumbHeight;

        if (aspectRatio > 1) {
          // Landscape
          thumbWidth = thumbSize;
          thumbHeight = thumbSize / aspectRatio;
        } else {
          // Portrait or square
          thumbHeight = thumbSize;
          thumbWidth = thumbSize * aspectRatio;
        }

        // Create a thumbnail canvas
        const thumbCanvas = new OffscreenCanvas(thumbWidth, thumbHeight);
        const thumbCtx = thumbCanvas.getContext('2d');

        if (thumbCtx) {
          // Use high-quality interpolation
          thumbCtx.imageSmoothingEnabled = true;
          thumbCtx.imageSmoothingQuality = 'high';

          // Draw the main canvas onto the thumbnail canvas
          thumbCtx.drawImage(offscreenCanvas, 0, 0, thumbWidth, thumbHeight);

          // Convert to blob with higher quality
          const blob = await thumbCanvas.convertToBlob({
            type: 'image/jpeg',
            quality: 0.9  // Increased from 0.7 for better quality
          });

          // Convert blob to data URL
          thumbnailDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch (thumbErr) {
      console.warn('[RAW Processor] Failed to generate thumbnail:', thumbErr);
      // Continue without a thumbnail
    }

    // Prepare dimensions data
    const dimensions = {
      width: decodedImage.width,
      height: decodedImage.height,
      originalWidth: decodedImage.rawWidth || decodedImage.width,
      originalHeight: decodedImage.rawHeight || decodedImage.height
    };

    // Prepare final result
    const result = {
      metadata,
      thumbnailDataUrl,
      exifDate,
      dimensions,
      // Include the processed image data for display
      imageData: {
        data: processedImageData,
        width: decodedImage.width,
        height: decodedImage.height,
        colors: decodedImage.colors === 3 ? 4 : decodedImage.colors // We always convert to RGBA
      }
    };

    // Automatically update the S3 index unless explicitly skipped
    if (!skipIndexUpdate && file.key) {
      onProgress?.('Updating S3 index...');
      try {
        await updateS3Index(file.key, {
          exifDate: exifDate,
          thumbnailDataUrl: thumbnailDataUrl,
          width: dimensions.width,
          height: dimensions.height,
          originalWidth: dimensions.originalWidth,
          originalHeight: dimensions.originalHeight
        });
        console.log(`[RAW Processor] Successfully updated S3 index for ${file.key}`);
      } catch (indexErr) {
        console.warn(`[RAW Processor] Error updating S3 index for ${file.key}:`, indexErr);
        // Continue processing even if index update fails
      }
    }

    // Call onComplete callback with result
    onComplete?.(result);

    // Return the result
    return result;
  } catch (error) {
    console.error('[RAW Processor] Error processing file:', error);
    onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Update the S3 index with metadata for a file
 */
export async function updateS3Index(
  fileKey: string,
  metadata: {
    exifDate?: Date;
    thumbnailDataUrl?: string;
    width?: number;
    height?: number;
    originalWidth?: number;
    originalHeight?: number;
    [key: string]: any;
  }
) {
  try {
    console.log('[S3 INDEX] Sending metadata to API for:', fileKey, metadata);

    const requestBody = {
      fileKey,
      metadata: {
        ...metadata,
        // Convert Date objects to strings for JSON, with proper type checking
        exifDate: metadata.exifDate && metadata.exifDate instanceof Date && !isNaN(metadata.exifDate.getTime())
          ? metadata.exifDate.toISOString()
          : metadata.exifDate ? String(metadata.exifDate) : undefined,
      }
    };

    console.log('[S3 INDEX] API request body:', JSON.stringify(requestBody));

    const response = await fetch('/api/metadata/index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[S3 INDEX] API response not OK:', response.status, errorText);
      throw new Error(`Failed to update S3 index: ${errorText}`);
    }

    const responseData = await response.json();
    console.log('[S3 INDEX] API response:', responseData);

    return responseData;
  } catch (error) {
    console.error('[S3 INDEX] Error updating S3 index:', error);
    throw error;
  }
}

/**
 * Process multiple RAW files in sequence
 */
export async function batchProcessRawFiles(
  files: RawFile[],
  callbacks: {
    onStart?: (totalFiles: number) => void;
    onFileStart?: (file: RawFile, index: number, total: number) => void;
    onFileProgress?: (file: RawFile, stage: string, progress?: number) => void;
    onFileComplete?: (file: RawFile, result: any, index: number, total: number) => void;
    onFileError?: (file: RawFile, error: Error, index: number, total: number) => void;
    onBatchProgress?: (processed: number, total: number) => void;
    onBatchComplete?: (results: any[]) => void;
    onBatchError?: (error: Error) => void;
  } = {}
) {
  const {
    onStart,
    onFileStart,
    onFileProgress,
    onFileComplete,
    onFileError,
    onBatchProgress,
    onBatchComplete,
    onBatchError
  } = callbacks;

  const results: any[] = [];

  try {
    // Notify batch start
    onStart?.(files.length);

    // Process each file sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Skip files without URLs
      if (!file.url) {
        console.warn(`[Batch Processor] Skipping file without URL: ${file.key}`);
        continue;
      }

      // Notify file processing start
      onFileStart?.(file, i, files.length);

      try {
        // Process the file
        const result = await processRawFile(file, {
          onProgress: (stage, progress) => {
            onFileProgress?.(file, stage, progress);
          },
          onError: (error) => {
            onFileError?.(file, error, i, files.length);
          }
        });

        // Add to results
        results.push(result);

        // Notify file completion
        onFileComplete?.(file, result, i, files.length);

        // Notify batch progress
        onBatchProgress?.(i + 1, files.length);
      } catch (error) {
        console.error(`[Batch Processor] Error processing file ${i+1}/${files.length}: ${file.key}`, error);
        onFileError?.(file, error instanceof Error ? error : new Error(String(error)), i, files.length);
        // Continue with next file
      }
    }

    // Notify batch completion
    onBatchComplete?.(results);

    return results;
  } catch (error) {
    console.error('[Batch Processor] Batch processing error:', error);
    onBatchError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
