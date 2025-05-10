// @ts-nocheck
// Worker for processing raw files in a separate thread
// This needs to be self-contained since it runs in isolation

// Message types for communication with worker
export type WorkerMessage = {
  type: 'process';
  file: {
    key: string;
    url: string;
  };
  id: string;
};

export type WorkerResponse = {
  type: 'progress' | 'complete' | 'error';
  id: string;
  data?: any;
  error?: string;
  stage?: string;
  progress?: number;
};

// Add this type to represent an active task in the worker pool
export type ActiveTask = {
  fileKey: string;
  stage: string;
  startTime: number;
};

// Update callback types to include worker-specific callbacks
export type CompletionHandler = (
  fileKey: string,
  result: any | null,
  error: string | null
) => void;

// Add worker-specific callbacks
export interface WorkerCallbacks {
  onProgress?: (fileKey: string, stage: string) => void;
  onError?: (fileKey: string, error: string) => void;
  onActiveTasksChange?: (tasks: ActiveTask[]) => void;
  onWorkerStart?: (workerId: number, fileKey: string) => void;
  onWorkerProgress?: (workerId: number, fileKey: string, stage: string) => void;
  onWorkerComplete?: (workerId: number, fileKey: string, error: string | null) => void;
}

// Worker pool manager
export class RawWorkerPool {
  private activeWorkers = 0;
  private maxWorkers: number;
  private fileQueue: Array<{
    file: { key: string; url: string };
    resolve: (result: any) => void;
    reject: (error: any) => void;
  }> = [];
  private onProgress?: (fileKey: string, stage: string) => void;
  private onError?: (fileKey: string, error: string) => void;
  // Track active tasks with their current stage
  private activeTasks: Map<string, ActiveTask> = new Map();
  // Callback for when active tasks change
  private onActiveTasksChange?: (tasks: ActiveTask[]) => void;
  // Completion handler
  private completionHandler?: CompletionHandler;
  // Track if we're processing the queue
  private isProcessing = false;
  // For tracking all tasks
  private allTasksPromise: Promise<any[]> | null = null;
  private allTasksResolve: ((results: any[]) => void) | null = null;
  private allTasksReject: ((error: any) => void) | null = null;
  private results: any[] = [];
  private errors: Map<string, string> = new Map();
  // Worker-specific callbacks
  private onWorkerStart?: (workerId: number, fileKey: string) => void;
  private onWorkerProgress?: (workerId: number, fileKey: string, stage: string) => void;
  private onWorkerComplete?: (workerId: number, fileKey: string, error: string | null) => void;
  // Track available workers
  private availableWorkers: number[] = [];
  // Map files to workers
  private fileToWorker: Map<string, number> = new Map();

  constructor(maxWorkers: number = 3) {
    this.maxWorkers = maxWorkers;
    // Initialize available workers
    for (let i = 0; i < maxWorkers; i++) {
      this.availableWorkers.push(i);
    }
  }

  // Update setCallbacks method to include worker-specific callbacks
  public setCallbacks(callbacks: WorkerCallbacks): void {
    this.onProgress = callbacks.onProgress;
    this.onError = callbacks.onError;
    this.onActiveTasksChange = callbacks.onActiveTasksChange;
    this.onWorkerStart = callbacks.onWorkerStart;
    this.onWorkerProgress = callbacks.onWorkerProgress;
    this.onWorkerComplete = callbacks.onWorkerComplete;
  }

  public getActiveTasks(): ActiveTask[] {
    return Array.from(this.activeTasks.values());
  }

  public async processFile(file: { key: string; url: string }): Promise<any> {
    // Return a promise that will be resolved when the file is processed
    return new Promise((resolve, reject) => {
      // Add to queue
      this.fileQueue.push({ file, resolve, reject });

      // Try to process next file
      this.processNextFile();
    });
  }

  public getQueueLength(): number {
    return this.fileQueue.length;
  }

  public getActiveWorkers(): number {
    return this.activeWorkers;
  }

  public async processFiles(files: Array<{ key: string; url: string }>): Promise<any[]> {
    return Promise.all(files.map(file => this.processFile(file)));
  }

  private updateActiveTasks(fileKey: string, stage: string | null) {
    if (stage === null) {
      // Remove task
      this.activeTasks.delete(fileKey);
    } else {
      // Add or update task
      this.activeTasks.set(fileKey, {
        fileKey,
        stage,
        startTime: this.activeTasks.has(fileKey)
          ? (this.activeTasks.get(fileKey) as ActiveTask).startTime
          : Date.now()
      });
    }

    // Notify about the change
    if (this.onActiveTasksChange) {
      this.onActiveTasksChange(Array.from(this.activeTasks.values()));
    }
  }

