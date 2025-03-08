import path from 'path';
import os from 'os';

// OAuth 2.0 scopes required for the application
export const SCOPES = [
    'https://www.googleapis.com/auth/photoslibrary.readonly',
    'https://www.googleapis.com/auth/photoslibrary.sharing',
    'profile',
    'email'
];

// File paths
export const PATHS = {
    // Config files
    TOKENS_PATH: path.join(process.cwd(), 'tokens.json'),
    SETTINGS_PATH: path.join(process.cwd(), 'settings.json'),
    CREDENTIALS_PATH: path.join(process.cwd(), 'credentials.json'),
    
    // Application directories
    LOGS_DIR: path.join(process.cwd(), 'logs'),
    TEMP_DIR: path.join(os.tmpdir(), 'google-photos-sync'),
    
    // Default sync directory (can be overridden in settings)
    DEFAULT_SYNC_DIR: path.join(os.homedir(), 'Pictures', 'Google Photos Sync')
};

// Default settings
export const DEFAULT_SETTINGS = {
    syncDir: PATHS.DEFAULT_SYNC_DIR,
    startDate: null,
    endDate: null,
    includeArchived: false,
    syncVideos: true,
    syncPhotos: true,
    cleanupRemovedFiles: true,
    maxConcurrentDownloads: 3,
    retryAttempts: 3,
    retryDelay: 1000, // milliseconds
    autoSync: false,
    autoSyncInterval: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    notifyOnComplete: true,
    notifyOnError: true
};

// API endpoints
export const API_ENDPOINTS = {
    GOOGLE_PHOTOS_BASE: 'https://photoslibrary.googleapis.com/v1',
    GOOGLE_OAUTH_BASE: 'https://oauth2.googleapis.com',
    GOOGLE_TOKEN_INFO: 'https://oauth2.googleapis.com/tokeninfo'
};

// WebSocket message types
export const WS_MESSAGE_TYPES = {
    SYNC_STATUS: 'syncStatus',
    ERROR: 'error',
    INFO: 'info'
};

// Sync status states
export const SYNC_STATUS = {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    ERROR: 'error'
};

// Error messages
export const ERROR_MESSAGES = {
    NOT_AUTHENTICATED: 'User is not authenticated',
    INVALID_CREDENTIALS: 'Invalid credentials',
    TOKEN_EXPIRED: 'Token has expired',
    SYNC_IN_PROGRESS: 'Sync is already in progress',
    SYNC_NOT_RUNNING: 'No sync is currently running',
    SYNC_NOT_PAUSED: 'Sync is not paused',
    INVALID_SETTINGS: 'Invalid settings provided',
    NETWORK_ERROR: 'Network error occurred',
    API_ERROR: 'Google Photos API error',
    FILESYSTEM_ERROR: 'File system error',
    UNKNOWN_ERROR: 'An unknown error occurred'
}; 