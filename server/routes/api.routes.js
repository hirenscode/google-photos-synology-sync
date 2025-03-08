import express from 'express';
import { SCOPES } from '../config/constants.js';
import authService from '../services/auth.service.js';
import settingsService from '../services/settings.service.js';
import syncService from '../services/sync.service.js';
import photosService from '../services/photos.service.js';
import logger from '../services/logger.service.js';
import websocketService from '../services/websocket.service.js';

const router = express.Router();

// Auth routes
router.get('/check-auth', async (req, res) => {
    try {
        logger.info('Checking authentication status...');
        const auth = await authService.authenticate();
        
        if (auth) {
            logger.info('Authentication successful');
            res.json({ 
                authenticated: true, 
                message: 'User is authenticated' 
            });
        } else {
            logger.info('Authentication failed or no tokens available');
            res.json({ 
                authenticated: false, 
                message: 'User is not authenticated' 
            });
        }
    } catch (error) {
        logger.error('Error checking auth status:', error);
        res.json({ 
            authenticated: false, 
            message: 'Error checking authentication status', 
            error: error.message 
        });
    }
});

router.get('/auth', (req, res) => {
    logger.info('Auth endpoint hit, generating auth URL...');
    const reactAppPort = req.query.port || '5173';
    process.env.REACT_APP_PORT = reactAppPort;
    const authUrl = authService.generateAuthUrl(SCOPES, reactAppPort);
    logger.info('Redirecting to Google auth URL:', authUrl);
    res.redirect(authUrl);
});

router.get('/oauth2callback', async (req, res) => {
    const { code, error: authError, state } = req.query;
    const reactAppPort = state || process.env.REACT_APP_PORT || '5173';
    const baseRedirectUrl = `http://localhost:${reactAppPort}`;
    
    if (authError) {
        logger.error('Error returned from Google OAuth:', authError);
        return res.redirect(`${baseRedirectUrl}/?auth=error&error=` + encodeURIComponent('Google authorization error: ' + authError));
    }
    
    if (!code) {
        logger.error('No authorization code received');
        return res.redirect(`${baseRedirectUrl}/?auth=error&error=` + encodeURIComponent('No authorization code received'));
    }
    
    try {
        const tokens = await authService.getTokens(code);
        authService.setCredentials(tokens);
        authService.saveTokens(tokens);
        logger.info('Authentication successful');
        res.redirect(`${baseRedirectUrl}/?auth=success`);
    } catch (error) {
        logger.error('Error in OAuth callback:', error);
        authService.deleteTokens();
        res.redirect(`${baseRedirectUrl}/?auth=error&error=${encodeURIComponent(error.message)}`);
    }
});

