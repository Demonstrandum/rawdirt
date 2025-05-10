import { NextRequest, NextResponse } from 'next/server';
import { ListObjectsV2Command, _Object, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { s3Client, ACCESS_POINT_ARN } from '@/config/aws';

const RAW_EXTENSIONS = ['.rw2', '.cr2', '.nef', '.arw', '.dng', '.orf', '.raf', '.pef', '.srw', '.raw'];
const MAX_FILES_TO_SCAN = 5000; // Safety limit to prevent too many API calls
const DEFAULT_PAGE_SIZE = 50;

// Keep track of all RAW files in memory (this resets on server restart)
let cachedRawFiles: _Object[] = [];
let cachedTotalRawFiles = 0;
let hasScannedBucket = false;

export async function GET(request: NextRequest) {
  try {
    console.log('S3 List API called with access point ARN:', ACCESS_POINT_ARN);

    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || '';
    const continuationToken = url.searchParams.get('continuationToken') || undefined;
    const countTotal = url.searchParams.get('countTotal') === 'true';

    // Direct pagination params
    const pageNumberParam = url.searchParams.get('pageNumber');
    const pageSizeParam = url.searchParams.get('pageSize');
    const pageNumber = pageNumberParam ? parseInt(pageNumberParam, 10) : 1;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : DEFAULT_PAGE_SIZE;

    console.log('Query params:', {
      prefix,
      continuationToken,
      countTotal,
      pageNumber,
      pageSize
    });

    // Check if we got our special "has-more" token which indicates this is a client-side paginated request
    if (continuationToken === 'has-more') {
      // If we have the special token and the cache is ready, we can serve from cache
      if (hasScannedBucket && cachedRawFiles.length > 0) {
        // Client wants next page from what it already has loaded
        // Here we'd need to know which page the client is on currently, but we don't track that
        // So instead, we'll just use the pageNumber parameter, which should work for our UI
        return respondWithPage(pageNumber, pageSize, prefix);
      } else {
        // We need to scan the bucket first
        await scanEntireBucket(prefix);
        return respondWithPage(pageNumber, pageSize, prefix);
      }
    }

    // If we have a page number and we've already scanned the bucket, we can use the cache
    if (pageNumber > 1 && hasScannedBucket && cachedRawFiles.length > 0) {
      console.log(`Using cached files for page ${pageNumber} (total: ${cachedRawFiles.length})`);
      return respondWithPage(pageNumber, pageSize, prefix);
    }

    // For first-time access or when the cache is empty, scan the entire bucket
    if ((pageNumber === 1 && countTotal) || !hasScannedBucket || cachedRawFiles.length === 0) {
      await scanEntireBucket(prefix);
      return respondWithPage(pageNumber, pageSize, prefix);
    }

    // Standard token-based pagination as a fallback for direct S3 tokens (not our "has-more" token)
    let allMatchingFiles: _Object[] = [];
    let currentContinuationToken = continuationToken;
    let isTruncated = true;
    let scannedCount = 0;
    const S3_MAX_KEYS_PER_REQUEST = 1000; // S3 returns max 1000 keys per request

    // Only continue if we have a real S3 token (not our special "has-more" token)
    // We will fetch from S3 and filter until we have enough files
    while (isTruncated && allMatchingFiles.length < pageSize && scannedCount < MAX_FILES_TO_SCAN) {
      const command = new ListObjectsV2Command({
        Bucket: ACCESS_POINT_ARN,
        Prefix: prefix,
        MaxKeys: S3_MAX_KEYS_PER_REQUEST,
        ContinuationToken: currentContinuationToken,
      });

      const response = await s3Client.send(command);
      const contentsLength = response.Contents?.length || 0;
      scannedCount += contentsLength;

      if (response.Contents) {
        const rawFilesFromPage = response.Contents.filter(item =>
          item.Key && RAW_EXTENSIONS.some(ext => item.Key!.toLowerCase().endsWith(ext))
        );
        allMatchingFiles.push(...rawFilesFromPage);
      }

      isTruncated = response.IsTruncated || false;
      currentContinuationToken = response.NextContinuationToken;

      // Break if we've reached enough files for this page or if there are no more files
      if (allMatchingFiles.length >= pageSize || !isTruncated || !currentContinuationToken) break;
    }

    // Slice to the requested page size for the current page
    const filesForCurrentPage = allMatchingFiles.slice(0, pageSize);
    const hasMoreFiles = isTruncated || allMatchingFiles.length > pageSize;

    console.log(`S3 response: ${filesForCurrentPage.length} RAW files for page, scanned ${scannedCount} S3 objects.`);
    console.log(`Total RAW files (cached): ${cachedTotalRawFiles}`);

    const transformedFiles = filesForCurrentPage.map(item => ({
      key: item.Key || '',
      size: item.Size || 0,
      lastModified: item.LastModified || new Date(),
    }));

    const result = {
      files: transformedFiles,
      nextContinuationToken: allMatchingFiles.length > pageSize ? 'has-more' : undefined,
      totalFilesFoundInScan: allMatchingFiles.length,
      hasMoreFilesAfterThisPage: allMatchingFiles.length > pageSize,
      grandTotalRawFiles: cachedTotalRawFiles || undefined,
      pageNumber: pageNumber,
      totalPages: Math.ceil(allMatchingFiles.length / pageSize)
    };

    return NextResponse.json(result);
  } catch (fetchError: any) {
    console.error('AWS S3 error:', fetchError);
    return NextResponse.json(
      {
        error: `Error fetching from S3: ${fetchError.message || 'Unknown error'}`,
        code: fetchError.Code || fetchError.code
      },
      { status: 500 }
    );
  }

  // Helper function to scan the entire bucket and cache results
  async function scanEntireBucket(prefix: string) {
    console.log('Scanning entire bucket for RAW files...');

    let allFiles: _Object[] = [];
    let nextToken: string | undefined;
    let isMore = true;
    let scanned = 0;

    // Loop until we've scanned the entire bucket or hit our limit
    while (isMore && scanned < MAX_FILES_TO_SCAN) {
      const scanCommand = new ListObjectsV2Command({
        Bucket: ACCESS_POINT_ARN,
        Prefix: prefix,
        MaxKeys: 1000, // Maximum allowed by S3
        ContinuationToken: nextToken,
      });

      const scanResponse = await s3Client.send(scanCommand);

      if (scanResponse.Contents && scanResponse.Contents.length > 0) {
        // Extract RAW files
        const rawFiles = scanResponse.Contents.filter(item =>
          item.Key && RAW_EXTENSIONS.some(ext => item.Key!.toLowerCase().endsWith(ext))
        );

        allFiles.push(...rawFiles);
        scanned += scanResponse.Contents.length;
      }

      isMore = scanResponse.IsTruncated || false;
      nextToken = scanResponse.NextContinuationToken;

      if (!isMore || !nextToken) break;
    }

    // Update our cache
    cachedRawFiles = allFiles;
    cachedTotalRawFiles = allFiles.length;
    hasScannedBucket = true;

    console.log(`Full bucket scan complete: found ${cachedRawFiles.length} RAW files`);
  }

  // Helper function to return paginated data from the cache
  function respondWithPage(page: number, pageSize: number, prefix: string) {
    const filteredFiles = prefix
      ? cachedRawFiles.filter(file => file.Key && file.Key.startsWith(prefix))
      : cachedRawFiles;

    const startIndex = (page - 1) * pageSize;
    const filesForPage = filteredFiles.slice(startIndex, startIndex + pageSize);

    console.log(`Serving page ${page} with ${filesForPage.length} files (start: ${startIndex})`);

    const transformedFiles = filesForPage.map(item => ({
      key: item.Key || '',
      size: item.Size || 0,
      lastModified: item.LastModified || new Date(),
    }));

    const result = {
      files: transformedFiles,
      nextContinuationToken: page * pageSize < filteredFiles.length ? 'has-more' : undefined,
      totalFilesFoundInScan: filteredFiles.length,
      hasMoreFilesAfterThisPage: page * pageSize < filteredFiles.length,
      grandTotalRawFiles: cachedTotalRawFiles,
      pageNumber: page,
      totalPages: Math.ceil(filteredFiles.length / pageSize)
    };

    return NextResponse.json(result);
  }
}