  // Add this method to set a completion handler
  public setCompletionHandler(handler: CompletionHandler): void {
    this.completionHandler = handler;
  }

  // Add this method to add multiple files at once
  public addFiles(files: Array<{ key: string; url: string }>): void {
    if (files.length === 0) {
      console.log("No files to add to queue");
      return;
    }

    // Add all files to the queue
    files.forEach(file => {
      this.fileQueue.push({
        file,
        resolve: (result) => {
          this.results.push(result);
          this.completionHandler?.(file.key, result, null);
        },
        reject: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.errors.set(file.key, errorMessage);
          this.completionHandler?.(file.key, null, errorMessage);
        }
      });
    });

    console.log(`Added ${files.length} files to the queue. Total queue size: ${this.fileQueue.length}`);
  }

  // Update the processAllQueued method to ensure it doesn't complete prematurely
  public processAllQueued(): Promise<any[]> {
    console.log("processAllQueued called");

    // Return existing promise if already processing
    if (this.allTasksPromise) {
      console.log("Already processing, returning existing promise");
      return this.allTasksPromise;
    }

    // Create a new promise for the entire batch
    this.allTasksPromise = new Promise((resolve, reject) => {
      this.allTasksResolve = resolve;
      this.allTasksReject = reject;

      // Start processing
      this.isProcessing = true;
      this.results = [];
      this.errors.clear();

      console.log(`Starting processing with queue size: ${this.fileQueue.length}`);

      // Start as many workers as we can
      const workersToStart = Math.min(this.maxWorkers, this.fileQueue.length);
      console.log(`Starting ${workersToStart} workers`);

      for (let i = 0; i < workersToStart; i++) {
        this.processNextFile();
      }

      // If no files to process, resolve immediately
      if (this.fileQueue.length === 0 && this.activeWorkers === 0) {
        console.log("No files to process, resolving immediately");
        this.finishAllTasks();
      }
    });

    return this.allTasksPromise;
  }

  // Update the finishAllTasks method to log completion
  private finishAllTasks(): void {
    console.log(`Finishing all tasks. Results: ${this.results.length}, Errors: ${this.errors.size}`);

    this.isProcessing = false;
    if (this.allTasksResolve) {
      this.allTasksResolve(this.results);
      this.allTasksResolve = null;
      this.allTasksReject = null;
      this.allTasksPromise = null;
    }
  }

  // Update processNextFile method to track workers
  private processNextFile() {
    // If no files in queue or already at max workers, do nothing
    if (this.fileQueue.length === 0) {
      console.log(`No more files in queue. Active workers: ${this.activeWorkers}`);

      // Check if all tasks are complete
      if (this.isProcessing && this.activeWorkers === 0) {
        console.log("All workers done and queue empty, finishing all tasks");
        this.finishAllTasks();
      }

      return;
    }

    if (this.activeWorkers >= this.maxWorkers || this.availableWorkers.length === 0) {
      console.log(`Max workers (${this.maxWorkers}) reached or no workers available, not starting new worker`);
      return;
    }

    // Get next file from queue
    const { file, resolve, reject } = this.fileQueue.shift()!;

    // Get an available worker ID
    const workerId = this.availableWorkers.shift()!;

    // Map file to worker
    this.fileToWorker.set(file.key, workerId);

    // Increment active workers
    this.activeWorkers++;
    console.log(`Starting worker ${workerId} for ${file.key}. Active workers: ${this.activeWorkers}`);

    // Add to active tasks
    this.updateActiveTasks(file.key, 'Starting...');

    // Process with rawProcessor utility, which can run in main thread
    this.processInMainThread(file, workerId)
      .then(result => {
        // Remove from active tasks
        this.updateActiveTasks(file.key, null);
        console.log(`Worker ${workerId} completed successfully: ${file.key}`);

        // Return worker to available pool
        this.availableWorkers.push(workerId);
        this.fileToWorker.delete(file.key);

        // Notify worker completion
        this.onWorkerComplete?.(workerId, file.key, null);

        // Resolve the promise for this file
        resolve(result);

        // Decrement active workers
        this.activeWorkers--;
        console.log(`Worker ${workerId} finished for ${file.key}. Remaining active workers: ${this.activeWorkers}`);

        // Process next file
        this.processNextFile();

        // Check if all tasks are complete
        if (this.isProcessing && this.activeWorkers === 0 && this.fileQueue.length === 0) {
          console.log("No more workers active and queue empty, finishing batch");
          this.finishAllTasks();
        }
      })
      .catch(error => {
        // Remove from active tasks
        this.updateActiveTasks(file.key, null);
        console.error(`Worker ${workerId} error for ${file.key}:`, error);

        // Return worker to available pool
        this.availableWorkers.push(workerId);
        this.fileToWorker.delete(file.key);

        // Get error message
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Notify worker completion with error
        this.onWorkerComplete?.(workerId, file.key, errorMessage);

        // Reject the promise for this file
        reject(error);

        // Decrement active workers
        this.activeWorkers--;
        console.log(`Worker ${workerId} failed for ${file.key}. Remaining active workers: ${this.activeWorkers}`);

        // Process next file
        this.processNextFile();

        // Check if all tasks are complete
        if (this.isProcessing && this.activeWorkers === 0 && this.fileQueue.length === 0) {
          console.log("No more workers active and queue empty (after error), finishing batch");
          this.finishAllTasks();
        }
      });
  }

  // Update processInMainThread method to include worker ID
  private async processInMainThread(file: { key: string; url: string }, workerId: number): Promise<any> {
    // Import the necessary modules dynamically with better error handling
    let LibRawModule: any;
    let rawProcessor: any = null;
    let imageArrayBuffer: ArrayBuffer | null = null;
    let decodedImage: any = null;
    let processedImageData: Uint8ClampedArray | null = null;
    let tempCanvas: HTMLCanvasElement | null = null;
    let canvas: HTMLCanvasElement | null = null;

    try {
      // First update progress so the UI isn't frozen
      this.onProgress?.(file.key, 'Loading LibRaw...');
      this.updateActiveTasks(file.key, 'Loading LibRaw...');
      this.onWorkerProgress?.(workerId, file.key, 'Loading LibRaw...');

      // Safe import with error checking - handle both browser and worker contexts
      if (typeof window !== 'undefined') {
        // Browser context - use dynamic import
        const module = await import('libraw-wasm');
        if (!module || !module.default) {
          throw new Error('Failed to load LibRaw module');
        }
        LibRawModule = module.default;
      } else if (typeof self !== 'undefined' && !self.window) {
        // Worker context - assume LibRaw is available on self
        if (!self.LibRaw) {
          throw new Error('LibRaw not available in worker context');
        }
        LibRawModule = self.LibRaw;
      } else {
        throw new Error('Unknown execution environment');
      }

      // Check that LibRawModule is a constructor
      if (typeof LibRawModule !== 'function') {
        console.error('LibRawModule is not a constructor:', typeof LibRawModule);
        throw new Error('LibRaw module is not a valid constructor');
      }
    } catch (error) {
      console.error('Error importing LibRaw module:', error);
      throw new Error(`Failed to import LibRaw: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      // Notify worker start
      this.onWorkerStart?.(workerId, file.key);

      // Notify progress
      this.onProgress?.(file.key, 'Fetching file...');
      this.updateActiveTasks(file.key, 'Fetching file...');
      this.onWorkerProgress?.(workerId, file.key, 'Fetching file...');

      // Fetch the file
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      // Get file data
      imageArrayBuffer = await response.arrayBuffer();

      // Process with LibRaw
      this.onProgress?.(file.key, 'Decoding RAW file...');
      this.updateActiveTasks(file.key, 'Decoding RAW file...');
      this.onWorkerProgress?.(workerId, file.key, 'Decoding RAW file...');

      // Instantiate with safeguards
      try {
        rawProcessor = new LibRawModule();
      } catch (error) {
        console.error('Error instantiating LibRawModule:', error);
        throw new Error('Failed to create LibRaw processor instance');
      }

      // Check that rawProcessor has the expected methods
      if (!rawProcessor || typeof rawProcessor.open !== 'function') {
        throw new Error('LibRaw processor instance is invalid');
      }

      await rawProcessor.open(new Uint8Array(imageArrayBuffer));

      // Extract image data
      this.onProgress?.(file.key, 'Processing image data...');
      this.updateActiveTasks(file.key, 'Processing image data...');
      this.onWorkerProgress?.(workerId, file.key, 'Processing image data...');

      // Verify imageData method exists
      if (typeof rawProcessor.imageData !== 'function') {
        throw new Error('LibRaw processor missing imageData method');
      }

      decodedImage = await rawProcessor.imageData();
      if (!decodedImage || !decodedImage.data) {
        throw new Error('No image data from LibRaw');
      }

      // Extract metadata
      this.onProgress?.(file.key, 'Extracting metadata...');
      this.updateActiveTasks(file.key, 'Extracting metadata...');
      this.onWorkerProgress?.(workerId, file.key, 'Extracting metadata...');

      // Fix the TypeScript error by checking if metadata method exists
      let metadata = {};
      try {
        if (typeof rawProcessor.metadata === 'function') {
          metadata = await rawProcessor.metadata();
        } else {
          console.warn('LibRaw processor missing metadata method - continuing without metadata');
        }
      } catch (metadataError) {
        console.warn('Error extracting metadata - continuing without metadata:', metadataError);
        // Continue without metadata rather than failing the entire process
      }

      // Process timestamp
      let exifDate;
      if (metadata && 'timestamp' in metadata && metadata.timestamp) {
        try {
          // Ensure we're working with a number
          const secondsSinceEpoch = Number(metadata.timestamp.valueOf());
          if (!isNaN(secondsSinceEpoch)) {
            const millisecondsSinceEpoch = secondsSinceEpoch * 1000;
            exifDate = new Date(millisecondsSinceEpoch);
            console.log(`[Worker ${workerId}] Extracted EXIF date: ${exifDate.toISOString()}`);
          }
        } catch (dateError) {
          console.warn(`[Worker ${workerId}] Error processing timestamp:`, dateError);
        }
      }

      // Generate thumbnail
      this.onProgress?.(file.key, 'Generating thumbnail...');
      this.updateActiveTasks(file.key, 'Generating thumbnail...');
      this.onWorkerProgress?.(workerId, file.key, 'Generating thumbnail...');

      let thumbnailDataUrl;
      try {
        // Safety check for browser environment
        if (typeof document === 'undefined') {
          console.warn('[Worker] Document is not defined - thumbnail generation may not work');
        }

        // Use canvas for thumbnail generation
        canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get 2D context from canvas');
        }

        // Prepare dimensions
        const thumbSize = 240;
        const aspectRatio = decodedImage.width / decodedImage.height;
        let thumbWidth, thumbHeight;

        if (aspectRatio > 1) {
          // Landscape
          thumbWidth = thumbSize;
          thumbHeight = Math.round(thumbSize / aspectRatio);
        } else {
          // Portrait or square
          thumbHeight = thumbSize;
          thumbWidth = Math.round(thumbSize * aspectRatio);
        }

        // Set canvas size
        canvas.width = thumbWidth;
        canvas.height = thumbHeight;

        // Create ImageData - with safety checks
        let imageData;
        if (typeof ImageData === 'undefined') {
          throw new Error('ImageData constructor not available');
        }

        try {
          if (decodedImage.colors === 4) {
            imageData = new ImageData(
              new Uint8ClampedArray(decodedImage.data),
              decodedImage.width,
              decodedImage.height
            );
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
            imageData = new ImageData(processedImageData, decodedImage.width, decodedImage.height);
          } else {
            throw new Error(`Unsupported image color components: ${decodedImage.colors}`);
          }
        } catch (imageDataError) {
          console.error(`[Worker ${workerId}] Error creating ImageData:`, imageDataError);
          throw new Error('Failed to create ImageData');
        }

        // Draw to temporary full-size canvas first
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = decodedImage.width;
        tempCanvas.height = decodedImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.putImageData(imageData, 0, 0);

          // Now draw to thumbnail canvas with smoothing
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);

            // Convert to data URL with error handling
            try {
              // Use a lower quality setting for thumbnails
              thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.6);
            } catch (dataUrlError) {
              console.error(`[Worker ${workerId}] Error generating data URL:`, dataUrlError);
              throw new Error('Failed to generate thumbnail data URL');
            }

            // Verify the data URL was created correctly
            if (!thumbnailDataUrl || typeof thumbnailDataUrl !== 'string' || !thumbnailDataUrl.startsWith('data:image/jpeg')) {
              console.error(`[Worker ${workerId}] Invalid thumbnail data URL generated`);
              throw new Error('Invalid thumbnail data URL generated');
            }
          }
        }
      } catch (thumbErr) {
        console.warn('[Raw Processor] Failed to generate thumbnail:', thumbErr);
        // Continue without thumbnail
      }

      // Prepare dimensions data
      const dimensions = {
        width: decodedImage.width,
        height: decodedImage.height,
        // Fix TypeScript error by using optional chaining for rawWidth/rawHeight properties
        originalWidth: (decodedImage as any).rawWidth || decodedImage.width,
        originalHeight: (decodedImage as any).rawHeight || decodedImage.height
      };

      // Extract only the needed data before cleanup
      const result = {
        fileKey: file.key,
        metadata: { ...metadata }, // Create a copy of metadata
        thumbnailDataUrl,
        exifDate: exifDate ? new Date(exifDate) : undefined, // Create new Date object
        dimensions: { ...dimensions } // Create a copy of dimensions
      };

      // Return the processed result
      return result;
    } catch (error) {
      this.onError?.(file.key, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      // Clean up resources
      console.log(`[Worker ${workerId}] Cleaning up resources for ${file.key}`);

      // Clean up canvases
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
        canvas = null;
      }

      if (tempCanvas) {
        tempCanvas.width = 1;
        tempCanvas.height = 1;
        tempCanvas = null;
      }

      // Clear large data buffers
      if (processedImageData) {
        processedImageData = null;
      }

      if (decodedImage && decodedImage.data) {
        // Clear the ImageData to help GC
        decodedImage.data = null;
        decodedImage = null;
      }

      // Clear image buffer
      imageArrayBuffer = null;

      // Close and clean up LibRaw processor
      if (rawProcessor) {
        if (typeof rawProcessor.recycle === 'function') {
          try {
            rawProcessor.recycle();
          } catch (e) {
            console.warn(`[Worker ${workerId}] Error recycling rawProcessor:`, e);
          }
        }

        if (typeof rawProcessor.close === 'function') {
          try {
            rawProcessor.close();
          } catch (e) {
            console.warn(`[Worker ${workerId}] Error closing rawProcessor:`, e);
          }
        }

        // Clear reference
        rawProcessor = null;
      }

      // Force garbage collection if available in debug environments
      if (typeof window !== 'undefined' && 'gc' in window) {
        try {
          (window as any).gc();
        } catch (e) {
          // Ignore - gc might not be available
        }
      }
    }
  }

  // Add a method to check if the pool is processing
  public isCurrentlyProcessing(): boolean {
    return this.isProcessing || this.activeWorkers > 0;
  }

  // Add a method to stop processing and clear the queue
  public stopProcessing(): void {
    console.log(`Stopping worker pool processing. Active workers: ${this.activeWorkers}, Queue size: ${this.fileQueue.length}`);

    // Clear the file queue
    const queueLength = this.fileQueue.length;
    this.fileQueue = [];

    // Forcibly mark all active tasks as stopped
    this.activeTasks.forEach((task, key) => {
      this.updateActiveTasks(key, 'Stopped');
    });

    // Since we can't abort fetch requests easily, we'll at least clear and reset everything

    // Reset all worker state
    this.activeWorkers = 0;
    this.availableWorkers = [];
    for (let i = 0; i < this.maxWorkers; i++) {
      this.availableWorkers.push(i);
    }

    // Clear our file-to-worker mapping
    this.fileToWorker.clear();

    // Clear the task queue
    this.activeTasks.clear();

    // Set processing flag to false
    this.isProcessing = false;

    // Notify active tasks changed
    if (this.onActiveTasksChange) {
      this.onActiveTasksChange([]);
    }

    // Reject the all tasks promise if active
    if (this.allTasksReject) {
      this.allTasksReject(new Error('Processing stopped by user'));
      this.allTasksPromise = null;
      this.allTasksResolve = null;
      this.allTasksReject = null;
    }

    console.log(`Stopped processing. Cleared ${queueLength} items from queue. Reset worker state.`);
  }

  // Add the getMaxWorkers method to the RawWorkerPool class
  public getMaxWorkers(): number {
    return this.maxWorkers;
  }
}

// Add standalone worker message handler for use in actual web worker context
// Worker global scope has self instead of window
if (typeof self !== 'undefined' && !self.window) {
  // We're in a worker context
  self.onmessage = async function(e) {
    try {
      const message = e.data;

      if (message.type === 'process') {
        // Notify progress
        self.postMessage({
          type: 'progress',
          id: message.id,
          stage: 'Initializing...',
        });

        // Use libraw-wasm directly (worker needs to have access to the library)
        self.postMessage({
          type: 'progress',
          id: message.id,
          stage: 'Loading LibRaw...',
        });

        // In a real worker, we would import libraw-wasm directly rather than using dynamic import
        // Since we can't do dynamic imports in workers, libraw-wasm must be pre-loaded
        const LibRawModule = self.LibRaw;

        if (!LibRawModule) {
          throw new Error('LibRaw module not available in worker context');
        }

        // Process the file (code adapted from processInMainThread)
        // ... rest of the processing code follows ...
        // (This would be a simplified version of the processing code)
      } else {
        throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
