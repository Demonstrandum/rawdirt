import { create } from 'zustand';
import { RawFile, RawFileMetadata, S3ListResponse } from '@/types';

interface RawFileFromIndex {
  s3LastModified?: string;
  size?: number;
  exifDate?: string;
  thumbnailS3Key?: string;
  thumbnailDataUrl?: string;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
}

interface RawdirtStore {
  // Files
  files: RawFile[];
  selectedFile: RawFile | null;
  isLoading: boolean;
  continuationToken?: string;
  totalRawFilesFound: number; // Total RAW files found from scans so far
  hasMoreFilesToLoad: boolean; // Indicates if backend suggests more pages
  currentPage: number; // For pagination UI
  grandTotalRawFiles: number; // Added this

  // Metadata map (key -> metadata)
  metadataMap: Record<string, RawFileMetadata>;

  // Metadata cache for files not in current view
  metadataCache: Record<string, Partial<RawFile>>;

  // Actions
  setFiles: (files: RawFile[], nextToken?: string, totalFoundInScan?: number, hasMore?: boolean, metadataMapForHydration?: Record<string, Partial<RawFileFromIndex>>) => void;
  appendFiles: (newFiles: RawFile[], nextToken?: string, totalAddedInScan?: number, hasMore?: boolean, metadataMapForHydration?: Record<string, Partial<RawFileFromIndex>>) => void;
  selectFile: (file: RawFile | null) => void;
  setLoading: (loading: boolean) => void;
  updateFileMetadata: (fileKey: string, metadataUpdates: Partial<Pick<RawFile, 'exifDate' | 'url' | 'thumbnailDataUrl' | 'thumbnailS3Key' | 'width' | 'height' | 'originalWidth' | 'originalHeight' | 'size' | 'lastModified'> & { otherMeta?: any }>) => void;
  incrementPage: () => void;
  resetPagination: () => void;
  setGrandTotalRawFiles: (total: number) => void; // Added this
  getCachedMetadata: (fileKey: string) => Partial<RawFile> | null; // Add method to retrieve cached metadata
}

// Helper function to hydrate a file with preloaded metadata
const hydrateFile = (file: RawFile, state: RawdirtStore, metadataMap?: Record<string, Partial<RawFileFromIndex>>): RawFile => {
  // First check if we have this file in our metadataCache
  const cachedMetadata = state.metadataCache[file.key];
  if (cachedMetadata) {
    console.log(`[Store] Using cached metadata for ${file.key}`);
    // Merge the cached metadata with the file
    return { ...file, ...cachedMetadata };
  }

  // Check local storage for thumbnail data
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localStorageKey = `rawdirt_thumb_${file.key}`;
      const localData = localStorage.getItem(localStorageKey);

      if (localData) {
        try {
          const localMetadata = JSON.parse(localData);
          console.log(`[Store] Using local storage metadata for ${file.key}`);

          // Merge with the file but prioritize any other sources over local storage
          const hydratedWithLocal = { ...file };

          // Apply local storage values only for fields that don't exist in the file
          if (!hydratedWithLocal.thumbnailDataUrl && localMetadata.thumbnailDataUrl) {
            hydratedWithLocal.thumbnailDataUrl = localMetadata.thumbnailDataUrl;
          }

          if (!hydratedWithLocal.exifDate && localMetadata.exifDate) {
            try {
              hydratedWithLocal.exifDate = new Date(localMetadata.exifDate);
            } catch (e) {
              console.error(`[Store] Error parsing exifDate from local storage: ${localMetadata.exifDate}`, e);
            }
          }

          if (!hydratedWithLocal.width && localMetadata.width) {
            hydratedWithLocal.width = localMetadata.width;
          }

          if (!hydratedWithLocal.height && localMetadata.height) {
            hydratedWithLocal.height = localMetadata.height;
          }

          if (!hydratedWithLocal.originalWidth && localMetadata.originalWidth) {
            hydratedWithLocal.originalWidth = localMetadata.originalWidth;
          }

          if (!hydratedWithLocal.originalHeight && localMetadata.originalHeight) {
            hydratedWithLocal.originalHeight = localMetadata.originalHeight;
          }

          return hydratedWithLocal;
        } catch (e) {
          console.error(`[Store] Error parsing local storage data for ${file.key}:`, e);
        }
      }
    }
  } catch (e) {
    console.warn('[Store] Error accessing localStorage:', e);
  }

  // Fall back to metadata from the index
  if (metadataMap && metadataMap[file.key]) {
    const indexedMeta = metadataMap[file.key];
    const hydratedFile: RawFile = { ...file };

    // Handle exifDate conversion from string to Date
    if (indexedMeta.exifDate) {
      try {
        const exifDate = new Date(indexedMeta.exifDate);
        if (!isNaN(exifDate.getTime())) {
          hydratedFile.exifDate = exifDate;
          console.log(`[Store] Hydrated exifDate for ${file.key}: ${hydratedFile.exifDate.toISOString()}`);
        } else {
          console.warn(`[Store] Invalid exifDate string from index: ${indexedMeta.exifDate}`);
        }
      } catch (e) {
        console.error(`[Store] Error parsing exifDate: ${indexedMeta.exifDate}`, e);
      }
    }

    if (indexedMeta.thumbnailDataUrl) hydratedFile.thumbnailDataUrl = indexedMeta.thumbnailDataUrl;
    if (indexedMeta.thumbnailS3Key) hydratedFile.thumbnailS3Key = indexedMeta.thumbnailS3Key;

    // s3LastModified and size usually come from the S3 listing directly, but can be overridden if index is more accurate
    if (indexedMeta.s3LastModified) {
      try {
        const s3Date = new Date(indexedMeta.s3LastModified);
        if (!isNaN(s3Date.getTime())) {
          hydratedFile.lastModified = s3Date;
        }
      } catch (e) {
        console.error(`[Store] Error parsing s3LastModified: ${indexedMeta.s3LastModified}`, e);
      }
    }

    if (indexedMeta.size) hydratedFile.size = indexedMeta.size;

    // Add width/height from index if available
    if (indexedMeta.width) (hydratedFile as any).width = indexedMeta.width;
    if (indexedMeta.height) (hydratedFile as any).height = indexedMeta.height;
    if (indexedMeta.originalWidth) (hydratedFile as any).originalWidth = indexedMeta.originalWidth;
    if (indexedMeta.originalHeight) (hydratedFile as any).originalHeight = indexedMeta.originalHeight;

    return hydratedFile;
  }
  return file;
};

