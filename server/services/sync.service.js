import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import settingsService from './settings.service.js';
import photosService from './photos.service.js';
import websocketService from './websocket.service.js';
import logger from './logger.service.js';
import axios from 'axios';

class SyncService {
    constructor() {
        this.syncInProgress = false;
        this.currentBatch = [];
        this.pageToken = null;
    }

    async getSyncStatus() {
        try {
            return {
                status: websocketService.currentSync.status,
                progress: websocketService.currentSync.totalItems > 0 
                    ? Math.round((websocketService.currentSync.processedItems / websocketService.currentSync.totalItems) * 100)
                    : 0,
                totalItems: websocketService.currentSync.totalItems,
                processedItems: websocketService.currentSync.processedItems,
                isPaused: websocketService.currentSync.isPaused,
                isCancelled: websocketService.currentSync.isCancelled,
                message: websocketService.currentSync.message
            };
        } catch (error) {
            logger.error('Error getting sync status:', error);
            throw error;
        }
    }

    async startSync(auth) {
        if (this.syncInProgress) {
            throw new Error('Sync is already in progress');
        }

        try {
            this.syncInProgress = true;
            websocketService.resetSyncStatus();

            // Load settings
            const settings = settingsService.loadSettings();
            const syncDir = settings.syncDir || 'photos';
            
            // Create sync directory if it doesn't exist
            if (!fs.existsSync(syncDir)) {
                fs.mkdirSync(syncDir, { recursive: true });
            }

            // Check if any sync type is enabled
            if (!settings.syncPhotos && !settings.syncVideos) {
                throw new Error('Both photos and videos are disabled in settings. Enable at least one type to sync.');
            }

            // Check storage space
            const storage = await this.checkStorageSpace(syncDir);
            if (storage && storage.usePercent > 90) {
                logger.warn('Storage space is running low!');
                if (settings.notificationEmail) {
                    // TODO: Implement email notification service
                    logger.info(`Would send email to ${settings.notificationEmail} about low storage`);
                }
            }
            
            websocketService.updateSyncStatus({
                status: 'running',
                message: 'Starting sync process...'
            });

            // Get photos from discovery results
            const discoveryResults = photosService.getDiscoveryResults();
            if (!discoveryResults || !discoveryResults.items || discoveryResults.items.length === 0) {
                throw new Error('No photos found to sync. Run discovery first.');
            }

            const photos = discoveryResults.items;
            logger.info(`Found ${photos.length} items to sync`);
            
            websocketService.updateSyncStatus({
                totalItems: photos.length,
                message: `Found ${photos.length} items to sync`
            });

            // Prepare download queue with full media details
            logger.info('Preparing download queue...');
            const queue = await Promise.all(photos.map(async photo => {
                try {
                    const isVideo = photo.mediaMetadata.video;
                    const extension = isVideo ? '.mp4' : '.jpg';
                    
                    // Skip based on media type settings
                    if ((!settings.syncPhotos && !isVideo) || (!settings.syncVideos && isVideo)) {
                        return null;
                    }
                    
                    // Construct the proper download URL
                    const downloadUrl = isVideo ? 
                        `${photo.baseUrl}=dv` : // Original video quality
                        `${photo.baseUrl}=d`;   // Original photo quality
                    
                    return {
                        id: photo.id,
                        filename: `${photo.id}${extension}`,
                        downloadUrl: downloadUrl,
                        mediaType: isVideo ? 'video' : 'photo',
                        width: photo.mediaMetadata.width,
                        height: photo.mediaMetadata.height,
                        creationTime: photo.mediaMetadata.creationTime
                    };
                } catch (error) {
                    logger.error(`Error preparing item ${photo.id}:`, error);
                    return null;
                }
            }));

            // Filter out skipped and failed items
            const validQueue = queue.filter(item => item !== null);
            logger.info(`Prepared ${validQueue.length} items for download`);

            if (validQueue.length === 0) {
                logger.info('No items to download after filtering');
                websocketService.updateSyncStatus({
                    status: 'completed',
                    message: 'No items to download after filtering'
                });
                return;
            }

            // Set up concurrent downloads
            const concurrentDownloads = Math.min(settings.concurrentDownloads || 3, 5);
            const activeDownloads = new Map(); // Using Map to store promises
            let processedItems = 0;

            while ((validQueue.length > 0 || activeDownloads.size > 0) && !websocketService.currentSync.isCancelled) {
                if (websocketService.currentSync.isPaused) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                // Start new downloads if possible
                while (validQueue.length > 0 && 
                       activeDownloads.size < concurrentDownloads && 
                       !websocketService.currentSync.isPaused && 
                       !websocketService.currentSync.isCancelled) {
                    const item = validQueue.shift();
                    const filepath = path.join(syncDir, item.filename);
                    
                    if (!fs.existsSync(filepath)) {
                        logger.info(`Starting download of ${item.mediaType}: ${item.filename} (${item.width}x${item.height})`);
                        
                        // Create download promise
                        const downloadPromise = this.downloadItem(item, filepath, settings)
                            .then(() => {
                                processedItems++;
                                websocketService.updateSyncStatus({
                                    processedItems: processedItems,
                                    message: `Downloaded ${item.filename}`
                                });
                            })
                            .catch(error => {
                                logger.error(`Error downloading ${item.filename}:`, error);
                            })
                            .finally(() => {
                                activeDownloads.delete(item.id);
                            });
                        
                        activeDownloads.set(item.id, downloadPromise);
                    } else {
                        processedItems++;
                        websocketService.updateSyncStatus({
                            processedItems: processedItems,
                            message: `Skipped: ${item.filename} (already exists)`
                        });
                    }
                }

                // Wait for at least one download to complete
                if (activeDownloads.size > 0) {
                    await Promise.race(activeDownloads.values());
                }
            }

            // Wait for remaining downloads to complete
            if (activeDownloads.size > 0) {
                await Promise.all(activeDownloads.values());
            }

            // Handle cleanup if enabled
            if (!websocketService.currentSync.isCancelled && settings.cleanupRemovedFiles) {
                await this.cleanupRemovedFiles(syncDir, photos);
            }

            // Update final status
            if (websocketService.currentSync.isCancelled) {
                websocketService.updateSyncStatus({
                    status: 'cancelled',
                    message: 'Sync cancelled by user'
                });
            } else if (websocketService.currentSync.isPaused) {
                websocketService.updateSyncStatus({
                    status: 'paused',
                    message: 'Sync paused by user'
                });
            } else {
                websocketService.updateSyncStatus({
                    status: 'completed',
                    message: `Sync completed. Processed ${processedItems} items.`
                });
            }
        } catch (error) {
            logger.error('Sync error:', error);
            websocketService.updateSyncStatus({
                status: 'error',
                message: `Sync error: ${error.message}`
            });
        } finally {
            this.syncInProgress = false;
        }
    }

