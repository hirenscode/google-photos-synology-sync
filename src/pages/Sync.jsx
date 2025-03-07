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

function Sync() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState(null);
  const [discoveryToken, setDiscoveryToken] = useState(null); // To track pagination for "Discover More"
  const { isDarkMode } = useTheme();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'));

  useEffect(() => {
    fetchSyncStatus();
  }, []);

  const fetchSyncStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000/sync/status');
      if (!response.ok) {
        throw new Error('Failed to fetch sync status');
      }
      const status = await response.json();
      setSyncStatus(status);
      setError(null);
    } catch (error) {
      console.error('Error fetching sync status:', error);
      setError('Failed to fetch sync status');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (continueDiscovery = false) => {
    try {
      setDiscovering(true);
      setError(null);
      
      if (!continueDiscovery) {
        // Reset discovery results if starting fresh
        setDiscoveryResults(null);
        setDiscoveryToken(null);
      }
      
      // Check authentication first
      const authResponse = await fetch('http://localhost:3000/check-auth');
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
      
      console.log('Discovery results:', data.discovery);
      
      // Store the next page token if there are more results
      if (data.discovery.hasMore && data.discovery.nextPageToken) {
        setDiscoveryToken(data.discovery.nextPageToken);
      } else {
        setDiscoveryToken(null);
      }
      
      // Update or merge discovery results
      if (continueDiscovery && discoveryResults) {
        // Merge with previous results
        setDiscoveryResults({
          ...data.discovery,
          totalItems: (discoveryResults.totalItems || 0) + data.discovery.totalItems,
          photoCount: (discoveryResults.photoCount || 0) + data.discovery.photoCount,
          videoCount: (discoveryResults.videoCount || 0) + data.discovery.videoCount,
          filteredItems: (discoveryResults.filteredItems || 0) + data.discovery.filteredItems,
          estimatedSizeBytes: (discoveryResults.estimatedSizeBytes || 0) + data.discovery.estimatedSizeBytes,
          estimatedSizeMB: Math.round(((discoveryResults.estimatedSizeBytes || 0) + data.discovery.estimatedSizeBytes) / (1024 * 1024)),
          pagesScanned: (discoveryResults.pagesScanned || 0) + data.discovery.pagesScanned
        });
      } else {
        // Set initial results
        setDiscoveryResults(data.discovery);
      }
    } catch (error) {
      console.error('Discovery error:', error);
      setError(error.message || 'Failed to discover photos');
    } finally {
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
      const endpoint = syncStatus?.isPaused ? '/sync/resume' : '/sync/pause';
      const response = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to ${syncStatus?.isPaused ? 'resume' : 'pause'} sync`);
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

  if (loading) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ mt: 2 }}>
          Loading sync status...
        </Typography>
      </Box>
    );
  }

  // Check if sync button should be enabled
  const syncEnabled = discoveryResults && 
    discoveryResults.totalItems > 0 && 
    syncStatus?.status !== 'running' && 
    syncStatus?.status !== 'paused';

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

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

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
            
            {discovering ? (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <CircularProgress size={40} />
                <Typography variant="body2" sx={{ mt: 2 }}>
                  Discovering available media...
                </Typography>
              </Box>
            ) : discoveryResults ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body1" gutterBottom>
                  Discovery Results:
                </Typography>
                
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
                      <PhotoLibraryIcon color="primary" />
                      <Typography variant="h6">{discoveryResults.photoCount}</Typography>
                      <Typography variant="body2">Photos</Typography>
                    </Card>
                  </Grid>
                  <Grid item xs={6}>
                    <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
                      <VideocamIcon color="secondary" />
                      <Typography variant="h6">{discoveryResults.videoCount}</Typography>
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
                      secondary={`${discoveryResults.totalItems} items${discoveryResults.hasMore ? ' (more available)' : ''}`}
                    />
                  </ListItem>
                  {discoveryResults.dateFiltered && (
                    <ListItem>
                      <ListItemIcon>
                        <TimelineIcon />
                      </ListItemIcon>
                      <ListItemText 
                        primary="After Date Filtering" 
                        secondary={`${discoveryResults.filteredItems} items match your date range`}
                      />
                    </ListItem>
                  )}
                  <ListItem>
                    <ListItemIcon>
                      <StorageIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Estimated Size" 
                      secondary={formatBytes(discoveryResults.estimatedSizeBytes)}
                    />
                  </ListItem>
                </List>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Scanned {discoveryResults.pagesScanned} pages
                  </Typography>
                  <Box>
                    {discoveryResults.hasMore && (
                      <Button 
                        size="small" 
                        onClick={handleDiscoverMore}
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
            
            {syncStatus && (
              <Box sx={{ my: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body1">
                    Status: <strong>{syncStatus.status}</strong>
                  </Typography>
                  {syncStatus.isPaused && (
                    <Chip
                      label="Paused"
                      color="warning"
                      size="small"
                    />
                  )}
                </Box>
                
                {(syncStatus.status === 'running' || syncStatus.status === 'paused') && (
                  <Box sx={{ width: '100%', mb: 2 }}>
                    <LinearProgress 
                      variant="determinate" 
                      value={syncStatus.progress}
                      sx={{
                        opacity: syncStatus.status === 'paused' ? 0.5 : 1,
                        height: 10,
                        borderRadius: 5
                      }}
                    />
                    <Typography 
                      variant="body2" 
                      color="text.secondary" 
                      align="center"
                      sx={{ mt: 1 }}
                    >
                      {syncStatus.status === 'paused' ? 'Sync paused' : 'Syncing photos...'}
                      {' '}{syncStatus.progress}%
                      {syncStatus.message && (
                        <Box component="span" sx={{ display: 'block' }}>
                          {syncStatus.message}
                        </Box>
                      )}
                    </Typography>
                  </Box>
                )}
                
                {syncStatus.status === 'completed' && (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    Sync completed successfully!
                  </Alert>
                )}
                
                {syncStatus.status === 'cancelled' && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Sync cancelled by user.
                  </Alert>
                )}
                
                {syncStatus.status === 'error' && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {error || 'Sync failed. Please try again.'}
                  </Alert>
                )}
              </Box>
            )}

            <Box sx={{ mt: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button 
                variant="contained" 
                color="primary" 
                onClick={handleSync}
                size={isMobile ? "medium" : "large"}
                disabled={!syncEnabled}
                startIcon={<SyncIcon />}
              >
                Start Sync
              </Button>

              {(syncStatus?.status === 'running' || syncStatus?.status === 'paused') && (
                <>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={handlePauseResume}
                    size={isMobile ? "medium" : "large"}
                    startIcon={syncStatus.isPaused ? <PlayArrowIcon /> : <PauseIcon />}
                  >
                    {syncStatus.isPaused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={handleCancel}
                    size={isMobile ? "medium" : "large"}
                    startIcon={<CancelIcon />}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </Box>
            
            {!syncEnabled && !discovering && !discoveryResults && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
                Run discovery first to enable sync
              </Typography>
            )}
            
            {!syncEnabled && discoveryResults?.totalItems === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
                No items found to sync
              </Typography>
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