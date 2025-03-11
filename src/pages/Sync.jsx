import { useState, useEffect } from 'react';
import { 
  Typography, 
  Box, 
  Button, 
  LinearProgress, 
  Alert,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  CircularProgress,
  useMediaQuery,
  useTheme as useMuiTheme
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import CancelIcon from '@mui/icons-material/Cancel';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SearchIcon from '@mui/icons-material/Search';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import VideocamIcon from '@mui/icons-material/Videocam';
import StorageIcon from '@mui/icons-material/Storage';
import TimelineIcon from '@mui/icons-material/Timeline';
import { useTheme } from '../context/ThemeContext';
import { useWebSocket } from '../context/WebSocketContext';

function Sync() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState(null);
  const [discoveryToken, setDiscoveryToken] = useState(null);
  const { 
    status: wsStatus, 
    error: wsError, 
    sendMessage,
    discoveryState,
    syncState 
  } = useWebSocket();
  const { isDarkMode } = useTheme();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'));

  // Update local state when WebSocket context state changes
  useEffect(() => {
    if (discoveryState) {
      setDiscoveryResults(discoveryState);
      setDiscovering(discoveryState.status === 'discovering');
    }
  }, [discoveryState]);

  useEffect(() => {
    if (syncState) {
      setSyncStatus(syncState);
      setLoading(false); // Stop loading when we receive sync state
    }
  }, [syncState]);

  // Update loading state when WebSocket status changes
  useEffect(() => {
    if (wsStatus === 'connected' && syncState) {
      setLoading(false);
    } else if (wsStatus !== 'connected') {
      setLoading(true);
      // Reset discovering state when connection is lost
      if (discovering) {
        setDiscovering(false);
        setError('Connection lost during discovery. Please try again when connection is restored.');
      }
    }
  }, [wsStatus, syncState, discovering]);

  // Request current states when component mounts or WebSocket reconnects
  useEffect(() => {
    if (wsStatus === 'connected') {
      sendMessage('getDiscoveryProgress');
      sendMessage('getSyncStatus');
      // Clear error when connection is restored
      setError(null);
    }
  }, [wsStatus, sendMessage]);

  // Handle WebSocket connection status
  useEffect(() => {
    if (wsStatus !== 'connected') {
      setError('Connecting to server... Please wait.');
    } else {
      setError(wsError || null);
    }
  }, [wsStatus, wsError]);

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch('http://localhost:3000/sync/status');
      if (!response.ok) {
        throw new Error('Failed to fetch sync status');
      }
      const status = await response.json();
      setSyncStatus(status);
      setError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching sync status:', error);
      setError('Failed to fetch sync status');
      setLoading(false);
    }
  };

  const handleDiscover = async (continueDiscovery = false) => {
    try {
      // Only set discovering if we're connected
      if (wsStatus !== 'connected') {
        throw new Error('Cannot start discovery: Server connection not established');
      }

      setDiscovering(true);
      setError(null);
      
      if (!continueDiscovery) {
        // Reset discovery results if starting fresh
        setDiscoveryResults(null);
        setDiscoveryToken(null);
      }
      
      // Check authentication first
      const authResponse = await fetch('http://localhost:3000/check-auth');
      if (!authResponse.ok) {
        throw new Error('Authentication check failed');
      }
      const authData = await authResponse.json();
      
      if (!authData.authenticated) {
        throw new Error('You must be authenticated to discover photos');
      }
      
      // Start discovery process
      const response = await fetch('http://localhost:3000/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          continueDiscovery: continueDiscovery,
          pageToken: discoveryToken
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to discover photos');
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Discovery failed');
      }
      
      // Request current discovery progress
      if (wsStatus === 'connected') {
        sendMessage('getDiscoveryProgress');
      } else {
        throw new Error('WebSocket connection lost during discovery');
      }
      
      // Store the next page token if there are more results
      if (data.discovery.hasMore && data.discovery.nextPageToken) {
        setDiscoveryToken(data.discovery.nextPageToken);
      } else {
        setDiscoveryToken(null);
      }
      
      // Update or merge discovery results
      if (continueDiscovery && discoveryResults) {
        // Merge with previous results
        setDiscoveryResults(prevResults => ({
          ...data.discovery,
          totalItems: (prevResults?.totalItems || 0) + data.discovery.totalItems,
          photoCount: (prevResults?.photoCount || 0) + data.discovery.photoCount,
          videoCount: (prevResults?.videoCount || 0) + data.discovery.videoCount,
          filteredItems: (prevResults?.filteredItems || 0) + data.discovery.filteredItems,
          estimatedSizeBytes: (prevResults?.estimatedSizeBytes || 0) + data.discovery.estimatedSizeBytes,
          estimatedSizeMB: Math.round(((prevResults?.estimatedSizeBytes || 0) + data.discovery.estimatedSizeBytes) / (1024 * 1024)),
          pagesScanned: (prevResults?.pagesScanned || 0) + data.discovery.pagesScanned
        }));
      } else {
        // Set initial results
        setDiscoveryResults(data.discovery);
      }
    } catch (error) {
      console.error('Discovery error:', error);
      setError(error.message || 'Failed to discover photos');
      setDiscovering(false);
    }
  };

  const handleDiscoverMore = () => {
    handleDiscover(true);
  };

  const handleSync = async () => {
    try {
      setError(null);
      
      // Make sure we have discovered items first
      if (!discoveryResults || discoveryResults.totalItems === 0) {
        throw new Error('Please run discovery first to find items to sync');
      }
      
      const response = await fetch('http://localhost:3000/sync', {
        method: 'POST'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start sync');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to start sync');
      }
      
      // Update sync status after starting sync
      await fetchSyncStatus();
    } catch (error) {
      console.error('Sync error:', error);
      setError(error.message);
    }
  };

  const handlePauseResume = async () => {
    try {
      setError(null);
      const endpoint = syncState?.isPaused ? 'resume' : 'pause';
      const response = await fetch(`http://localhost:3000/sync/${endpoint}`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to ${endpoint} sync`);
      }
      
      // Update sync status after pausing/resuming
      await fetchSyncStatus();
    } catch (error) {
      console.error('Sync control error:', error);
      setError(error.message);
    }
  };

  const handleCancel = async () => {
    try {
      setError(null);
      const response = await fetch('http://localhost:3000/sync/cancel', {
        method: 'POST'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to cancel sync');
      }
      
      // Update sync status after cancelling
      await fetchSyncStatus();
    } catch (error) {
      console.error('Sync control error:', error);
      setError(error.message);
    }
  };

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Update the discovery progress display in the UI
  const renderDiscoveryProgress = () => {
    if (!discoveryState || discoveryState.status === 'idle') return null;

    const { photoCount = 0, videoCount = 0, estimatedSizeBytes = 0, pagesScanned = 0 } = discoveryState;
    const formattedSize = formatBytes(estimatedSizeBytes);

    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        <Typography>
          Discovered {photoCount} photos and {videoCount} videos ({formattedSize}) in {pagesScanned} pages
          {discoveryState.status === 'discovering' && ' - Discovery in progress...'}
        </Typography>
        {wsStatus !== 'connected' && (
          <Typography color="error" sx={{ mt: 1 }}>
            ⚠️ Connection lost. Trying to reconnect... Progress updates may be delayed.
          </Typography>
        )}
      </Alert>
    );
  };

  if (loading) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ mt: 2 }}>
          Loading sync status...
        </Typography>
        {wsStatus !== 'connected' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Connecting to server...
          </Typography>
        )}
      </Box>
    );
  }

  // Check if sync button should be enabled
  const syncEnabled = discoveryState && 
    discoveryState.totalItems > 0 && 
    syncState?.status !== 'running' && 
    syncState?.status !== 'paused';

  return (
    <Box>
      <Typography 
        variant={isMobile ? "h5" : "h4"} 
        component="h1"
        gutterBottom
        sx={{ mb: 3 }}
      >
        Sync Management
      </Typography>

      {(error || wsError) && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error || wsError}
        </Alert>
      )}

      {renderDiscoveryProgress()}

      <Grid container spacing={3}>
        {/* Discovery Panel */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, mb: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Photo Discovery
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Typography variant="body2" color="text.secondary" paragraph>
              Discover how many photos and videos are available to sync before starting the process. 
              You can discover in chunks to ensure you have enough space.
            </Typography>
            
            {discoveryState?.status === 'discovering' ? (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <CircularProgress size={40} />
                <Typography variant="body2" sx={{ mt: 2 }}>
                  Discovering available media...
                </Typography>
              </Box>
            ) : discoveryState?.totalItems > 0 ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body1" gutterBottom>
                  Discovery Results:
                </Typography>
                
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
                      <PhotoLibraryIcon color="primary" />
                      <Typography variant="h6">{discoveryState.photoCount}</Typography>
                      <Typography variant="body2">Photos</Typography>
                    </Card>
                  </Grid>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
                      <VideocamIcon color="secondary" />
                      <Typography variant="h6">{discoveryState.videoCount}</Typography>
                      <Typography variant="body2">Videos</Typography>
                    </Card>
                  </Grid>
                </Grid>
                
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <TimelineIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Total Items Found" 
                      secondary={`${discoveryState.totalItems} items${discoveryState.hasMore ? ' (more available)' : ''}`}
                    />
                  </ListItem>
                  {discoveryState.dateFiltered && (
                    <ListItem>
                      <ListItemIcon>
                        <TimelineIcon />
                      </ListItemIcon>
                      <ListItemText 
                        primary="After Date Filtering" 
                        secondary={`${discoveryState.filteredItems} items match your date range`}
                      />
                    </ListItem>
                  )}
                  <ListItem>
                    <ListItemIcon>
                      <StorageIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Estimated Size" 
                      secondary={formatBytes(discoveryState.estimatedSizeBytes)}
                    />
                  </ListItem>
                </List>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Scanned {discoveryState.pagesScanned} pages
                  </Typography>
                  <Box>
                    {discoveryState.hasMore && (
                      <Button 
                        size="small" 
                        onClick={() => handleDiscover(true)}
                        sx={{ mr: 1 }}
                      >
                        Discover More
                      </Button>
                    )}
                    <Button 
                      size="small" 
                      onClick={() => handleDiscover(false)}
                    >
                      Restart Discovery
                    </Button>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box sx={{ mt: 3, textAlign: 'center' }}>
                <Button
                  variant="outlined" 
                  color="primary"
                  startIcon={<SearchIcon />}
                  onClick={() => handleDiscover(false)}
                >
                  Discover Available Media
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>
        
        {/* Sync Status Panel */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, mb: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Current Sync Status
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            {syncState && (
              <Box sx={{ my: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body1">
                    Status: <strong>{syncState.status}</strong>
                  </Typography>
                  {syncState.isPaused && (
                    <Chip
                      label="Paused"
                      color="warning"
                      size="small"
                    />
                  )}
                </Box>
                
                {(syncState.status === 'running' || syncState.status === 'paused') && (
                  <Box sx={{ width: '100%', mb: 2 }}>
                    <LinearProgress 
                      variant="determinate" 
                      value={syncState.progress || 0}
                      sx={{
                        opacity: syncState.status === 'paused' ? 0.5 : 1,
                        height: 10,
                        borderRadius: 5
                      }}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {syncState.processedItems} of {syncState.totalItems} items processed
                    </Typography>
                  </Box>
                )}

                <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
                  {syncState.status === 'running' || syncState.status === 'paused' ? (
                    <>
                      <Button
                        variant="contained"
                        color={syncState.isPaused ? "primary" : "warning"}
                        startIcon={syncState.isPaused ? <PlayArrowIcon /> : <PauseIcon />}
                        onClick={handlePauseResume}
                      >
                        {syncState.isPaused ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<CancelIcon />}
                        onClick={handleCancel}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<SyncIcon />}
                      onClick={handleSync}
                      disabled={!syncEnabled}
                    >
                      Start Sync
                    </Button>
                  )}
                </Box>
              </Box>
            )}
          </Paper>
        </Grid>
        
        {/* Schedule Panel */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <ScheduleIcon sx={{ mr: 1 }} />
                Scheduled Syncs
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  No scheduled syncs configured. Visit Settings to set up automatic syncing.
                </Typography>
              </Box>
            </CardContent>
            <CardActions>
              <Button size="small" component="a" href="/settings">
                Configure Scheduling
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Sync; 