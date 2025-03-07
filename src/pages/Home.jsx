import { useState, useEffect, useRef } from 'react';
import { 
  Container, 
  Typography, 
  Button, 
  Box, 
  Paper,
  CircularProgress,
  Alert,
  LinearProgress,
  useMediaQuery,
  useTheme as useMuiTheme
} from '@mui/material';
import { useTheme } from '../context/ThemeContext';
import Logo from '../components/Logo';
import SyncIcon from '@mui/icons-material/Sync';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import CancelIcon from '@mui/icons-material/Cancel';

function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const { isDarkMode } = useTheme();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'));
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      if (!mountedRef.current) return;
      
      try {
        await checkAuthStatus();
        await fetchSyncStatus();
        if (mountedRef.current) {
          setupWebSocket();
        }
      } catch (error) {
        console.error('Initialization error:', error);
        if (mountedRef.current) {
          setError('Failed to initialize application');
        }
      }
    };

    init();

    return () => {
      mountedRef.current = false;
      cleanupWebSocket();
    };
  }, []);

  const cleanupWebSocket = () => {
    if (wsRef.current) {
      console.log('Closing WebSocket connection');
      wsRef.current.onclose = null; // Remove close handler to prevent infinite reconnect loops
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      console.log('Clearing reconnect timeout');
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const setupWebSocket = () => {
    try {
      // Clean up existing connection first
      cleanupWebSocket();
      
      console.log('Setting up WebSocket connection...');
      
      // Add a small delay before connecting to ensure server is ready
      setTimeout(() => {
        if (!mountedRef.current) return;
        
        const ws = new WebSocket('ws://localhost:3000/ws');
        wsRef.current = ws;
        
        // Track connection timeout
        const connectionTimeoutRef = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            console.log('WebSocket connection timed out, retrying...');
            ws.close();
          }
        }, 5000);
        
        // Setup WebSocket handlers
        ws.onopen = () => {
          console.log('WebSocket connected');
          clearTimeout(connectionTimeoutRef);
          setWsConnected(true);
          setError(null);
        };
        
        ws.onmessage = (event) => {
          console.log('WebSocket message:', event.data);
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'syncStatus') {
              console.log('Received sync status update:', data);
              setSyncStatus(data);
            }
            
            if (data.type === 'log') {
              console.log('Server log:', data.message);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(connectionTimeoutRef);
          
          // Don't set an error message immediately, wait for close event
          // This prevents flickering error messages
        };
        
        ws.onclose = (event) => {
          console.log('WebSocket closed, code:', event.code, 'reason:', event.reason || 'unknown');
          clearTimeout(connectionTimeoutRef);
          setWsConnected(false);
          
          // Only show error message if not already showing one and not during unmount
          if (mountedRef.current && !reconnectTimeoutRef.current) {
            console.log('Setting up reconnect timeout');
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (mountedRef.current) {
                console.log('Attempting to reconnect WebSocket...');
                setupWebSocket();
              }
            }, 3000);
          }
        };
      }, 1000); // 1 second delay before connection attempt
    } catch (error) {
      console.error('Error setting up WebSocket:', error);
      setWsConnected(false);
      
      if (mountedRef.current && !reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (mountedRef.current) {
            setupWebSocket();
          }
        }, 3000);
      }
    }
  };

  const fetchSyncStatus = async () => {
    try {
      console.log('Fetching sync status...');
      const response = await fetch('http://localhost:3000/sync/status');
      if (!response.ok) {
        throw new Error('Failed to fetch sync status');
      }
      const status = await response.json();
      console.log('Sync status received:', status);
      setSyncStatus(status);
    } catch (error) {
      console.error('Error fetching sync status:', error);
      // Don't set error state here as it's not critical
    }
  };

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Check URL parameters first
      const url = new URL(window.location.href);
      if (url.searchParams.has('auth')) {
        const authStatus = url.searchParams.get('auth');
        const errorMsg = url.searchParams.get('error');
        
        console.log('Found auth parameter in URL:', authStatus);
        
        if (authStatus === 'success') {
          console.log('Authentication successful, updating state');
          setIsAuthenticated(true);
          localStorage.setItem('isAuthenticated', 'true');
          // Clear the URL parameters
          window.history.replaceState({}, '', window.location.pathname);
        } else if (authStatus === 'error' && errorMsg) {
          console.error('Authentication error from URL:', decodeURIComponent(errorMsg));
          setError(decodeURIComponent(errorMsg));
          setIsAuthenticated(false);
          localStorage.removeItem('isAuthenticated');
          // Clear the URL parameters
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
      
      // If we have isAuthenticated in localStorage and no auth param, use that as a fallback
      const storedAuth = localStorage.getItem('isAuthenticated');
      if (storedAuth === 'true') {
        console.log('Using stored authentication state, verifying with server...');
      }
      
      // Always verify with the server
      console.log('Checking authentication with server...');
      const response = await fetch('http://localhost:3000/check-auth');
      if (!response.ok) {
        throw new Error('Failed to check authentication status');
      }
      
      const data = await response.json();
      console.log('Auth status from server:', data);
      
      setIsAuthenticated(data.authenticated);
      
      if (!data.authenticated) {
        console.log('Server says not authenticated, clearing local state');
        localStorage.removeItem('isAuthenticated');
        if (data.message) {
          console.log('Auth message from server:', data.message);
        }
        if (data.error) {
          throw new Error(data.error);
        }
      } else {
        console.log('Server confirms authenticated, updating local state');
        localStorage.setItem('isAuthenticated', 'true');
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      setError(error.message || 'Failed to check authentication status. Please try logging in again.');
      setIsAuthenticated(false);
      localStorage.removeItem('isAuthenticated');
    } finally {
      setIsLoading(false);
    }
  };

  // Add effect to check auth status when the component mounts and when the URL changes
  useEffect(() => {
    if (!mountedRef.current) return;
    
    const checkAuth = async () => {
      await checkAuthStatus();
    };
    
    checkAuth();
    
    // Listen for URL changes (e.g., after redirect from Google OAuth)
    const handleLocationChange = () => {
      if (mountedRef.current) {
        checkAuth();
      }
    };
    
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const handleLogin = () => {
    try {
      console.log('Login button clicked, redirecting to auth endpoint...');
      setError(null);
      setIsLoading(true);
      
      // Use the current port for the React app
      const reactPort = window.location.port || '5173';
      console.log('Current React app port:', reactPort);
      
      // Try to fetch the auth endpoint first to check server connectivity
      fetch('http://localhost:3000/check-auth')
        .then(response => {
          if (!response.ok) {
            throw new Error('Could not connect to authentication server');
          }
          console.log('Server connection verified, redirecting to Google login...');
          // If server is reachable, redirect to auth endpoint with port parameter
          window.location.href = `http://localhost:3000/auth?port=${reactPort}`;
        })
        .catch(error => {
          console.error('Error during login redirect:', error);
          setError('Could not connect to authentication server. Please try again.');
          setIsLoading(false);
        });
    } catch (error) {
      console.error('Error during login attempt:', error);
      setError('Failed to initiate login process. Please try again.');
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setError(null);
      console.log('Starting sync process...');
      
      // Check for token existence before attempting to sync
      const authResponse = await fetch('http://localhost:3000/check-auth');
      const authData = await authResponse.json();
      
      if (!authData.authenticated) {
        throw new Error('You must be authenticated to start a sync');
      }
      
      // Start the sync process
      const response = await fetch('http://localhost:3000/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start sync');
      }

      const data = await response.json();
      console.log('Sync response:', data);
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to start sync');
      }
      
      // Get updated sync status after starting
      await fetchSyncStatus();
    } catch (error) {
      console.error('Sync error:', error);
      setError(error.message || 'An error occurred while attempting to sync');
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
    } catch (error) {
      console.error('Sync control error:', error);
      setError(error.message);
    }
  };

  if (isLoading) {
    return (
      <Container maxWidth="sm">
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Box>
      {error && (
        <Alert 
          severity="error" 
          sx={{ mb: 2 }}
          action={
            !wsConnected && (
              <Button 
                color="inherit" 
                size="small" 
                onClick={() => setupWebSocket()}
              >
                Retry Connection
              </Button>
            )
          }
        >
          {error}
        </Alert>
      )}

      {!isAuthenticated ? (
        <Box textAlign="center" sx={{ py: 4 }}>
          <Typography 
            variant={isMobile ? "h5" : "h4"} 
            component="h1"
            gutterBottom
          >
            Welcome to Google Photos Sync
          </Typography>
          <Typography 
            variant={isMobile ? "body2" : "body1"} 
            gutterBottom
            sx={{ mb: 3 }}
          >
            Please login with your Google account to start syncing photos.
          </Typography>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={handleLogin}
            size={isMobile ? "medium" : "large"}
            sx={{ mt: 1 }}
          >
            Login with Google
          </Button>
        </Box>
      ) : (
        <Box>
          <Typography 
            variant={isMobile ? "h5" : "h4"} 
            component="h1"
            gutterBottom
            sx={{ mb: 3 }}
          >
            Google Photos Sync Dashboard
          </Typography>
          
          <Typography 
            variant={isMobile ? "body2" : "body1"} 
            gutterBottom
          >
            You are authenticated and ready to sync your photos.
          </Typography>
          
          {syncStatus && (
            <Box sx={{ my: 3 }}>
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

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
            <Button 
              variant="contained" 
              color="primary" 
              onClick={handleSync}
              size={isMobile ? "medium" : "large"}
              disabled={syncStatus?.status === 'running' || syncStatus?.status === 'paused'}
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
        </Box>
      )}
    </Box>
  );
}

export default Home; 