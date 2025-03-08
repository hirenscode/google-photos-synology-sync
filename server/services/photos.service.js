import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/constants.js';
import logger from './logger.service.js';
import websocketService from './websocket.service.js';

class PhotosService {
    constructor() {
        this.discoveryResults = null;
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.isCancelled = false;
        this.requestsThisMinute = 0;
        this.lastRequestTime = Date.now();
        this.RATE_LIMIT = 250; // Google Photos API limit is 300/minute, we'll stay under it
        this.syncState = new Map(); // Track sync state of files
        this.deletedInGooglePhotos = new Map(); // Track items deleted from Google Photos
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async rateLimitedRequest(requestFn) {
        const now = Date.now();
        const timeElapsedSinceLastRequest = now - this.lastRequestTime;

        // Reset counter if a minute has passed
        if (timeElapsedSinceLastRequest >= 60000) {
            this.requestsThisMinute = 0;
            this.lastRequestTime = now;
        }

        // If we're near the rate limit, wait until the next minute
        if (this.requestsThisMinute >= this.RATE_LIMIT) {
            const waitTime = 60000 - timeElapsedSinceLastRequest;
            logger.info(`Rate limit reached, waiting ${Math.ceil(waitTime/1000)} seconds...`);
            await this.sleep(waitTime);
            this.requestsThisMinute = 0;
            this.lastRequestTime = Date.now();
        }

        try {
            this.requestsThisMinute++;
            return await requestFn();
        } catch (error) {
            if (error.response?.status === 429) {
                // Extract retry delay from response headers or use default
                const retryAfter = parseInt(error.response.headers['retry-after']) || 60;
                logger.info(`Rate limited by API, waiting ${retryAfter} seconds...`);
                await this.sleep(retryAfter * 1000);
                this.requestsThisMinute = 0;
                return await requestFn();
            }
            throw error;
        }
    }

    // Sanitize request params for logging
    sanitizeParamsForLogging(params) {
        return {
            pageSize: params.pageSize,
            pageToken: params.pageToken ? `${params.pageToken.slice(0, 4)}...${params.pageToken.slice(-4)}` : undefined,
            filters: params.filters ? { ...params.filters } : undefined
        };
    }

    // Sanitize error response for logging
    sanitizeErrorForLogging(error) {
        if (!error) return null;
        return {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
            code: error.code,
            // Only include essential error data
            data: error.response?.data ? {
                error: error.response.data.error,
                message: error.response.data.message,
                status: error.response.data.status
            } : undefined
        };
    }

    async getPhotos(auth, options = {}) {
        try {
            if (!auth || !auth.credentials || !auth.credentials.access_token) {
                throw new Error('Invalid authentication: Missing access token');
            }

            // Initialize photo client
            this.photoClient = {
                mediaItems: {
                    list: async (params) => {
                        return this.rateLimitedRequest(async () => {
                            const url = 'https://photoslibrary.googleapis.com/v1/mediaItems';
                            const queryString = new URLSearchParams();
                            
                            if (params.pageSize) {
                                queryString.append('pageSize', params.pageSize);
                            }
                            
                            if (params.pageToken) {
                                queryString.append('pageToken', params.pageToken);
                            }
                            
                            logger.info('Making list request with params:', this.sanitizeParamsForLogging(params));
                            
                            const response = await axios({
                                url: `${url}?${queryString.toString()}`,
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${auth.credentials.access_token}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            return { data: response.data };
                        });
                    }
                }
            };

            let mediaItems = [];
            let photoCount = 0;
            let videoCount = 0;
            let nextPageToken = options.pageToken || null;
            let totalSizeEstimate = 0;
            let pageCount = 0;
            const maxPages = options.discoveryLimit || 5;

            // Main discovery loop
            do {
                if (this.isCancelled) {
                    logger.info('Discovery cancelled');
                    break;
                }

                pageCount++;
                logger.info(`Fetching page ${pageCount} of media items${nextPageToken ? ' (with token)' : ''}...`);

                const response = await this.photoClient.mediaItems.list({
                    pageSize: 100,
                    pageToken: nextPageToken
                });

                if (response?.data?.mediaItems) {
                    const newItems = response.data.mediaItems;
                    logger.info(`Discovered ${newItems.length} media items on page ${pageCount}`);

                    // Count photos and videos
                    newItems.forEach(item => {
                        if (item.mediaMetadata?.photo) {
                            photoCount++;
                            totalSizeEstimate += 5 * 1024 * 1024; // 5MB average
                        } else if (item.mediaMetadata?.video) {
                            videoCount++;
                            totalSizeEstimate += 20 * 1024 * 1024; // 20MB average
                        }
                    });

                    mediaItems = mediaItems.concat(newItems);
                }

                nextPageToken = response?.data?.nextPageToken;

                if (pageCount >= maxPages) {
                    logger.info(`Reached page limit (${maxPages})`);
                    break;
                }
            } while (nextPageToken && !this.isCancelled);

            // Filter by date range if enabled
            let filteredItems = [...mediaItems];
            if (options.useDateRange && options.startDate && options.endDate) {
                logger.info('Filtering discovered items by date range...');
                const startDate = new Date(options.startDate);
                const endDate = new Date(options.endDate);

                filteredItems = mediaItems.filter(item => {
                    if (!item.mediaMetadata || !item.mediaMetadata.creationTime) {
                        return false;
                    }
                    const itemDate = new Date(item.mediaMetadata.creationTime);
                    return itemDate >= startDate && itemDate <= endDate;
                });

                logger.info(`After date filtering: ${filteredItems.length} items (was ${mediaItems.length})`);
            }

            // After fetching all items, check for deletions
            if (this.syncState.size > 0) {
                const currentIds = new Set(mediaItems.map(item => item.id));
                
                // Check each synced item if it still exists in Google Photos
                for (const [itemId, syncData] of this.syncState.entries()) {
                    if (!currentIds.has(itemId) && !this.deletedInGooglePhotos.has(itemId)) {
                        // Item exists locally but not in Google Photos anymore
                        this.deletedInGooglePhotos.set(itemId, {
                            path: syncData.path,
                            deletedTimestamp: Date.now(),
                            originalSyncData: syncData
                        });
                        logger.info(`Detected item deleted from Google Photos: ${path.basename(syncData.path)}`);
                    }
                }
            }

            // Update discovery results
            const continueDiscovery = options.continueDiscovery || false;
            if (!continueDiscovery) {
                // Fresh discovery
                this.discoveryResults = {
                    items: filteredItems,
                    totalItems: mediaItems.length,
                    photoCount,
                    videoCount,
                    filteredItems: filteredItems.length,
                    estimatedSizeBytes: totalSizeEstimate,
                    estimatedSizeMB: Math.round(totalSizeEstimate / (1024 * 1024)),
                    hasMore: !!nextPageToken,
                    pagesScanned: pageCount,
                    dateFiltered: options.useDateRange && options.startDate && options.endDate
                };
            } else if (this.discoveryResults) {
                // Merge with existing results
                this.discoveryResults = {
                    items: [...this.discoveryResults.items, ...filteredItems],
                    totalItems: this.discoveryResults.totalItems + mediaItems.length,
                    photoCount: this.discoveryResults.photoCount + photoCount,
                    videoCount: this.discoveryResults.videoCount + videoCount,
                    filteredItems: this.discoveryResults.filteredItems + filteredItems.length,
                    estimatedSizeBytes: this.discoveryResults.estimatedSizeBytes + totalSizeEstimate,
                    estimatedSizeMB: Math.round((this.discoveryResults.estimatedSizeBytes + totalSizeEstimate) / (1024 * 1024)),
                    hasMore: !!nextPageToken,
                    pagesScanned: this.discoveryResults.pagesScanned + pageCount,
                    dateFiltered: options.useDateRange && options.startDate && options.endDate
                };
            }

            // Add nextPageToken to the filtered items array for pagination
            Object.defineProperty(filteredItems, 'nextPageToken', {
                value: nextPageToken,
                enumerable: true
            });

            logger.info(`Total items fetched: ${filteredItems.length}`);
            return filteredItems;
        } catch (error) {
            logger.error('Error fetching photos:', error);
            throw error;
        }
    }

    buildFilters(options) {
        const filters = {};

        // Date filter remains the same
        if (options.startDate || options.endDate) {
            filters.dateFilter = {
                ranges: [{
                    startDate: options.startDate ? {
                        year: new Date(options.startDate).getFullYear(),
                        month: new Date(options.startDate).getMonth() + 1,
                        day: new Date(options.startDate).getDate()
                    } : undefined,
                    endDate: options.endDate ? {
                        year: new Date(options.endDate).getFullYear(),
                        month: new Date(options.endDate).getMonth() + 1,
                        day: new Date(options.endDate).getDate()
                    } : undefined
                }]
            };
        }

        // Media type filter - only one type at a time
        if (options.mediaType) {
            filters.mediaTypeFilter = {
                mediaTypes: [options.mediaType]
            };
        }

        return filters;
    }

    setDiscoveryResults(results) {
        this.discoveryResults = results;
    }

    getDiscoveryResults() {
        return this.discoveryResults;
    }

    async downloadPhoto(item, targetPath, options = {}) {
        const { retryAttempts = 3, retryDelay = 1000 } = options;
        let attempts = 0;

        // Check for duplicates first
        const duplicatePath = await this.findDuplicateFile(item, path.dirname(targetPath));
        if (duplicatePath) {
            logger.info(`Duplicate file found: ${path.basename(duplicatePath)}`);
            this.syncState.set(item.id, {
                synced: true,
                path: duplicatePath,
                timestamp: Date.now()
            });
            return true;
        }

        // Check if file already exists and has the same size
        try {
            const stats = await fs.promises.stat(targetPath);
            if (stats.size > 0) {
                logger.info(`File already exists and appears valid: ${path.basename(targetPath)}`);
                this.syncState.set(item.id, {
                    synced: true,
                    path: targetPath,
                    timestamp: Date.now()
                });
                return true;
            }
        } catch (error) {
            // File doesn't exist, proceed with download
        }

        while (attempts < retryAttempts) {
            try {
                const response = await axios({
                    method: 'GET',
                    url: item.downloadUrl || item.baseUrl + '=d',
                    responseType: 'stream'
                });

                await new Promise((resolve, reject) => {
                    const writer = fs.createWriteStream(targetPath);
                    response.data.pipe(writer);
                    writer.on('finish', () => {
                        // Update sync state on successful download
                        this.syncState.set(item.id, {
                            synced: true,
                            path: targetPath,
                            timestamp: Date.now()
                        });
                        resolve();
                    });
                    writer.on('error', reject);
                });

                logger.info(`Downloaded: ${path.basename(targetPath)}`);
                return true;
            } catch (error) {
                attempts++;
                if (attempts === retryAttempts) {
                    // Update sync state on failure
                    this.syncState.set(item.id, {
                        synced: false,
                        error: error.message,
                        timestamp: Date.now()
                    });
                    logger.error(`Failed to download ${path.basename(targetPath)} after ${retryAttempts} attempts:`, error);
                    throw error;
                }
                logger.warn(`Retry attempt ${attempts} for ${path.basename(targetPath)}`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    async processDownloadQueue(syncDir, options = {}) {
        const { maxConcurrentDownloads = 3 } = options;

        // Create sync directory if it doesn't exist
        await fs.promises.mkdir(syncDir, { recursive: true });

        // Load existing states
        await this.loadSyncState(syncDir);

        while (this.downloadQueue.length > 0 && !this.isCancelled) {
            if (this.activeDownloads >= maxConcurrentDownloads) {
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }

            const item = this.downloadQueue.shift();
            if (!item) continue;

            // Skip if already successfully synced
            const existingSync = this.syncState.get(item.id);
            if (existingSync && existingSync.synced) {
                logger.info(`Skipping already synced item: ${item.filename}`);
                continue;
            }

            this.activeDownloads++;
            const targetPath = path.join(syncDir, this.generateFileName(item));

            try {
                await this.downloadPhoto(item, targetPath, options);
                // Save sync state periodically
                if (this.downloadQueue.length % 10 === 0) {
                    await this.saveSyncState(syncDir);
                }
                websocketService.updateSyncStatus({
                    processedItems: this.discoveryResults.length - this.downloadQueue.length,
                    totalItems: this.discoveryResults.length,
                    syncedItems: Array.from(this.syncState.values()).filter(state => state.synced).length,
                    deletedInGooglePhotos: this.deletedInGooglePhotos.size
                });
            } catch (error) {
                logger.error(`Error downloading ${item.filename}:`, error);
            } finally {
                this.activeDownloads--;
            }
        }

        // Save final states
        await this.saveSyncState(syncDir);
    }

    async loadSyncState(syncDir) {
        try {
            // Load main sync state
            const statePath = path.join(syncDir, '.sync_state.json');
            const data = await fs.promises.readFile(statePath, 'utf8');
            this.syncState = new Map(JSON.parse(data));
            logger.info(`Loaded sync state with ${this.syncState.size} items`);

            // Load deleted items state
            const deletedPath = path.join(syncDir, '.deleted_items.json');
            try {
                const deletedData = await fs.promises.readFile(deletedPath, 'utf8');
                this.deletedInGooglePhotos = new Map(JSON.parse(deletedData));
                logger.info(`Loaded deleted items state with ${this.deletedInGooglePhotos.size} items`);
            } catch (error) {
                // If file doesn't exist, start with empty deleted items state
                this.deletedInGooglePhotos = new Map();
                logger.info('Starting with fresh deleted items state');
            }
        } catch (error) {
            // If file doesn't exist or is invalid, start with empty states
            this.syncState = new Map();
            this.deletedInGooglePhotos = new Map();
            logger.info('Starting with fresh sync state');
        }
    }

    async saveSyncState(syncDir) {
        try {
            // Save main sync state
            const statePath = path.join(syncDir, '.sync_state.json');
            const data = JSON.stringify(Array.from(this.syncState.entries()));
            await fs.promises.writeFile(statePath, data);

            // Save deleted items state
            const deletedPath = path.join(syncDir, '.deleted_items.json');
            const deletedData = JSON.stringify(Array.from(this.deletedInGooglePhotos.entries()));
            await fs.promises.writeFile(deletedPath, deletedData);
            
            logger.info('Saved sync and deleted items state');
        } catch (error) {
            logger.error('Error saving states:', error);
        }
    }

    generateFileName(item) {
        const { filename } = item;
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        const timestamp = new Date(item.mediaMetadata.creationTime).getTime();
        const uniqueId = item.id.slice(-8); // Add last 8 chars of Google Photos ID to ensure uniqueness
        return `${name}_${timestamp}_${uniqueId}${ext}`;
    }

    async findDuplicateFile(item, syncDir) {
        try {
            // First check sync state by item ID
            const existingSync = this.syncState.get(item.id);
            if (existingSync && existingSync.synced) {
                const existingPath = existingSync.path;
                try {
                    await fs.promises.access(existingPath);
                    return existingPath; // File exists at recorded path
                } catch {
                    // File was moved or deleted, remove from sync state
                    this.syncState.delete(item.id);
                }
            }

            // Then check for files with matching timestamp
            const timestamp = new Date(item.mediaMetadata.creationTime).getTime();
            const files = await fs.promises.readdir(syncDir);
            
            // Look for files with matching timestamp in their name
            const potentialMatches = files.filter(file => 
                file.includes(`_${timestamp}_`) && 
                file.endsWith(path.extname(item.filename))
            );

            for (const match of potentialMatches) {
                const matchPath = path.join(syncDir, match);
                // Extract the Google Photos ID from filename
                const matchId = match.split('_').pop().split('.')[0];
                if (item.id.endsWith(matchId)) {
                    // Found a match with same ID suffix
                    return matchPath;
                }
            }

            return null; // No duplicate found
        } catch (error) {
            logger.error('Error checking for duplicates:', error);
            return null;
        }
    }

    addToDownloadQueue(items) {
        this.downloadQueue.push(...items);
    }

    clearDownloadQueue() {
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.isCancelled = true;
    }

    resetState() {
        this.discoveryResults = null;
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.isCancelled = false;
        // Don't reset syncState and deletedInGooglePhotos as they should persist
    }

    getDeletedItems() {
        return Array.from(this.deletedInGooglePhotos.entries()).map(([id, data]) => ({
            id,
            path: data.path,
            deletedAt: new Date(data.deletedTimestamp).toISOString(),
            originalFilename: path.basename(data.path)
        }));
    }

    async permanentlyDeleteItem(itemId) {
        const deletedItem = this.deletedInGooglePhotos.get(itemId);
        if (!deletedItem) {
            throw new Error('Item not found in deleted items list');
        }

        try {
            // Delete the actual file
            await fs.promises.unlink(deletedItem.path);
            // Remove from tracking
            this.deletedInGooglePhotos.delete(itemId);
            this.syncState.delete(itemId);
            logger.info(`Permanently deleted: ${path.basename(deletedItem.path)}`);
            return true;
        } catch (error) {
            logger.error(`Error permanently deleting item: ${error.message}`);
            throw error;
        }
    }

    async restoreDeletedItem(itemId) {
        const deletedItem = this.deletedInGooglePhotos.get(itemId);
        if (!deletedItem) {
            throw new Error('Item not found in deleted items list');
        }

        // Just remove from deleted items tracking, keeping the file and sync state
        this.deletedInGooglePhotos.delete(itemId);
        logger.info(`Restored item from deleted list: ${path.basename(deletedItem.path)}`);
        return true;
    }
}

const photosService = new PhotosService();
export default photosService; 