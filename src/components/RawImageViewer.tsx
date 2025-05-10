'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { RawFile } from '@/types';
import useStore from '@/store/useStore';
import { processRawFile } from '@/utils/rawProcessor';

interface RawImageViewerProps {
  file: RawFile;
}

const RawImageViewer = ({ file }: RawImageViewerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decodeProgress, setDecodeProgress] = useState<string | null>(null);
  const { updateFileMetadata } = useStore();
  const [processResult, setProcessResult] = useState<any>(null);

  useEffect(() => {
    let currentEffectIsActive = true;

    const currentFileUrl = file.url;
    const currentFileKey = file.key;

    if (!currentFileUrl) {
      setError('No URL for this file');
      setIsLoading(false);
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    setIsLoading(true);
    setError(null);
    setDecodeProgress('Initializing...');

    const loadAndDisplayImage = async () => {
      try {
        // Process the file using the shared utility
        const result = await processRawFile(
          file,
          {
            onProgress: (stage) => {
              if (currentEffectIsActive) {
                setDecodeProgress(stage);
              }
            },
            onComplete: (data) => {
              if (currentEffectIsActive) {
                setProcessResult(data);
              }
            },
            onError: (err) => {
              if (currentEffectIsActive) {
                setError(err.message);
              }
            }
          }
        );

        if (!currentEffectIsActive) return;

        // Get decoded image data from the result
        const decodedImage = result.dimensions;
        if (!decodedImage) {
          throw new Error('Missing image dimensions in processed result');
        }

        // Draw to canvas
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas element not available');

        // Set canvas size
        canvas.width = decodedImage.width;
        canvas.height = decodedImage.height;

        // Get the 2D context
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context');

        // USE FULL IMAGE DATA DIRECTLY instead of using the thumbnail
        if (result.imageData && result.imageData.data) {
          // Create ImageData from the full-resolution data
          const fullImageData = new ImageData(
            result.imageData.data,
            result.imageData.width,
            result.imageData.height
          );

          // Draw the full-resolution image data directly to canvas
          ctx.putImageData(fullImageData, 0, 0);
        } else {
          // Fallback to thumbnail if for some reason imageData is missing
          console.warn('Full image data not available, falling back to thumbnail');

          const imageData = await fetch(result.thumbnailDataUrl || '');
          if (!imageData.ok) throw new Error('Failed to get image data');

          const blob = await imageData.blob();
          const imageUrl = URL.createObjectURL(blob);

          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(imageUrl);
          };
          img.src = imageUrl;
        }

        // Update store with metadata
        updateFileMetadata(currentFileKey, {
          exifDate: result.exifDate,
          thumbnailDataUrl: result.thumbnailDataUrl,
          width: decodedImage.width,
          height: decodedImage.height,
          originalWidth: decodedImage.originalWidth,
          originalHeight: decodedImage.originalHeight,
        });

      } catch (err) {
        if (currentEffectIsActive) {
          console.error('Error loading/drawing image:', err);
          setError(err instanceof Error ? err.message : 'Failed to display image');
        }
      } finally {
        if (currentEffectIsActive) {
          setDecodeProgress(null);
          setIsLoading(false);
        }
      }
    };

    loadAndDisplayImage();

    return () => {
      currentEffectIsActive = false;
    };
  }, [file.url, file.key, updateFileMetadata]);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {(isLoading || decodeProgress) && (
         <Box sx={{position: 'absolute',top: '50%',left: '50%',transform: 'translate(-50%, -50%)',textAlign: 'center',color: 'white' }}>
           <CircularProgress sx={{ mb: 2 }} />
           {decodeProgress && <Typography>{decodeProgress}</Typography>}
           {!decodeProgress && isLoading && <Typography>Loading...</Typography>}
         </Box>
      )}
      {error && (
         <Box sx={{position: 'absolute',top: '50%',left: '50%',transform: 'translate(-50%, -50%)',color: 'error.main',textAlign: 'center',backgroundColor: 'rgba(0,0,0,0.7)',padding: '20px',borderRadius: '8px'}}>
           <Typography variant="h6">Error</Typography>
           <Typography>{error}</Typography>
         </Box>
      )}
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          display: isLoading || error ? 'none' : 'block',
          backgroundColor: '#000'
        }}
      />
    </Box>
  );
};

export default RawImageViewer;
