export interface RawFile {
  key: string;
  size: number;
  lastModified: Date; // S3 Last Modified Date
  exifDate?: Date;    // Actual capture date from EXIF (to be added)
  url?: string;       // Optional: for pre-signed URL if fetched
  thumbnailDataUrl?: string; // For client-generated thumbnail preview
  thumbnailS3Key?: string; // For persistent S3 thumbnail (Phase 2)
  width?: number;          // Processed image width (could be halfSize)
  height?: number;         // Processed image height
  originalWidth?: number;  // Original width from RAW metadata
  originalHeight?: number; // Original height from RAW metadata
  metadata?: RawFileMetadata;
}

export interface RawFileMetadata {
  id: string;
  title?: string;
  description?: string;
  tags: string[];
  location?: {
    latitude?: number;
    longitude?: number;
    locationName?: string;
  };
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

// This type is for the data stored in the S3 index.json file for each file key.
// Ensure it includes all fields you intend to store and retrieve from the index.
export interface RawFileFromIndex {
  s3LastModified?: string; // ISO string format
  size?: number;
  exifDate?: string;     // ISO string format
  thumbnailS3Key?: string; // Key to a permanent S3 thumbnail (e.g., 'thumbnails/path/to/thumb.jpg')
  thumbnailDataUrl?: string; // Temporary client-generated base64 data URL (optional to store in index long-term)
  width?: number;          // Processed image width (at the time of this metadata snapshot)
  height?: number;         // Processed image height
  originalWidth?: number;  // True original width from RAW metadata
  originalHeight?: number; // True original height from RAW metadata
  // Add any other fields you deem necessary for the index
}

export interface IndexFileStructure {
  version: number;
  files: Record<string, Partial<RawFileFromIndex>>; // file.key is the Record key
  totalRawFiles?: number; // Optional: if you implement a way to count all RAW files
}

export interface S3ListResponse {
  files: RawFile[];
  nextContinuationToken?: string;
  totalFilesFoundInScan?: number; // Total RAW files found in the current scan operation
  hasMoreFilesAfterThisPage?: boolean;
  grandTotalRawFiles?: number; // Total RAW files in the bucket (if counted)
}