    async downloadItem(item, filepath, settings) {
        try {
            // Make a HEAD request to get the file size
            const headResponse = await axios.head(item.downloadUrl);
            const fileSize = headResponse.headers['content-length'];
            const fileSizeMB = fileSize ? (fileSize / (1024 * 1024)).toFixed(2) : 'unknown';
            logger.info(`File size: ${fileSizeMB} MB`);

            // Download the file
            const response = await axios({
                method: 'GET',
                url: item.downloadUrl,
                responseType: 'stream'
            });

            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(filepath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Verify the downloaded file size
            const downloadedSize = fs.statSync(filepath).size;
            const downloadedSizeMB = (downloadedSize / (1024 * 1024)).toFixed(2);
            logger.info(`Successfully downloaded ${item.filename} (${downloadedSizeMB} MB)`);

            // Set file modification time to match creation time
            const creationTime = new Date(item.creationTime);
            await fs.promises.utimes(filepath, creationTime, creationTime);

            return true;
        } catch (error) {
            logger.error(`Error downloading ${item.filename}:`, error);
            throw error;
        }
    }

    async checkStorageSpace(directory) {
        try {
            const execAsync = promisify(exec);
            const { stdout } = await execAsync(`df -h "${directory}"`);
            const lines = stdout.trim().split('\n');
            const parts = lines[1].split(/\s+/);
            
            return {
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usePercent: parseInt(parts[4]),
                mountPoint: parts[5]
            };
        } catch (error) {
            logger.error('Error checking storage space:', error);
            return null;
        }
    }

    async cleanupRemovedFiles(syncDir, currentPhotos) {
        try {
            websocketService.updateSyncStatus({
                message: 'Cleaning up removed files...'
            });

            const files = await fs.promises.readdir(syncDir);
            const currentPhotoNames = new Set(
                currentPhotos.map(photo => this.generatePhotoFileName(photo))
            );

            for (const file of files) {
                if (!currentPhotoNames.has(file)) {
                    const filePath = path.join(syncDir, file);
                    try {
                        await fs.promises.unlink(filePath);
                        logger.info(`Removed file: ${file}`);
                    } catch (error) {
                        logger.error(`Error removing file ${file}:`, error);
                    }
                }
            }

            logger.info('Cleanup completed');
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
    }

    generatePhotoFileName(photo) {
        const { filename } = photo;
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        const timestamp = new Date(photo.mediaMetadata.creationTime).getTime();
        return `${name}_${timestamp}${ext}`;
    }

    pauseSync() {
        if (!this.syncInProgress) {
            throw new Error('No sync in progress');
        }
        websocketService.updateSyncStatus({
            status: 'paused',
            message: 'Sync paused'
        });
    }

    resumeSync() {
        if (!this.syncInProgress) {
            throw new Error('No sync in progress');
        }
        websocketService.updateSyncStatus({
            status: 'running',
            message: 'Sync resumed'
        });
    }

    cancelSync() {
        if (!this.syncInProgress) {
            throw new Error('No sync in progress');
        }
        photosService.clearDownloadQueue();
        websocketService.updateSyncStatus({
            status: 'cancelled',
            message: 'Sync cancelled'
        });
        this.syncInProgress = false;
    }

    getLastSyncTime() {
        return this.lastSyncTime;
    }

    isSyncing() {
        return this.syncInProgress;
    }
}

const syncService = new SyncService();
export default syncService; 