const useStore = create<RawdirtStore>((set, get) => ({
  // Initial state
  files: [],
  selectedFile: null,
  isLoading: false,
  continuationToken: undefined,
  totalRawFilesFound: 0,
  hasMoreFilesToLoad: true,
  currentPage: 1,
  grandTotalRawFiles: 0,
  metadataMap: {},
  metadataCache: {},

  // Actions
  setFiles: (files, nextToken, totalFoundInScan, hasMore, metadataMapForHydration) => set(state => ({
    files: files.map(file => hydrateFile(file, state, metadataMapForHydration)),
    selectedFile: null,
    continuationToken: nextToken,
    totalRawFilesFound: totalFoundInScan !== undefined ? totalFoundInScan : 0,
    hasMoreFilesToLoad: hasMore !== undefined ? hasMore : true,
    currentPage: 1
  })),

  appendFiles: (newFiles, nextToken, totalAddedInScan, hasMore, metadataMapForHydration) => set(state => {
    console.log('[Store] appendFiles called:', {
      existing: state.files.length,
      newFiles: newFiles.length,
      currentPage: state.currentPage,
      hasMore
    });

    return {
      files: [...state.files, ...newFiles.map(file => hydrateFile(file, state, metadataMapForHydration))],
      continuationToken: nextToken,
      totalRawFilesFound: state.files.length + newFiles.length,
      hasMoreFilesToLoad: hasMore !== undefined ? hasMore : true,
      // Don't increment page here since that should be done separately with incrementPage()
    };
  }),

  selectFile: (file) => set({ selectedFile: file }),

  setLoading: (loading) => set({ isLoading: loading }),

  updateFileMetadata: (fileKey, metadataUpdates) => set(state => {
    console.log('[Store] Updating file metadata for:', fileKey, 'with updates:', metadataUpdates);

    // Ensure dates are properly handled
    if (metadataUpdates.exifDate) {
      console.log('[Store] Processing exifDate:', metadataUpdates.exifDate,
                  'type:', typeof metadataUpdates.exifDate,
                  'isValid:', metadataUpdates.exifDate instanceof Date ? !isNaN(metadataUpdates.exifDate.getTime()) : 'n/a');

      // Make sure it's a valid Date object
      if (!(metadataUpdates.exifDate instanceof Date) || isNaN(metadataUpdates.exifDate.getTime())) {
        console.warn('[Store] Invalid exifDate - attempting to create valid Date object');
        try {
          if (typeof metadataUpdates.exifDate === 'string') {
            metadataUpdates.exifDate = new Date(metadataUpdates.exifDate);
          } else {
            // If it's not a string or Date, convert to string then to Date
            metadataUpdates.exifDate = new Date(String(metadataUpdates.exifDate));
          }
          console.log('[Store] Converted exifDate to:', metadataUpdates.exifDate);
        } catch (e) {
          console.error('[Store] Failed to convert exifDate:', e);
          delete metadataUpdates.exifDate; // Remove invalid date
        }
      }
    }

    const fileIndex = state.files.findIndex(f => f.key === fileKey);
    let newFiles = [...state.files];
    let newSelectedFile = state.selectedFile;
    let newMetadataCache = { ...state.metadataCache };

    if (fileIndex !== -1) {
      newFiles[fileIndex] = { ...newFiles[fileIndex], ...metadataUpdates };
      if (state.selectedFile?.key === fileKey) {
        newSelectedFile = { ...state.selectedFile, ...metadataUpdates };
      }
      console.log('[Store] Updated file in state, new file data:', newFiles[fileIndex]);
    } else {
      // File not in current state (likely from another page) - update metadataCache
      console.log(`[Store] File not currently in state (may be on another page): ${fileKey}`);

      // Store in metadata cache
      newMetadataCache[fileKey] = {
        ...newMetadataCache[fileKey],
        ...metadataUpdates,
        key: fileKey, // Ensure the key is set
      };

      console.log(`[Store] Added/updated metadata in cache for: ${fileKey}`);
    }

    return {
      files: newFiles,
      selectedFile: newSelectedFile,
      metadataCache: newMetadataCache
    };
  }),

  incrementPage: () => set(state => ({ currentPage: state.currentPage + 1 })),
  resetPagination: () => set(state => ({
    currentPage: 1,
    continuationToken: undefined,
    files: [],
    totalRawFilesFound: 0,
    hasMoreFilesToLoad: true,
    grandTotalRawFiles: state.grandTotalRawFiles,
  })),

  setGrandTotalRawFiles: (total) => set({ grandTotalRawFiles: total }),

  getCachedMetadata: (fileKey) => get().metadataCache[fileKey] || null,
}));

export default useStore;
