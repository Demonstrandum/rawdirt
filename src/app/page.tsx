'use client';

import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { RawFile, S3ListResponse } from '@/types';
import useStore from '@/store/useStore';
import FileBrowser from '@/components/FileBrowser';
import RawImageViewer from '@/components/RawImageViewer';
import MetadataEditor from '@/components/MetadataEditor';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
import MemoryCleanupButton from '@/components/MemoryCleanupButton';

// Define these types here if not already in @/types and imported
interface RawFileFromIndex { // Duplicating from API route for now, ideally share from @/types
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
interface IndexFileStructure { // Duplicating from API route for now, ideally share from @/types
  version: number;
  files: Record<string, Partial<RawFileFromIndex>>;
  totalRawFiles?: number;
}

// Create theme
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

export default function Home() {
  const {
    selectedFile,
    isLoading,
    continuationToken,
    setFiles,
    appendFiles,
    selectFile,
    setLoading,
    updateFileMetadata,
    incrementPage,
    resetPagination
  } = useStore();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [preloadedMetadataMap, setPreloadedMetadataMap] = useState<Record<string, Partial<RawFileFromIndex>>>({});

  const fetchFiles = useCallback(async (prefix: string = '', suppliedContinuationToken?: string, metadataMapForHydration?: Record<string, Partial<RawFileFromIndex>>) => {
    setLoading(true);
    try {
      const tokenToUse = prefix ? undefined : (suppliedContinuationToken || continuationToken);
      const isInitialLoad = !tokenToUse && !prefix;

      const params = new URLSearchParams();
      if (prefix) params.append('prefix', prefix);
      if (tokenToUse) params.append('continuationToken', tokenToUse);

      // Request total file count on initial load
      if (isInitialLoad) {
        params.append('countTotal', 'true');
      }

      const response = await fetch(`/api/s3/list?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch S3 file list');
      const data: S3ListResponse = await response.json();

      const mapToUse = metadataMapForHydration || preloadedMetadataMap;

      console.log('[App Page] Fetch files response:', {
        filesCount: data.files.length,
        hasMoreFiles: data.hasMoreFilesAfterThisPage,
        totalFoundInScan: data.totalFilesFoundInScan,
        nextToken: data.nextContinuationToken ? 'Has token' : 'No token',
        currentPage: useStore.getState().currentPage,
        grandTotalRawFiles: data.grandTotalRawFiles
      });

      // Update the grand total from API if available
      if (data.grandTotalRawFiles && data.grandTotalRawFiles > 0) {
        useStore.getState().setGrandTotalRawFiles(data.grandTotalRawFiles);
      }

      // Force hasMoreFiles to true if we have files and data.nextContinuationToken exists
      const forceHasMore = data.files.length > 0 && !!data.nextContinuationToken;

      if (tokenToUse && !prefix) {
        appendFiles(data.files, data.nextContinuationToken, data.totalFilesFoundInScan, forceHasMore || data.hasMoreFilesAfterThisPage, mapToUse);
      } else {
        setFiles(data.files, data.nextContinuationToken, data.totalFilesFoundInScan, forceHasMore || data.hasMoreFilesAfterThisPage, mapToUse);
      }

      // Ensure grandTotalRawFiles is set to at least the total files we have, if not already higher
      const currentGrandTotal = useStore.getState().grandTotalRawFiles;
      const currentTotalFiles = useStore.getState().files.length;
      if (currentGrandTotal < currentTotalFiles) {
        useStore.getState().setGrandTotalRawFiles(currentTotalFiles);
      }
    } catch (error) {
      console.error('Error in fetchFiles:', error);
    } finally {
      setLoading(false);
    }
  }, [setLoading, continuationToken, appendFiles, setFiles, preloadedMetadataMap]);

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      let initialMetadataMap: Record<string, Partial<RawFileFromIndex>> = {};
      try {
        const indexRes = await fetch('/api/metadata/index');
        if (indexRes.ok) {
          const s3Index: IndexFileStructure = await indexRes.json();
          console.log('[App Page] Loaded metadata/index.json from S3 on mount:', s3Index);
          initialMetadataMap = s3Index.files || {};
          setPreloadedMetadataMap(initialMetadataMap);
          if (typeof s3Index.totalRawFiles === 'number') {
            useStore.getState().setGrandTotalRawFiles(s3Index.totalRawFiles);
          }
        }
        await fetchFiles('', undefined, initialMetadataMap);
      } catch (error) {
        console.error('[App Page] Error loading initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    console.log('[App Page] Initial load useEffect running.');
    loadInitialData();

    return () => {
      console.log('[App Page] Initial load useEffect cleanup. Resetting pagination.');
      resetPagination();
    };
  // Force this useEffect to run only once on mount.
  // setLoading, resetPagination are stable store actions.
  // fetchFiles is useCallback memoized; its own changes shouldn't re-trigger this specific mount effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // EMPTY DEPENDENCY ARRAY

  useEffect(() => {
    if (selectedFile?.key && !selectedFile.url) {
      console.log(`[App Page] selectedFile changed or URL missing, fetching URL for: ${selectedFile.key}`);
      getFileUrl(selectedFile.key);
    } else if (!selectedFile) {
      setFileUrl(null);
    }
  }, [selectedFile?.key, selectedFile?.url]);

  const getFileUrl = async (key: string) => {
    try {
      console.log(`[App Page] getFileUrl called for key: ${key}`);
      const params = new URLSearchParams();
      params.append('key', key);
      const response = await fetch(`/api/s3/file?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to get file URL');
      const data = await response.json();

      setFileUrl(data.url);

      updateFileMetadata(key, { url: data.url });
      console.log(`[App Page] URL fetched and set for ${key}: ${data.url}`);

    } catch (error) {
      console.error('Error getting file URL:', error);
      setFileUrl(null);
    }
  };

  const handleSelectFile = (file: RawFile) => {
    selectFile(file);
  };

  const handleLoadMoreFiles = () => {
    if (continuationToken) {
      incrementPage();
      fetchFiles('', continuationToken);
    }
  };

  const handleNavigateToPage = async (page: number): Promise<void> => {
    console.log(`[Page] handleNavigateToPage called for page ${page}, current page is ${useStore.getState().currentPage}`);

    // Don't do anything if we're already on this page
    if (page === useStore.getState().currentPage) {
      console.log(`[Page] Already on page ${page}, ignoring navigation`);
      return;
    }

    setLoading(true);

    try {
      // DIRECT APPROACH: Always reset and fetch the specific page directly with a new API parameter
      // This avoids token-based incremental navigation entirely

      resetPagination(); // Clear current state

      // Calculate number of items to skip based on page number
      const pageSize = 50; // Match the backend's per-page size
      const skip = (page - 1) * pageSize;

      console.log(`[Page] Directly fetching page ${page} (skip=${skip}, limit=${pageSize})`);

      // Add new parameters to the API to support direct page access
      const url = `/api/s3/list?pageNumber=${page}&pageSize=${pageSize}&countTotal=true`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch page ${page}`);
      }

      const data = await response.json();
      console.log(`[Page] Received data for page ${page}:`, {
        fileCount: data.files.length,
        hasMore: data.hasMoreFilesAfterThisPage,
        totalInScan: data.totalFilesFoundInScan,
      });

      // Force the page number
      setFiles(data.files, data.nextContinuationToken, data.totalFilesFoundInScan, data.hasMoreFilesAfterThisPage, preloadedMetadataMap);

      // Set the right page number
      for (let i = 1; i < page; i++) {
        useStore.getState().incrementPage();
      }

      // Update grand total if available
      if (data.grandTotalRawFiles) {
        useStore.getState().setGrandTotalRawFiles(data.grandTotalRawFiles);
      }

      console.log(`[Page] Successfully navigated to page ${page}`);
    } catch (error) {
      console.error(`[Page] Error navigating to page ${page}:`, error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Container maxWidth={false} disableGutters sx={{ height: '100vh', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          <Box component="header" sx={{ p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.12)' }}>
            <Typography variant="h4" component="h1">
              Rawdirt
            </Typography>
            <Typography variant="subtitle1">
              Browser for .RW2 Raw Files
            </Typography>
            <Box sx={{ mt: 1 }}>
              <MemoryCleanupButton />
            </Box>
          </Box>

          <SyncStatusIndicator />

          <Box component="main" sx={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {/* File Browser */}
            <Box sx={{ width: { xs: '100%', md: '25%' }, height: '100%', borderRight: '1px solid rgba(255, 255, 255, 0.12)' }}>
              <FileBrowser
                onSelectFile={handleSelectFile}
                onFetchFiles={fetchFiles}
                onLoadMore={handleLoadMoreFiles}
                onNavigateToPage={handleNavigateToPage}
              />
            </Box>

            {/* Main Content */}
            <Box sx={{ width: { xs: '100%', md: '50%' }, height: '100%', display: { xs: 'none', md: 'block' } }}>
              {!selectedFile ? (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    p: 3,
                    textAlign: 'center'
                  }}
                >
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    Select a raw file to view
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Your .RW2 files will be displayed here
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ height: '100%', position: 'relative' }}>
                  {selectedFile.url ? (
                    <RawImageViewer file={selectedFile} />
                  ) : (
                    <Box sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%'
                    }}>
                      <CircularProgress />
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            {/* Metadata Panel */}
            <Box sx={{ width: { xs: '100%', md: '25%' }, height: '100%', borderLeft: '1px solid rgba(255, 255, 255, 0.12)', display: { xs: 'none', md: 'block' } }}>
              {selectedFile ? (
                <MetadataEditor file={selectedFile} />
              ) : (
                <Box sx={{
                  p: 3,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Typography variant="body2" color="text.secondary">
                    Select a file to edit metadata
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Container>
    </ThemeProvider>
  );
}
