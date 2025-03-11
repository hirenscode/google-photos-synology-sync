import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import settingsService from './settings.service.js';
import photosService from './photos.service.js';
import websocketService from './websocket.service.js';
import syncCacheService from './sync.cache.service.js';
import logger from './logger.service.js';
import axios from 'axios';

class SyncService {
    constructor() {
        this.syncInProgress = false;
        this.currentBatch = [];
        this.pageToken = null;
        // Check if we're running on Synology or in production
        this.isProduction = process.env.NODE_ENV === 'production' || this.isRunningOnSynology();
        this.verificationInProgress = false;
    }

    isRunningOnSynology() {
        try {
            // Check for Synology-specific paths or files
            return fs.existsSync('/etc/synoinfo.conf') || fs.existsSync('/etc/synology_model_name');
        } catch {
            return false;
        }
    }

    validateSyncDirectory(syncDir) {
        if (!this.isProduction) {
            return { isValid: true };
        }

        // In production/Synology, enforce proper sync directory selection
        if (!syncDir || syncDir === 'photos' || syncDir === path.join(process.cwd(), 'photos')) {
            return {
                isValid: false,
                error: 'Please select a proper sync directory in settings before starting sync. ' +
                       'For Synology, this should typically be a shared folder or volume path.'
            };
        }

        try {
            // Check if directory exists and is writable
            if (!fs.existsSync(syncDir)) {
                return {
                    isValid: false,
                    error: `Sync directory "${syncDir}" does not exist. Please create it first or select a different location.`
                };
            }

            // Try to write a test file to check permissions
            const testFile = path.join(syncDir, '.write_test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);

            return { isValid: true };
        } catch (error) {
            return {
                isValid: false,
                error: `Cannot write to sync directory "${syncDir}". Please check permissions or select a different location.`
            };
        }
    }

    async getSyncStatus() {
        try {
            // Initialize with default values in case photosService is not ready
            const defaultStats = {
                totalSynced: 0,
                totalDiscovered: 0,
                lastSyncTimestamp: null
            };

            let syncStats;
            try {
                syncStats = photosService.getSyncStats();
            } catch (error) {
                logger.warn('Could not get sync stats:', error);
                syncStats = defaultStats;
            }

            return {
                status: websocketService.currentSync.status || 'idle',
                progress: websocketService.currentSync.totalItems > 0 
                    ? Math.round((websocketService.currentSync.processedItems / websocketService.currentSync.totalItems) * 100)
                    : 0,
                totalItems: websocketService.currentSync.totalItems || 0,
                processedItems: websocketService.currentSync.processedItems || 0,
                isPaused: websocketService.currentSync.isPaused || false,
                isCancelled: websocketService.currentSync.isCancelled || false,
                message: websocketService.currentSync.message || 'Ready to sync',
                syncedFiles: syncStats.totalSynced || 0,
                remainingFiles: (syncStats.totalDiscovered || 0) - (syncStats.totalSynced || 0),
                lastSyncTimestamp: syncStats.lastSyncTimestamp,
                syncDir: settingsService.getSettings().syncDir
            };
        } catch (error) {
            logger.error('Error getting sync status:', error);
            // Return a minimal status instead of throwing
            return {
                status: 'error',
                message: 'Error getting sync status',
                error: error.message
            };
        }
    }

    async downloadItem(item, syncDir) {
        try {
            // Check if item is already synced
            const cachedItem = syncCacheService.getItem(item.id);
            if (cachedItem && fs.existsSync(cachedItem.localPath)) {
                logger.info(`Item ${item.id} already synced at ${cachedItem.localPath}`);
                return { success: true, skipped: true };
            }

            const fileName = await photosService.generateFileName(item);
            const filePath = path.join(syncDir, fileName);

            // Download the file
            const response = await axios({
                method: 'get',
                url: item.baseUrl,
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Update sync cache with the new item
            syncCacheService.updateItem(item.id, {
                localPath: filePath,
                fileName: fileName,
                mediaMetadata: item.mediaMetadata,
                mimeType: item.mimeType
            });

            return { success: true, filePath };
        } catch (error) {
            logger.error(`Error downloading item ${item.id}:`, error);
            return { success: false, error: error.message };
        }
    }

    async verifyExistingFiles(syncDir, discoveryItems) {
        try {
            if (this.verificationInProgress) {
                logger.warn('Verification already in progress');
                return;
            }

            this.verificationInProgress = true;
            logger.info('Starting verification of existing files...');
            websocketService.updateSyncStatus({
                status: 'verifying',
                message: 'Verifying existing files...',
                progress: 0
            });

            // Get all files recursively from sync directory
            const getAllFiles = async (dir) => {
                const files = await fs.promises.readdir(dir, { withFileTypes: true });
                const paths = await Promise.all(files.map(async (file) => {
                    const filePath = path.join(dir, file.name);
                    if (file.isDirectory()) {
                        return getAllFiles(filePath);
                    }
                    return filePath;
                }));
                return paths.flat();
            };

            const existingFiles = await getAllFiles(syncDir);
            const totalFiles = existingFiles.length;
            let verifiedCount = 0;

            // Match existing files with discovery items
            for (const filePath of existingFiles) {
                if (websocketService.currentSync.isCancelled) {
                    break;
                }

                const fileName = path.basename(filePath);
                // Find matching discovery item by comparing file names or patterns
                const matchingItem = discoveryItems.find(item => {
                    const expectedFileName = photosService.generateFileName(item);
                    return fileName === expectedFileName;
                });

                if (matchingItem) {
                    // Update sync cache with verified file
                    syncCacheService.updateItem(matchingItem.id, {
                        localPath: filePath,
                        fileName: fileName,
                        mediaMetadata: matchingItem.mediaMetadata,
                        mimeType: matchingItem.mimeType,
                        verified: true
                    });
                }

                verifiedCount++;
                const progress = Math.round((verifiedCount / totalFiles) * 100);
                websocketService.updateSyncStatus({
                    status: 'verifying',
                    progress,
                    message: `Verified ${verifiedCount} of ${totalFiles} files`
                });
            }

            logger.info(`Verification complete. Found ${syncCacheService.syncCache.size} matching files`);
            return syncCacheService.syncCache.size;

        } catch (error) {
            logger.error('Error verifying existing files:', error);
            throw error;
        } finally {
            this.verificationInProgress = false;
        }
    }

    async startSync(auth) {
        try {
            this.syncInProgress = true;
            websocketService.updateSyncStatus({
                status: 'initializing',
                progress: 0,
                message: 'Initializing sync process...'
            });

            const settings = settingsService.getSettings();
            const syncDir = settings.syncDir || path.join(process.cwd(), 'photos');

            // Validate sync directory
            const validation = this.validateSyncDirectory(syncDir);
            if (!validation.isValid) {
                throw new Error(validation.error);
            }

            // Create sync directory if it doesn't exist
            if (!fs.existsSync(syncDir)) {
                fs.mkdirSync(syncDir, { recursive: true });
            }

            // Get discovery results
            let discoveryResults = photosService.getDiscoveryResults();
            
            // If no discovery results, try to load from cache
            if (!discoveryResults || !discoveryResults.items || discoveryResults.items.length === 0) {
                logger.info('No discovery results found, checking discovery cache...');
                await photosService.loadDiscoveryCache();
                discoveryResults = photosService.getDiscoveryResults();
                
                if (!discoveryResults || !discoveryResults.items || discoveryResults.items.length === 0) {
                    throw new Error('No items found in discovery cache. Please run discovery first.');
                }
                logger.info(`Loaded ${discoveryResults.items.length} items from discovery cache`);
            }

            // Verify existing files against discovery results
            await this.verifyExistingFiles(syncDir, discoveryResults.items);

            // Filter out already synced and verified items
            const itemsToSync = discoveryResults.items.filter(item => {
                const cachedItem = syncCacheService.getItem(item.id);
                return !cachedItem || !cachedItem.verified || !fs.existsSync(cachedItem.localPath);
            });

            if (itemsToSync.length === 0) {
                logger.info('All items are already synced and verified');
                websocketService.updateSyncStatus({
                    status: 'completed',
                    progress: 100,
                    message: 'All items are already synced and verified'
                });
                return;
            }

            logger.info(`Found ${itemsToSync.length} items to sync`);
            websocketService.updateSyncStatus({
                status: 'running',
                progress: 0,
                message: `Starting sync of ${itemsToSync.length} items...`
            });

            const totalItems = itemsToSync.length;
            let processedItems = 0;

            // Process items in batches
            for (const item of itemsToSync) {
                if (websocketService.currentSync.isCancelled) {
                    break;
                }

                if (websocketService.currentSync.isPaused) {
                    await new Promise(resolve => {
                        const checkPause = setInterval(() => {
                            if (!websocketService.currentSync.isPaused) {
                                clearInterval(checkPause);
                                resolve();
                            }
                        }, 1000);
                    });
                }

                const result = await this.downloadItem(item, syncDir);
                processedItems++;

                // Update progress
                const progress = Math.round((processedItems / totalItems) * 100);
                websocketService.updateSyncStatus({
                    status: 'running',
                    progress,
                    processedItems,
                    totalItems,
                    message: result.skipped ? 
                        `Skipped ${result.filePath} (already synced)` : 
                        `Synced ${result.filePath}`
                });

                // Mark item as verified after successful sync
                if (result.success) {
                    const cachedItem = syncCacheService.getItem(item.id);
                    if (cachedItem) {
                        syncCacheService.updateItem(item.id, {
                            ...cachedItem,
                            verified: true
                        });
                    }
                }
            }

            // Clean up old cache entries
            await syncCacheService.cleanup();

            websocketService.updateSyncStatus({
                status: 'completed',
                progress: 100,
                message: `Sync completed. ${processedItems} items processed.`
            });

        } catch (error) {
            logger.error('Sync error:', error);
            websocketService.updateSyncStatus({
                status: 'error',
                message: error.message
            });
        } finally {
            this.syncInProgress = false;
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