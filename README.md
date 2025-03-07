# Google Photos Synology Sync

A powerful web application that syncs your Google Photos library with your Synology NAS, maintaining original quality and metadata.

## Features

- 🖼️ **Original Quality Sync**: Downloads photos and videos in their original quality
- 🎥 **Video Support**: Full support for video files with original quality
- 📅 **Date Range Filtering**: Sync photos from specific time periods
- 🔄 **Incremental Sync**: Smart sync that only downloads new or modified files
- 🗑️ **Deletion Tracking**: Option to remove local files that were deleted from Google Photos
- 📊 **Progress Tracking**: Real-time progress updates via WebSocket
- 🔍 **Discovery Mode**: Preview what will be synced before starting
- 📁 **Flexible Organization**: Various options for organizing your photos
- 🎛️ **Concurrent Downloads**: Configurable number of simultaneous downloads
- 🔒 **Secure Authentication**: Uses OAuth 2.0 for secure Google Photos access

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A Google Cloud Platform account with Google Photos API enabled
- A Synology NAS (or any storage destination)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/google-photos-synology-sync.git
   cd google-photos-synology-sync
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with your Google Cloud credentials:
   ```env
   CLIENT_ID=your_client_id
   CLIENT_SECRET=your_client_secret
   REDIRECT_URI=http://localhost:3000/oauth2callback
   ```

## Configuration

Create a `settings.json` file or use the web interface to configure:

```json
{
  "syncFolder": "/path/to/photos",
  "syncPhotos": true,
  "syncVideos": true,
  "deleteRemoved": false,
  "useDateRange": false,
  "startDate": "",
  "endDate": "",
  "concurrentDownloads": 3,
  "generateThumbnails": false
}
```

## Usage

1. Start the application:
   ```bash
   npm run dev:all
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:5173
   ```

3. Click "Login with Google" and authorize the application

4. Use the web interface to:
   - Configure sync settings
   - Start discovery of photos
   - Begin sync process
   - Monitor progress
   - Pause/Resume/Cancel sync

## API Endpoints

- `GET /check-auth` - Check authentication status
- `GET /auth` - Initiate Google OAuth flow
- `POST /sync` - Start sync process
- `POST /sync/pause` - Pause ongoing sync
- `POST /sync/resume` - Resume paused sync
- `POST /sync/cancel` - Cancel ongoing sync
- `POST /discover` - Start photo discovery
- `GET /get-settings` - Retrieve current settings
- `POST /save-settings` - Update settings

## WebSocket Events

The application uses WebSocket for real-time updates:

- `syncStatus` - Current sync status and progress
- `log` - Detailed operation logs

## Error Handling

- Automatic retry for failed downloads
- Graceful handling of API rate limits
- Detailed error logging
- Network timeout handling

## Security

- Secure token storage
- CORS protection
- OAuth 2.0 implementation
- Environment variable protection

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Google Photos API
- React + Vite
- Express.js
- WebSocket