router.post('/logout', (req, res) => {
    try {
        authService.deleteTokens();
        res.json({ success: true });
    } catch (error) {
        logger.error('Error during logout:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Settings routes
router.get('/settings', (req, res) => {
    try {
        const settings = settingsService.loadSettings();
        res.json(settings);
    } catch (error) {
        logger.error('Error reading settings:', error);
        res.status(500).json({ error: 'Failed to read settings' });
    }
});

router.post('/settings', (req, res) => {
    try {
        settingsService.saveSettings(req.body);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error saving settings:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Sync routes
router.get('/sync/status', async (req, res) => {
    try {
        const status = await syncService.getSyncStatus();
        res.json(status);
    } catch (error) {
        logger.error('Error getting sync status:', error);
        res.status(500).json({ error: 'Failed to get sync status' });
    }
});

router.post('/sync', async (req, res) => {
    try {
        if (websocketService.currentSync.status === 'running' || websocketService.currentSync.status === 'paused') {
            return res.status(400).json({ error: 'Sync is already in progress' });
        }

        const auth = await authService.authenticate();
        if (!auth) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        syncService.startSync(auth).catch(error => {
            logger.error('Sync error:', error);
        });

        res.json({ success: true, message: 'Sync started' });
    } catch (error) {
        logger.error('Error starting sync:', error);
        res.status(500).json({ error: 'Failed to start sync' });
    }
});

router.post('/sync/pause', (req, res) => {
    try {
        if (websocketService.currentSync.status === 'running') {
            websocketService.updateSyncStatus({
                isPaused: true,
                status: 'paused'
            });
            logger.info('Sync paused by user');
            res.json({ success: true, message: 'Sync paused' });
        } else {
            res.status(400).json({ error: 'Sync is not running' });
        }
    } catch (error) {
        logger.error('Error pausing sync:', error);
        res.status(500).json({ error: 'Failed to pause sync' });
    }
});

router.post('/sync/resume', (req, res) => {
    try {
        if (websocketService.currentSync.status === 'paused') {
            websocketService.updateSyncStatus({
                isPaused: false,
                status: 'running'
            });
            logger.info('Sync resumed by user');
            res.json({ success: true, message: 'Sync resumed' });
        } else {
            res.status(400).json({ error: 'Sync is not paused' });
        }
    } catch (error) {
        logger.error('Error resuming sync:', error);
        res.status(500).json({ error: 'Failed to resume sync' });
    }
});

router.post('/sync/cancel', (req, res) => {
    try {
        if (websocketService.currentSync.status === 'running' || websocketService.currentSync.status === 'paused') {
            websocketService.updateSyncStatus({
                isCancelled: true,
                status: 'cancelled'
            });
            logger.info('Sync cancelled by user');
            res.json({ success: true, message: 'Sync cancelled' });
        } else {
            res.status(400).json({ error: 'No sync in progress' });
        }
    } catch (error) {
        logger.error('Error cancelling sync:', error);
        res.status(500).json({ error: 'Failed to cancel sync' });
    }
});

// Discovery routes
router.post('/discover', async (req, res) => {
    try {
        logger.info('Discovery request received');
        
        const auth = await authService.authenticate();
        if (!auth) {
            logger.error('Authentication failed during discovery');
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication failed. Please log in again.' 
            });
        }
        
        const settings = settingsService.loadSettings();
        const discoveryOptions = {
            ...settings,
            continueDiscovery: req.body?.continueDiscovery || false,
            pageToken: req.body?.pageToken || null
        };
        
        // Reset the photos service state before starting new discovery
        if (!discoveryOptions.continueDiscovery) {
            photosService.resetState();
        }
        
        try {
            // Get photos using the updated service
            const photos = await photosService.getPhotos(auth, discoveryOptions);
            
            if (!photos || !Array.isArray(photos)) {
                throw new Error('Invalid response from Google Photos API');
            }
            
            // Discovery results are now handled inside getPhotos method
            // Just get the summary for the response
            const discoveryResults = photosService.getDiscoveryResults();
            
            if (!discoveryResults) {
                throw new Error('Failed to get discovery results');
            }
            
            logger.info('Discovery completed successfully', { 
                totalItems: discoveryResults.totalItems,
                photoCount: discoveryResults.photoCount,
                videoCount: discoveryResults.videoCount
            });
            
            res.json({
                success: true,
                discovery: {
                    totalItems: discoveryResults.totalItems,
                    photoCount: discoveryResults.photoCount,
                    videoCount: discoveryResults.videoCount,
                    estimatedSizeBytes: discoveryResults.estimatedSizeBytes,
                    estimatedSizeMB: discoveryResults.estimatedSizeMB,
                    hasMore: discoveryResults.hasMore,
                    nextPageToken: photos.nextPageToken,
                    pagesScanned: discoveryResults.pagesScanned
                }
            });
        } catch (photoError) {
            logger.error('Error fetching photos:', photoError.message);
            // Send a more specific error status based on the error
            if (photoError.message.includes('Authentication') || photoError.message.includes('token')) {
                return res.status(401).json({
                    success: false,
                    error: photoError.message
                });
            }
            throw photoError; // Re-throw for general error handling
        }
    } catch (error) {
        logger.error('Error during discovery:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to discover photos' 
        });
    }
});

export default router; 