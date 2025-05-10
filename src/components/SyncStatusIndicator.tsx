import { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Tooltip, CircularProgress, Badge, Paper } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import useStore from '@/store/useStore';

/**
 * Component that shows the sync status with S3 and allows manual syncing
 * Positioned as a floating element in the top right corner
 * Only visible when there are pending changes
 */
export default function SyncStatusIndicator() {
  const {
    pendingChanges,
    lastSyncTime,
    isSyncing,
    syncError,
    nextSyncTime,
    syncChangesToS3,
    hasPendingChanges
  } = useStore();

  const [timeUntilSync, setTimeUntilSync] = useState<number>(0);
  const [lastSyncTimeString, setLastSyncTimeString] = useState<string>('Never');

  // Update the countdown timer and last sync time display
  useEffect(() => {
    const updateTimes = () => {
      // Calculate time until next sync
      if (nextSyncTime > 0) {
        const now = Date.now();
        if (now < nextSyncTime) {
          setTimeUntilSync(Math.ceil((nextSyncTime - now) / 1000));
        } else {
          setTimeUntilSync(0);
        }
      } else {
        setTimeUntilSync(0);
      }

      // Format last sync time
      if (lastSyncTime > 0) {
        const date = new Date(lastSyncTime);
        setLastSyncTimeString(date.toLocaleTimeString());
      } else {
        setLastSyncTimeString('Never');
      }
    };

    // Update immediately
    updateTimes();

    // Set up interval to update every second
    const interval = setInterval(updateTimes, 1000);

    return () => clearInterval(interval);
  }, [nextSyncTime, lastSyncTime]);

  // Get pending changes count
  const pendingChangesCount = Object.keys(pendingChanges).length;

  // Handle manual sync
  const handleManualSync = async () => {
    try {
      await syncChangesToS3();
    } catch (error) {
      console.error('Manual sync failed:', error);
    }
  };

  // Don't render if no pending changes and not syncing and no error
  if (!hasPendingChanges() && !isSyncing && !syncError) {
    return null;
  }

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        padding: 1.5,
        borderRadius: 2,
        backgroundColor: syncError
          ? 'rgba(211, 47, 47, 0.9)'  // Error background
          : hasPendingChanges()
            ? 'rgba(25, 118, 210, 0.4)' // Semi-transparent blue background
            : 'rgba(76, 175, 80, 0.9)',  // Success background
        border: syncError
          ? '2px solid #d32f2f'  // Red border for errors
          : hasPendingChanges()
            ? '2px solid rgb(25, 118, 210)' // Opaque blue border for changes
            : '2px solid #4caf50',  // Green border for success
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
        color: '#fff', // Always white text for all states
        backdropFilter: 'blur(5px)',
        transition: 'all 0.3s ease-in-out',
        maxWidth: '300px',
      }}
    >
      {/* Status icon */}
      <Box sx={{ mr: 1.5 }}>
        {isSyncing ? (
          <CircularProgress size={20} thickness={5} sx={{ color: '#fff' }} />
        ) : syncError ? (
          <Tooltip title={`Error: ${syncError}`}>
            <CloudOffIcon sx={{ color: '#fff' }} />
          </Tooltip>
        ) : hasPendingChanges() ? (
          <Badge badgeContent={pendingChangesCount} color="error" max={99}>
            <SaveIcon sx={{ color: '#fff' }} />
          </Badge>
        ) : (
          <CloudDoneIcon sx={{ color: '#fff' }} />
        )}
      </Box>

      {/* Status text */}
      <Box sx={{ flexGrow: 1, mr: 1 }}>
        <Typography variant="body2" sx={{
          lineHeight: 1.2,
          color: '#fff',
          fontWeight: 500
        }}>
          {isSyncing ? (
            'Syncing changes to S3...'
          ) : syncError ? (
            'Sync error - click to retry'
          ) : (
            timeUntilSync > 0 ? (
              `${pendingChangesCount} change${pendingChangesCount !== 1 ? 's' : ''} (auto-save: ${timeUntilSync}s)`
            ) : (
              `${pendingChangesCount} change${pendingChangesCount !== 1 ? 's' : ''} to save`
            )
          )}
        </Typography>
      </Box>

      {/* Manual sync button - always show */}
      {!isSyncing && (
        <Tooltip title={syncError ? "Retry" : "Save changes now"}>
          <IconButton
            onClick={handleManualSync}
            size="small"
            sx={{
              color: '#fff',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)'
              }
            }}
          >
            <SaveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Paper>
  );
}
