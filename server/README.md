# Google Photos Synology Sync Server

This is the server component of the Google Photos Synology Sync application. It handles the synchronization of photos from Google Photos to a local directory, with support for real-time progress updates and configuration management.

## Features

- OAuth2 authentication with Google Photos API
- Real-time sync progress updates via WebSocket
- Configurable sync settings
- Concurrent photo downloads
- Automatic retry mechanism for failed downloads
- File cleanup for removed photos
- Comprehensive logging system
- Date range filtering support
- Photo and video type filtering

## Project Structure

```
server/
├── config/
│   └── constants.js         # Application constants and configuration
├── routes/
│   └── api.routes.js        # API route definitions
├── services/
│   ├── auth.service.js      # Google OAuth authentication
│   ├── logger.service.js    # Logging functionality
│   ├── photos.service.js    # Google Photos API integration
│   ├── settings.service.js  # Settings management
│   ├── sync.service.js      # Sync orchestration
│   └── websocket.service.js # Real-time updates
└── index.js                 # Main application entry point
```

## API Endpoints

### Authentication Routes
- `GET /api/check-auth` - Check authentication status
- `GET /api/auth` - Initiate Google OAuth flow
- `GET /api/oauth2callback` - OAuth callback handler
- `POST /api/logout` - Logout and clear tokens

### Settings Routes
- `GET /api/settings` - Get current settings
- `POST /api/settings` - Update settings

### Sync Routes
- `GET /api/sync/status` - Get current sync status
- `POST /api/sync` - Start sync process
- `POST /api/sync/pause` - Pause ongoing sync
- `POST /api/sync/resume` - Resume paused sync
- `POST /api/sync/cancel` - Cancel ongoing sync

### Discovery Routes
- `POST /api/discover` - Discover photos from Google Photos

## WebSocket Events

The server uses WebSocket for real-time updates with the following message types:
- `syncStatus` - Updates about sync progress
- `error` - Error notifications
- `info` - General information updates

## Configuration

### Default Settings
```javascript
{
    syncDir: "<default_photos_directory>",
    startDate: null,
    endDate: null,
    includeArchived: false,
    syncVideos: true,
    syncPhotos: true,
    cleanupRemovedFiles: true,
    maxConcurrentDownloads: 3,
    retryAttempts: 3,
    retryDelay: 1000,
    autoSync: false,
    autoSyncInterval: 86400000,
    notifyOnComplete: true,
    notifyOnError: true
}
```

### Required Files
- `credentials.json` - Google OAuth credentials
- `tokens.json` - OAuth tokens (created automatically)
- `settings.json` - User settings (created automatically)

## Services

### AuthService
Handles Google OAuth authentication flow and token management.

### PhotosService
Manages interaction with Google Photos API, including:
- Photo discovery
- Download queue management
- Concurrent downloads
- Retry mechanism

### SyncService
Orchestrates the sync process:
- Manages sync state
- Coordinates photo downloads
- Handles cleanup of removed files
- Provides sync control (pause/resume/cancel)

### SettingsService
Manages application settings:
- Loading/saving settings
- Settings validation
- Default settings handling

### WebSocketService
Handles real-time communication:
- Client connection management
- Status updates broadcasting
- Sync progress reporting

### LoggerService
Provides logging functionality:
- File-based logging
- Console output in development
- Error tracking
- Structured log format

## Error Handling

The application includes comprehensive error handling for:
- Authentication failures
- Network issues
- File system errors
- API errors
- Invalid settings
- Sync process failures

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `credentials.json` file with your Google OAuth credentials.

3. Start the server:
   ```bash
   npm start
   ```

The server will start on port 3000 by default.

## Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode ('development' or 'production')

## Dependencies

- `express` - Web framework
- `ws` - WebSocket server
- `googleapis` - Google API client
- `axios` - HTTP client
- `winston` - Logging
- `cors` - Cross-origin resource sharing

## Development

For development mode with enhanced logging:
```bash
npm run dev
```

## Logging

Logs are stored in the `logs` directory:
- `error.log` - Error messages
- `combined.log` - All log messages

## Security

- OAuth 2.0 authentication
- CORS enabled
- Token verification
- Secure file permissions
- Error message sanitization 