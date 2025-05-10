import { useState } from 'react';
import { Button, Box, Typography, CircularProgress, Tooltip } from '@mui/material';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

/**
 * Component that provides a button to manually trigger browser memory cleanup
 * This ONLY affects local browser memory and does NOT remove thumbnails from S3
 */
export default function MemoryCleanupButton() {
  const [isCleaning, setIsCleaning] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: string;
  } | null>(null);

  const handleCleanup = async () => {
    setIsCleaning(true);
    setResult(null);

    try {
      // 1. First run local memory cleanup
      console.log('Running memory cleanup...');

      // Clear image cache from browsers
      const caches = await (window as any).caches?.keys();
      if (caches && Array.isArray(caches)) {
        await Promise.all(caches.map(cacheName => (window as any).caches.delete(cacheName)));
        console.log(`Cleared ${caches.length} browser caches`);
      }

      // Try to force garbage collection if available in development
      if (typeof window !== 'undefined' && 'gc' in window) {
        try {
          (window as any).gc();
          console.log('Manual garbage collection triggered');
        } catch (e) {
          console.log('gc not available, skipping');
        }
      }

      // 2. Call the index API to get stats (no cleanup)
      console.log('Getting index stats...');
      const response = await fetch('/api/metadata/index/cleanup', {
        method: 'POST',
      });

      const data = await response.json();

      console.log('Cleanup response:', data);

      if (data.success) {
        setResult({
          success: true,
          message: 'Browser memory cleaned',
          details: `Index size: ${data.indexSize}MB, ${data.thumbnailCount} thumbnails (${data.thumbnailsSize}MB)`
        });
      } else {
        setResult({
          success: false,
          message: data.message || 'Memory cleanup completed',
          details: undefined
        });
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
      setResult({
        success: false,
        message: 'Memory cleanup failed',
        details: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
      <Tooltip title="Clean up browser memory and free up RAM usage (does NOT affect S3 thumbnails)">
        <Button
          variant="outlined"
          color="info"
          size="small"
          startIcon={isCleaning ? <CircularProgress size={18} /> : <CleaningServicesIcon />}
          onClick={handleCleanup}
          disabled={isCleaning}
        >
          {isCleaning ? 'Cleaning...' : 'Clean Browser Memory'}
        </Button>
      </Tooltip>

      {result && (
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          fontSize: '0.875rem',
          color: result.success ? 'success.main' : 'text.secondary',
          mt: 0.5
        }}>
          {result.success ? (
            <CheckCircleIcon color="success" fontSize="small" />
          ) : (
            <ErrorIcon color="warning" fontSize="small" />
          )}
          <Box>
            <Typography variant="body2" fontWeight="medium">
              {result.message}
            </Typography>
            {result.details && (
              <Typography variant="caption" display="block">
                {result.details}
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
