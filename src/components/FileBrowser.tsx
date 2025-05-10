'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Divider,
  CircularProgress,
  Button,
  TextField,
  InputAdornment,
  Chip,
  Pagination,
  Skeleton,
  LinearProgress
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { RawFile } from '@/types';
import useStore from '@/store/useStore';
import { batchProcessRawFiles, processRawFile, updateS3Index } from '@/utils/rawProcessor';
import { RawWorkerPool, ActiveTask, WorkerCallbacks } from '@/utils/rawWorker';

interface FileBrowserProps {
  onSelectFile: (file: RawFile) => void;
  onFetchFiles: (prefix?: string, continuationToken?: string) => Promise<void>;
  onLoadMore: () => void;
  onNavigateToPage?: (page: number) => void;
}

const FileBrowser = ({ onSelectFile, onFetchFiles, onLoadMore, onNavigateToPage }: FileBrowserProps) => {
  const {
    files,
    selectedFile,
    isLoading,
    totalRawFilesFound,
    hasMoreFilesToLoad,
    currentPage,
    grandTotalRawFiles,
    resetPagination,
    updateFileMetadata
  } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredFiles, setFilteredFiles] = useState<RawFile[]>(files);
  const [jumpToPage, setJumpToPage] = useState<string>('');
  const [localLoading, setLocalLoading] = useState(false);
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [isProcessingComplete, setIsProcessingComplete] = useState(false);
  const [workerPool, setWorkerPool] = useState<RawWorkerPool | null>(null);
  const [processingStats, setProcessingStats] = useState({
    processed: 0,
    total: 0,
    currentFile: '',
    currentStage: '',
    currentPage: 0,
    startTime: 0,
    errors: 0
  });
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [workerStates, setWorkerStates] = useState<{
    [workerId: number]: {
      id: number;
      isActive: boolean;
      currentFile: string | null;
      stage: string;
      startTime: number;
      completedFiles: number;
    }
  }>({});
  const [queueBuilt, setQueueBuilt] = useState(false);
  const isPageLoading = isLoading || localLoading;

  useEffect(() => {
    // Filter files based on search term or display all if no term
    if (searchTerm.trim() === '') {
      setFilteredFiles(files);
    } else {
      const lowerCaseSearch = searchTerm.toLowerCase();
      const filtered = files.filter(file =>
        file.key.toLowerCase().includes(lowerCaseSearch)
      );
      setFilteredFiles(filtered);
    }
  }, [files, searchTerm]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    // Optional: Debounce search or trigger onFetchFiles with prefix if backend supports it well
    // For now, filtering is client-side on already loaded files.
    // To search backend: onFetchFiles(event.target.value, undefined); // This would reset pagination
  };

  const formatDate = (dateInput?: Date) => {
    if (!dateInput) return 'N/A';
    const date = new Date(dateInput);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const displayedFileCount = filteredFiles.length;
  const ITEMS_PER_PAGE_APPROX = 50;

  // Ensure we have at least 1 page if there are files
  const calculatedTotalPages = grandTotalRawFiles > 0 && ITEMS_PER_PAGE_APPROX > 0
    ? Math.ceil(grandTotalRawFiles / ITEMS_PER_PAGE_APPROX)
    : 0;

  // Force at least 1 page if we have files
  const totalPages = files.length > 0 ? Math.max(1, calculatedTotalPages) : calculatedTotalPages;

  // Debug pagination values
  useEffect(() => {
    console.log('FileBrowser - Pagination Debug:', {
      totalPages,
      currentPage,
      grandTotalRawFiles,
      ITEMS_PER_PAGE_APPROX,
      hasMoreFilesToLoad,
      files: files.length,
      filtered: filteredFiles.length
    });
  }, [totalPages, currentPage, grandTotalRawFiles, files.length, filteredFiles.length, hasMoreFilesToLoad]);

  const handleGoToFirstPage = () => {
    console.log('[FileBrowser] Go to First Page clicked');
    resetPagination();
    onFetchFiles('', undefined);
  };

  const handlePageChange = (event: React.ChangeEvent<unknown>, page: number) => {
    console.log(`[FileBrowser] Page change requested to page ${page} from ${currentPage}`);

    // Don't do anything if we're already on this page or if loading
    if (page === currentPage || isLoading) {
      console.log(`[FileBrowser] Already on page ${page} or loading, ignoring change`);
      return;
    }

    // Use local state to set a loading indicator immediately
    setLocalLoading(true);

    if (onNavigateToPage) {
      console.log(`[FileBrowser] Using onNavigateToPage handler to navigate to page ${page}`);
      // Run the navigation asynchronously
      Promise.resolve(onNavigateToPage(page))
        .catch(err => console.error('Navigation error:', err))
        .finally(() => {
          setLocalLoading(false);
        });
    } else if (page === 1) {
      // Default fallback for first page if onNavigateToPage not provided
      console.log(`[FileBrowser] No onNavigateToPage handler, using handleGoToFirstPage`);
      handleGoToFirstPage();
      setLocalLoading(false);
    } else if (page > currentPage) {
      // Default fallback for next pages if onNavigateToPage not provided
      console.log(`[FileBrowser] No onNavigateToPage handler, using onLoadMore to move to next page`);
      onLoadMore();
      setLocalLoading(false);
    } else {
      console.log(`[FileBrowser] No handler available for this page navigation`);
      setLocalLoading(false);
    }
  };

  const handleJumpToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpToPage, 10);
    if (!isNaN(pageNum) && pageNum > 0 && pageNum <= totalPages) {
      handlePageChange(null as any, pageNum);
      setJumpToPage('');
    }
  };

  // Calculate item range displayed (e.g., "Items 1-50 of 603")
  const startItem = (currentPage - 1) * ITEMS_PER_PAGE_APPROX + 1;
  const endItem = Math.min(startItem + files.length - 1, grandTotalRawFiles);
  const itemRangeText = grandTotalRawFiles > 0
    ? `${startItem}-${endItem} of ${grandTotalRawFiles}`
    : (files.length > 0 ? `Showing ${files.length} items` : 'No items');

  const startAutoProcessing = async () => {
    if (autoProcessing) return;

    // Confirm with user - this can take a long time
    if (!confirm('This will process all RAW files and may take a significant amount of time. Continue?')) {
      return;
    }

    // Reset stats and set processing flags
    setProcessingStats({
      processed: 0,
      total: grandTotalRawFiles,
      currentFile: '',
      currentStage: 'Initializing...',
      currentPage: 1,
      startTime: Date.now(),
      errors: 0
    });
    setActiveTasks([]);
    setIsProcessingComplete(false);
    setQueueBuilt(false);

    // Start processing
    setAutoProcessing(true);

    try {
      // Start loading files
      console.log("Starting batch processing - loading files first");

      // We need to gather all files by going through the pages
      const allFiles: RawFile[] = [];

      // Start from first page
      resetPagination();
      await onFetchFiles('', undefined);
      allFiles.push(...files);

      // Continue loading all pages
      let currentPageNum = 1;
      const totalPagesToLoad = Math.ceil(grandTotalRawFiles / 50);

      setProcessingStats(prev => ({
        ...prev,
        currentStage: `Loading files (page 1/${totalPagesToLoad})...`,
        total: grandTotalRawFiles // Use the known total from the start
      }));

      while (hasMoreFilesToLoad && useStore.getState().continuationToken) {
        currentPageNum++;

        setProcessingStats(prev => ({
          ...prev,
          currentStage: `Loading page ${currentPageNum}/${totalPagesToLoad}...`,
        }));

        try {
          // Load next page - directly using API to avoid UI state complications
          const pageParams = new URLSearchParams();
          pageParams.append('pageNumber', String(currentPageNum));
          pageParams.append('pageSize', '50');
          pageParams.append('countTotal', 'true');

          const pageResponse = await fetch(`/api/s3/list?${pageParams.toString()}`);

          if (!pageResponse.ok) {
            console.error(`Failed to load page ${currentPageNum}: ${pageResponse.statusText}`);
            setProcessingStats(prev => ({
              ...prev,
              currentStage: `Error loading page ${currentPageNum}: ${pageResponse.statusText}`,
              errors: prev.errors + 1
            }));
            continue; // Try next page
          }

          const pageData = await pageResponse.json();

          // Add files from this page
          if (pageData.files && Array.isArray(pageData.files)) {
            allFiles.push(...pageData.files);

            setProcessingStats(prev => ({
              ...prev,
              currentPage: currentPageNum,
              currentStage: `Loaded ${allFiles.length}/${grandTotalRawFiles} files...`
            }));
          }

          // Check if we need to continue
          if (!pageData.hasMoreFilesAfterThisPage) {
            break;
          }
        } catch (error) {
          console.error(`Error loading page ${currentPageNum}:`, error);
          setProcessingStats(prev => ({
            ...prev,
            errors: prev.errors + 1,
            currentStage: `Error on page ${currentPageNum}: ${error instanceof Error ? error.message : String(error)}`
          }));
        }

        // Prevent infinite loops
        if (currentPageNum >= totalPagesToLoad + 5) {
          console.warn('Too many pages loaded, stopping to prevent infinite loop');
          break;
        }
      }

      console.log(`Loaded ${allFiles.length} files from ${currentPageNum} pages for processing`);

      // Update the total to what we actually loaded
      setProcessingStats(prev => ({
        ...prev,
        total: allFiles.length,
        currentStage: `Loaded ${allFiles.length} files. Preparing for processing...`,
      }));

      // Now we need to ensure all files have URLs
      // First, for already selected files
      const filesWithUrls = allFiles.filter(file => file.url);
      const filesNeedingUrls = allFiles.filter(file => !file.url);

      if (filesNeedingUrls.length > 0) {
        setProcessingStats(prev => ({
          ...prev,
          currentStage: `Fetching URLs for ${filesNeedingUrls.length} files...`,
        }));

        // Get URLs for files that don't have them - create batches to avoid too many concurrent requests
        const urlBatchSize = 10;
        for (let i = 0; i < filesNeedingUrls.length; i += urlBatchSize) {
          const batch = filesNeedingUrls.slice(i, i + urlBatchSize);

          setProcessingStats(prev => ({
            ...prev,
            currentStage: `Fetching URLs (${i+1}-${Math.min(i+urlBatchSize, filesNeedingUrls.length)}/${filesNeedingUrls.length})...`,
          }));

          // Process this batch in parallel
          await Promise.all(batch.map(async (file, batchIndex) => {
            try {
              const params = new URLSearchParams();
              params.append('key', file.key);
              const response = await fetch(`/api/s3/file?${params.toString()}`);
              if (response.ok) {
                const data = await response.json();
                file.url = data.url;
              } else {
                console.error(`Failed to get URL for ${file.key}`);
                setProcessingStats(prev => ({ ...prev, errors: prev.errors + 1 }));
              }
            } catch (e) {
              console.error(`Error fetching URL for ${file.key}:`, e);
              setProcessingStats(prev => ({ ...prev, errors: prev.errors + 1 }));
            }
          }));
        }
      }

      // Filter out files without URLs
      const filesToProcess = allFiles.filter(file => file.url);

      // Update total to match actual processable files
      setProcessingStats(prev => ({
        ...prev,
        total: filesToProcess.length,
        currentStage: 'Starting batch processing...',
      }));

      // Create a web worker for processing if supported
      if (typeof window !== 'undefined') {
        setProcessingStats(prev => ({
          ...prev,
          currentStage: 'Setting up worker pool...',
        }));

        try {
          // Create a worker pool with maximum concurrent workers
          const MAX_WORKERS = 6;
          const pool = new RawWorkerPool(MAX_WORKERS);
          setWorkerPool(pool);

          // DEBUG MODE - add this for debugging
          console.log("Worker pool created:", {
            autoProcessing: true,
            queueBuilt: false,
            isProcessingComplete: false,
            pool: !!pool
          });

          // Reset processing stats first to ensure clean state
          setProcessingStats(prev => ({
            ...prev,
            processed: 0,
            errors: 0,
            startTime: Date.now(),
            currentStage: 'Initializing worker pool...'
          }));

          // Initialize worker states for all workers
          const initialWorkerStates: {[key: number]: any} = {};
          for (let i = 0; i < MAX_WORKERS; i++) {
            initialWorkerStates[i] = {
              id: i,
              isActive: false,
              currentFile: null,
              stage: "Waiting for task...",
              startTime: Date.now(),
              completedFiles: 0
            };
          }
          setWorkerStates(initialWorkerStates);

          console.log(`Starting worker pool setup with ${MAX_WORKERS} workers`);

          // Update the worker pool callbacks
          const callbacks: WorkerCallbacks = {
            onWorkerStart: (workerId: number, fileKey: string) => {
              console.log(`Worker ${workerId} started processing ${fileKey}`);
              setWorkerStates(prev => {
                // Make sure worker state exists
                if (!prev[workerId]) {
                  prev[workerId] = {
                    id: workerId,
                    isActive: false,
                    currentFile: null,
                    stage: "Waiting for task...",
                    startTime: Date.now(),
                    completedFiles: 0
                  };
                }

                return {
                  ...prev,
                  [workerId]: {
                    ...prev[workerId],
                    isActive: true,
                    currentFile: fileKey,
                    stage: "Starting...",
                    startTime: Date.now(),
                  }
                };
              });
            },
            onWorkerProgress: (workerId: number, fileKey: string, stage: string) => {
              console.log(`Worker ${workerId} progress for ${fileKey}: ${stage}`);
              setWorkerStates(prev => {
                // Make sure worker state exists
                if (!prev[workerId]) {
                  prev[workerId] = {
                    id: workerId,
                    isActive: true,
                    currentFile: fileKey,
                    stage: stage,
                    startTime: Date.now(),
                    completedFiles: 0
                  };
                  return {
                    ...prev,
                    [workerId]: prev[workerId]
                  };
                }

                return {
                  ...prev,
                  [workerId]: {
                    ...prev[workerId],
                    stage: stage,
                    currentFile: fileKey,
                    isActive: true
                  }
                };
              });
            },
            onWorkerComplete: (workerId: number, fileKey: string, error: string | null) => {
              console.log(`Worker ${workerId} completed ${fileKey}`);
              setWorkerStates(prev => {
                // Make sure the worker state exists
                if (!prev[workerId]) {
                  // Create a new worker state if it doesn't exist
                  prev[workerId] = {
                    id: workerId,
                    isActive: false,
                    currentFile: null,
                    stage: "Completed",
                    startTime: Date.now(),
                    completedFiles: 0
                  };
                }

                // Now safely update the existing or new worker state
                return {
                  ...prev,
                  [workerId]: {
                    ...prev[workerId],
                    completedFiles: (prev[workerId].completedFiles || 0) + 1,
                    isActive: false,
                    stage: error ? `Error: ${error}` : "Completed",
                    currentFile: null
                  }
                };
              });
            },
            onActiveTasksChange: (tasks) => {
              console.log(`Active tasks changed: ${tasks.length} workers active`);
              setActiveTasks(tasks);
            }
          };

          // Update the worker pool setup with the properly typed callbacks
          pool.setCallbacks(callbacks);

          // Fix the completion handler to properly update UI
          let processedCount = 0;
          pool.setCompletionHandler((fileKey, result, error) => {
            processedCount++;
            console.log(`File completed: ${fileKey}, processed: ${processedCount}/${filesToProcess.length}`);

            // Update progress in UI
            setProcessingStats(prev => ({
              ...prev,
              processed: processedCount,
              currentStage: error
                ? `Error on ${fileKey}: ${error}`
                : `Completed ${processedCount}/${filesToProcess.length}`,
            }));

            // Update file metadata if we have a result
            if (result) {
              updateFileMetadata(fileKey, {
                exifDate: result.exifDate,
                thumbnailDataUrl: result.thumbnailDataUrl,
                width: result.dimensions?.width,
                height: result.dimensions?.height,
                originalWidth: result.dimensions?.originalWidth,
                originalHeight: result.dimensions?.originalHeight,
              });
            }
          });

          // Filter out files without URLs
          const validFiles = filesToProcess.filter(file => !!file.url);

          // Set the total count based on valid files
          setProcessingStats(prev => ({
            ...prev,
            total: validFiles.length,
            currentStage: `Queueing ${validFiles.length} files for processing...`,
          }));

          // Add all files to the queue
          const filesToQueue = validFiles.map(file => ({
            key: file.key,
            url: file.url!
          }));

          // Queue all files
          console.log(`Queueing ${filesToQueue.length} files for processing`);

          // Mark the queue as built BEFORE it starts processing
          setQueueBuilt(true);

          // Queue all files
          pool.addFiles(filesToQueue);

          // Important: Only set autoProcessing to false when all processing is done
          pool.processAllQueued()
            .then(results => {
              console.log(`All files processed: ${results.length} results`);
              setProcessingStats(prev => ({
                ...prev,
                currentStage: 'All files processed successfully',
              }));
              // Mark processing as complete first
              setIsProcessingComplete(true);
              // Only set autoProcessing to false after a delay to show completion
              setTimeout(() => {
                setAutoProcessing(false);
                setQueueBuilt(false);
              }, 3000); // Show completion for 3 seconds
            })
            .catch(error => {
              console.error('Error during batch processing:', error);
              setProcessingStats(prev => ({
                ...prev,
                currentStage: `Error during batch processing: ${error}`,
              }));
              // Mark processing as complete
              setIsProcessingComplete(true);
              // Only set autoProcessing to false after a delay to show completion
              setTimeout(() => {
                setAutoProcessing(false);
                setQueueBuilt(false);
              }, 3000); // Show error for 3 seconds
            });
        } catch (error) {
          console.error('Error setting up worker pool:', error);
          setProcessingStats(prev => ({
            ...prev,
            currentStage: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }));
          setAutoProcessing(false);
          setQueueBuilt(false);
        }
      } else {
        // Fallback to regular processing if workers aren't supported
        await batchProcessRawFiles(filesToProcess, {
          onStart: (total) => {
            console.log(`Starting batch processing of ${total} files`);
            // Make sure we're showing the correct total here too
            setProcessingStats(prev => ({
              ...prev,
              total: total,
              currentStage: `Starting batch processing of ${total} files...`,
            }));
          },
          onFileStart: (file, index, total) => {
            setProcessingStats(prev => ({
              ...prev,
              currentFile: file.key,
              currentStage: 'Starting processing...',
            }));
          },
          onFileProgress: (file, stage, progress) => {
            setProcessingStats(prev => ({
              ...prev,
              currentFile: file.key,
              currentStage: stage,
            }));
          },
          onFileComplete: (file, result, index, total) => {
            // Update file in UI state
            updateFileMetadata(file.key, {
              exifDate: result.exifDate,
              thumbnailDataUrl: result.thumbnailDataUrl,
              width: result.dimensions?.width,
              height: result.dimensions?.height,
              originalWidth: result.dimensions?.originalWidth,
              originalHeight: result.dimensions?.originalHeight,
            });

            setProcessingStats(prev => ({
              ...prev,
              processed: prev.processed + 1,
              currentStage: 'Completed',
            }));
          },
          onFileError: (file, error, index, total) => {
            console.error(`Error processing ${file.key}:`, error);

            setProcessingStats(prev => ({
              ...prev,
              errors: prev.errors + 1,
              currentStage: `Error: ${error.message}`,
            }));
          },
          onBatchComplete: (results) => {
            console.log(`Completed batch processing of ${results.length} files`);

            setProcessingStats(prev => ({
              ...prev,
              currentStage: 'All files processed',
            }));
          },
        });
      }

      setAutoProcessing(false);

    } catch (error) {
      console.error('Error during auto-processing:', error);

      setProcessingStats(prev => ({
        ...prev,
        currentStage: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }));

      setAutoProcessing(false);
    }
  };

  const stopAutoProcessing = () => {
    if (workerPool) {
      // Signal to the worker pool to stop processing
      console.log("Requesting worker pool to stop processing");
      // Call the stopProcessing method
      workerPool.stopProcessing();
    }

    // Update the UI to show stopping state
    setProcessingStats(prev => ({
      ...prev,
      currentStage: 'Processing stopped by user',
    }));

    // We need to set all states to stopped immediately
    setIsProcessingComplete(true);
    setAutoProcessing(false);
    setQueueBuilt(false);

    // Also clear active tasks array to update UI
    setActiveTasks([]);

    // Reset all worker states to idle
    const updatedWorkerStates: {[key: number]: any} = {};
    for (let i = 0; i < (workerPool?.getMaxWorkers() || 6); i++) {
      updatedWorkerStates[i] = {
        id: i,
        isActive: false,
        currentFile: null,
        stage: "Stopped",
        startTime: Date.now(),
        completedFiles: workerStates[i]?.completedFiles || 0
      };
    }
    setWorkerStates(updatedWorkerStates);

    // Force a refresh of the UI
    setRefreshCounter(prev => prev + 1);
  };

  // Add a useEffect that updates the counter regularly to force UI updates
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (autoProcessing && activeTasks.length > 0) {
      // Update the UI every 500ms while workers are active
      timer = setInterval(() => {
        setRefreshCounter(prev => prev + 1);
      }, 500);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoProcessing, activeTasks.length]);

  // Add a useEffect to check processing state periodically
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (workerPool) {
      // Check processing state every 500ms - without requiring autoProcessing
      // to be true since we need this check to run even when button is clicked
      timer = setInterval(() => {
        // If we have a worker pool and it says it's not processing anymore, but our state says we are,
        // then make sure our state updates to reflect reality
        if (autoProcessing && !workerPool.isCurrentlyProcessing() && !isProcessingComplete) {
          console.log("Worker pool finished processing but state not updated");
          setIsProcessingComplete(true);
          // Keep autoProcessing true for a bit to show the completed state
          setTimeout(() => {
            setAutoProcessing(false);
            setQueueBuilt(false);
          }, 3000);
        }

        // Only automatically turn on autoProcessing if not manually stopped
        // We need to check queueBuilt to know if this is a manually stopped state
        if (!autoProcessing && queueBuilt && workerPool.isCurrentlyProcessing()) {
          console.log("Workers are processing but autoProcessing is false, fixing...");
          setAutoProcessing(true);
        }

        // Always update the refresh counter to keep UI fresh
        setRefreshCounter(prev => prev + 1);
      }, 500);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [workerPool, autoProcessing, isProcessingComplete, queueBuilt]);

  // Also update useEffect to reset worker states when worker count changes
  useEffect(() => {
    // Reset worker states if workerPool changes (for example, worker count changes)
    if (workerPool) {
      const maxWorkers = workerPool instanceof RawWorkerPool ? workerPool.getMaxWorkers() : 6;
      console.log(`Ensuring worker states for ${maxWorkers} workers`);

      // Initialize or update states for all workers
      const updatedWorkerStates: {[key: number]: any} = {};
      for (let i = 0; i < maxWorkers; i++) {
        // Keep existing state if it exists, otherwise create new
        updatedWorkerStates[i] = workerStates[i] || {
          id: i,
          isActive: false,
          currentFile: null,
          stage: "Waiting for task...",
          startTime: Date.now(),
          completedFiles: 0
        };
      }
      setWorkerStates(updatedWorkerStates);
    }
  }, [workerPool]);

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden' // Contain everything
    }}>
      {/* Header section with search and controls - fixed height */}
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <Typography variant="h6" gutterBottom>
          RAW Files ({grandTotalRawFiles > 0 ? `${grandTotalRawFiles} total` : (isLoading ? 'Loading...' : '0 found')})
        </Typography>

        <TextField
          fullWidth
          placeholder="Search loaded files..."
          value={searchTerm}
          onChange={handleSearchChange}
          size="small"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          sx={{ mb: 1 }}
        />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb:1, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{mr: 1}}>
            {grandTotalRawFiles > 0 && totalPages > 0 ?
              `Page ${currentPage} of ${totalPages} (${itemRangeText})` :
              (isLoading ? 'Loading page info...' : (displayedFileCount > 0 ? `Page ${currentPage}`: 'Page 1'))}
          </Typography>
          <Box>
            {currentPage > 1 && !isLoading && (
                <Button onClick={handleGoToFirstPage} size="small" variant="outlined" sx={{mr:0.5}}>First Page</Button>
            )}
            {!autoProcessing ? (
              <Button
                onClick={startAutoProcessing}
                size="small"
                variant="contained"
                color="primary"
                startIcon={<PlayArrowIcon />}
                disabled={isLoading || !grandTotalRawFiles}
                sx={{ ml: 1 }}
              >
                Update All Metadata
              </Button>
            ) : (
              <Button
                onClick={stopAutoProcessing}
                size="small"
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                sx={{ ml: 1 }}
              >
                Stop Processing
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      <Divider />

      {/* Main scrollable content area - flex grow */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {/* Processing panel sits at the top of the scrollable area */}
        {(() => {
          // Debug logging outside of JSX
          if (autoProcessing || queueBuilt) {
            console.log("Rendering progress panel:", {
              autoProcessing,
              queueBuilt,
              isProcessingComplete,
              workerStates: Object.values(workerStates).filter(w => w.isActive).length,
              hasPool: !!workerPool
            });
          }

          // Return the actual JSX
          return (autoProcessing || queueBuilt) && (
            <Box sx={{
              mx: 2,
              mt: 2,
              mb: 2,
              p: 2,
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 1,
              bgcolor: 'rgba(0,0,0,0.2)',
              flexShrink: 0 // Don't allow it to shrink
            }}>
              {/* Processing panel content stays the same */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="body2">
                  Processing RAW files
                </Typography>
                <Typography variant="body2">
                  {processingStats.processed} / {processingStats.total || '?'} ({((processingStats.processed / processingStats.total) * 100).toFixed(1)}%)
                </Typography>
              </Box>

              {/* Overall progress */}
              <Box sx={{ width: '100%', mb: 3 }}>
                <Typography variant="caption" sx={{ mb: 0.5, display: 'block', fontWeight: 'bold' }}>
                  Overall Progress
                </Typography>
                <LinearProgress
                  variant={isProcessingComplete ? "determinate" : "determinate"}
                  value={processingStats.total ? (processingStats.processed / processingStats.total * 100) : 0}
                  color={isProcessingComplete ? (processingStats.errors > 0 ? "error" : "success") : "primary"}
                  sx={{ height: 10, borderRadius: 1 }}
                />
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}>
                  {processingStats.currentStage}
                </Typography>
              </Box>

              {/* Individual worker panels - make scrollable */}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Worker Status</Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  maxHeight: '400px',  // Set a maximum height
                  overflowY: 'auto',   // Add vertical scrolling
                  pr: 1,              // Add some padding for the scrollbar
                  scrollbarWidth: 'thin',
                  '&::-webkit-scrollbar': {
                    width: '8px',
                  },
                  '&::-webkit-scrollbar-track': {
                    background: 'rgba(0,0,0,0.1)',
                    borderRadius: '4px',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    background: 'rgba(255,255,255,0.3)',
                    borderRadius: '4px',
                  }
                }}
              >
                {Object.entries(workerStates).map(([workerIdStr, worker]) => {
                  const workerId = Number(workerIdStr);
                  if (isNaN(workerId)) return null;

                  // Add safety checks for worker properties
                  const completedFiles = typeof worker.completedFiles === 'number' ?
                    worker.completedFiles : 0;
                  const startTime = typeof worker.startTime === 'number' ?
                    worker.startTime : Date.now();
                  const isActive = !!worker.isActive;
                  const stage = worker.stage || "Waiting...";
                  const currentFile = worker.currentFile || null;

                  return (
                    <Box
                      key={`worker-${workerId}-${refreshCounter}`}
                      sx={{
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: isActive ? 'rgba(25, 118, 210, 0.1)' : 'rgba(0,0,0,0.2)',
                        border: isActive ? '1px solid rgba(25, 118, 210, 0.5)' : '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="subtitle2">
                          Worker {workerId + 1}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.7 }}>
                          {completedFiles} files processed
                        </Typography>
                      </Box>

                      {isActive ? (
                        <>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" sx={{
                              maxWidth: '80%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {currentFile?.split('/').pop() || ''}
                            </Typography>
                            <Typography variant="caption">
                              {Math.floor((Date.now() - startTime) / 1000)}s
                            </Typography>
                          </Box>
                          <LinearProgress
                            variant="indeterminate"
                            sx={{ mb: 1, height: 6, borderRadius: 1 }}
                          />
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography variant="caption" sx={{ textAlign: 'center' }}>
                              {stage}
                            </Typography>
                          </Box>
                        </>
                      ) : (
                        <Box sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="caption">
                            {stage === "Waiting for task..." ? "Waiting for task..." : "Idle - waiting for next file"}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>

              {/* Processing status footer */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2, pt: 1, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                  Processing Status:
                </Typography>
                <Typography variant="caption" sx={{ textAlign: 'right' }}>
                  {processingStats.startTime > 0 && (
                    <>
                      Running: {Math.floor((Date.now() - processingStats.startTime) / 60000)}m {Math.floor(((Date.now() - processingStats.startTime) % 60000) / 1000)}s
                      {processingStats.errors > 0 && (
                        <><br/><span style={{ color: '#ff6b6b' }}>Errors: {processingStats.errors}</span></>
                      )}
                    </>
                  )}
                </Typography>
              </Box>
            </Box>
          );
        })()}

        {/* File list */}
        <List sx={{ flex: 1 }}>
          {filteredFiles.length === 0 && !isLoading && (
            <ListItem>
              <ListItemText
                primary="No files found"
                secondary={searchTerm ? "Try a different search term or clear search" : "No RAW files detected in this location."}
              />
            </ListItem>
          )}

          {filteredFiles.map((file) => {
            const fileName = file.key.split('/').pop();
            const filePath = file.key.substring(0, file.key.lastIndexOf('/') + 1);

            return (
              <ListItem key={file.key} disablePadding dense>
                <ListItemButton
                  selected={selectedFile?.key === file.key}
                  onClick={() => onSelectFile(file)}
                  sx={{ alignItems: 'flex-start' }}
                >
                  {file.thumbnailDataUrl && (
                    <Box sx={{ width: 56, height: 56, mr: 2, mt:1, flexShrink: 0, backgroundColor: '#333' }}>
                      <img
                        src={file.thumbnailDataUrl}
                        alt={`Thumbnail for ${fileName}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </Box>
                  )}
                  {!file.thumbnailDataUrl && (
                     <Box sx={{ width: 56, height: 56, mr: 2, mt:1, flexShrink: 0, backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography variant="caption" sx={{color: '#777'}}>No Thumb</Typography>
                     </Box>
                  )}

                  <ListItemText
                    primary={fileName}
                    secondaryTypographyProps={{ component: 'div' }}
                    secondary={
                      <>
                        <Typography component="span" variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {filePath}
                        </Typography>
                        <Typography component="span" variant="body2" color="text.primary">
                          {formatSize(file.size)}
                        </Typography>
                        {` — ${formatDate(file.exifDate || file.lastModified)}`}
                        {file.exifDate ? <Chip label="EXIF" size="small" sx={{ml:1, opacity: 0.7}} /> : <Chip label="S3 Date" size="small" sx={{ml:1, opacity:0.5}}/>}
                      </>
                    }
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {/* Loading indicator */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2, flexShrink: 0 }}>
          <CircularProgress size={24} /> <Typography sx={{ml:1}}>Loading files...</Typography>
        </Box>
      )}

      {/* Footer with pagination - fixed height */}
      <Box sx={{
        p: 2,
        borderTop: '1px solid rgba(255, 255, 255, 0.3)',
        bgcolor: 'rgba(0, 0, 0, 0.2)',
        flexShrink: 0 // Don't allow it to shrink
      }}>
        {!isLoading ? (
          <>
            {isPageLoading ? (
              <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center', mb: 2 }}>
                <CircularProgress size={20} sx={{ mr: 1 }} />
                <Typography>Loading page {currentPage}...</Typography>
              </Box>
            ) : (
              <Pagination
                count={totalPages > 0 ? totalPages : 1}
                page={currentPage}
                onChange={handlePageChange}
                disabled={isPageLoading || totalPages <= 1}
                color="primary"
                showFirstButton
                showLastButton
                siblingCount={1}
                size="medium"
                sx={{
                  '& .MuiPaginationItem-root': {
                    color: 'white',
                  },
                  '& .Mui-selected': {
                    backgroundColor: 'primary.main',
                    fontWeight: 'bold',
                  }
                }}
              />
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, mb: 1 }}>
              <form onSubmit={handleJumpToPage}>
                <TextField
                  size="small"
                  label="Jump to page"
                  value={jumpToPage}
                  onChange={(e) => setJumpToPage(e.target.value)}
                  sx={{ width: '120px', mr: 1 }}
                  disabled={isPageLoading || totalPages <= 1}
                  inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  size="small"
                  disabled={isPageLoading || !jumpToPage || isNaN(parseInt(jumpToPage, 10)) || parseInt(jumpToPage, 10) < 1 || parseInt(jumpToPage, 10) > totalPages}
                >
                  Go
                </Button>
              </form>
            </Box>

            {!hasMoreFilesToLoad && grandTotalRawFiles > 0 && files.length < grandTotalRawFiles && (
              <Typography variant="caption" sx={{textAlign: 'center', display: 'block', mt: 1}}>
                All files matching current S3 scan loaded. Total in index: {grandTotalRawFiles}.
              </Typography>
            )}
            {!hasMoreFilesToLoad && files.length === 0 && grandTotalRawFiles === 0 && (
              <Typography variant="caption" sx={{textAlign: 'center', display: 'block', mt: 1}}>
                No RAW files found.
              </Typography>
            )}
          </>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2">Loading page {currentPage}...</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default FileBrowser;
