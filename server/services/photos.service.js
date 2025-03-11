import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/constants.js';
import logger from './logger.service.js';
import websocketService from './websocket.service.js';
import settingsService from './settings.service.js';
import util from 'util';
import fsPromises from 'fs/promises';

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
        this.BATCH_SIZE = 50; // Process items in batches
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000;
        this.stateSaveInterval = null;
        this.discoveryInProgress = false;
        this.discoveryFile = null;
        this.currentUserId = null;
    }

    async getUserId(auth) {
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth });
            const userInfo = await oauth2.userinfo.get();
            return userInfo.data.id; // Google ID is unique and doesn't expose personal info
        } catch (error) {
            logger.error('Error getting user ID:', error);
            return null;
        }
    }

    getDiscoveryCacheFilename(syncDir, userId) {
        if (!userId) {
            throw new Error('User ID is required for cache file');
        }
        return path.join(syncDir, `.discovery_cache_${userId}.json`);
    }

    async initialize(configDir) {
        try {
            const settings = settingsService.getSettings();
            const syncDir = settings.syncDir || path.join(process.cwd(), 'photos');

            if (!fs.existsSync(syncDir)) {
                fs.mkdirSync(syncDir, { recursive: true });
            }

            // Reset discovery state first
            websocketService.resetDiscovery();

            // Note: We don't load cache here anymore since we don't have user info yet
            // Cache loading will happen in getPhotos when we have auth
            
            logger.info('Photos service initialized');
        } catch (error) {
            logger.error('Error initializing photos service:', error);
            websocketService.resetDiscovery();
            throw error;
        }
    }

    async loadDiscoveryResults() {
        try {
            const data = await fsPromises.readFile(this.discoveryFile, 'utf8');
            this.discoveryResults = JSON.parse(data);
            logger.info(`Loaded discovery results with ${this.discoveryResults.items?.length || 0} items`);
            return this.discoveryResults;
        } catch (error) {
            logger.error('Error loading discovery results:', error);
            throw error;
        }
    }

    async saveDiscoveryResults() {
        if (!this.discoveryFile) {
            logger.error('PhotosService not initialized with config directory');
            return;
        }
        try {
            if (!this.discoveryResults) {
                logger.warn('No discovery results to save');
                return;
            }
            await fsPromises.writeFile(
                this.discoveryFile,
                JSON.stringify(this.discoveryResults, null, 2)
            );
            logger.info(`Saved discovery results with ${this.discoveryResults.items?.length || 0} items`);
        } catch (error) {
            logger.error('Error saving discovery results:', error);
        }
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

            // Get user ID for cache file
            const userId = await this.getUserId(auth);
            if (!userId) {
                throw new Error('Could not get user ID');
            }
            this.currentUserId = userId;

            // Set discovering state
            this.discoveryInProgress = true;
            websocketService.updateDiscoveryProgress({
                status: 'discovering',
                photoCount: 0,
                videoCount: 0,
                totalItems: 0,
                estimatedSizeBytes: 0,
                pagesScanned: 0
            });

            const settings = settingsService.getSettings();
            const syncDir = settings.syncDir || path.join(process.cwd(), 'photos');

            // Try to load from cache first if not forcing fresh discovery
            if (!options.forceFreshDiscovery) {
                const cachedResults = await this.loadDiscoveryCache(syncDir, options);
                if (cachedResults) {
                    this.discoveryInProgress = false;
                    websocketService.completeDiscovery({
                        ...cachedResults,
                        status: 'complete',
                        isComplete: true
                    });
                    return cachedResults.items;
                }
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
            const allPages = [];

            // Main discovery loop
            do {
                if (this.isCancelled) {
                    logger.info('Discovery cancelled');
                    this.discoveryInProgress = false;
                    websocketService.completeDiscovery({
                        status: 'cancelled',
                        photoCount,
                        videoCount,
                        totalItems: mediaItems.length,
                        estimatedSizeBytes: totalSizeEstimate,
                        pagesScanned: pageCount,
                        isComplete: true
                    });
                    break;
                }

                pageCount++;
                const orderMessage = options.syncOrder === 'oldest' 
                    ? '(scanning entire library for oldest-first ordering)' 
                    : nextPageToken ? ' (with token)' : '';
                logger.info(`Fetching page ${pageCount} of media items ${orderMessage}...`);

                const response = await this.photoClient.mediaItems.list({
                    pageSize: 100,
                    pageToken: nextPageToken
                });

                if (response?.data?.mediaItems) {
                    const newItems = response.data.mediaItems;
                    logger.info(`Discovered ${newItems.length} media items on page ${pageCount}`);

                    // Store each page separately
                    allPages.push(newItems);

                    // Count photos and videos and calculate size
                    newItems.forEach(item => {
                        if (item.mediaMetadata?.photo) {
                            photoCount++;
                        } else if (item.mediaMetadata?.video) {
                            videoCount++;
                        }
                        // Estimate size from mediaMetadata if available
                        if (item.mediaMetadata?.width && item.mediaMetadata?.height) {
                            // Rough estimate: 2MB per megapixel for photos, 10MB per megapixel for videos
                            const megapixels = (item.mediaMetadata.width * item.mediaMetadata.height) / 1000000;
                            totalSizeEstimate += item.mediaMetadata.video ? 
                                megapixels * 10 * 1024 * 1024 : 
                                megapixels * 2 * 1024 * 1024;
                        }
                    });

                    // Update WebSocket with progress
                    websocketService.updateDiscoveryProgress({
                        status: 'discovering',
                        photoCount,
                        videoCount,
                        totalItems: mediaItems.length + newItems.length,
                        estimatedSizeBytes: totalSizeEstimate,
                        pagesScanned: pageCount
                    });

                    // Add items to the total collection
                    mediaItems = mediaItems.concat(newItems);
                }

                nextPageToken = response?.data?.nextPageToken;

                // Break if we've reached the page limit
                if (maxPages && pageCount >= maxPages) {
                    logger.info(`Reached maximum page limit of ${maxPages}`);
                    break;
                }

                // Small delay between pages to avoid overwhelming the API
                await this.sleep(100);

            } while (nextPageToken);

            // Process and save results
            const results = {
                items: mediaItems,
                photoCount,
                videoCount,
                totalItems: mediaItems.length,
                estimatedSizeBytes: totalSizeEstimate,
                pagesScanned: pageCount,
                timestamp: Date.now()
            };

            this.discoveryResults = results;
            await this.saveDiscoveryResults();

            // Mark discovery as complete
            this.discoveryInProgress = false;
            websocketService.completeDiscovery({
                ...results,
                status: 'complete',
                isComplete: true
            });

            return mediaItems;

        } catch (error) {
            logger.error('Error in getPhotos:', error);
            this.discoveryInProgress = false;
            websocketService.completeDiscovery({
                status: 'error',
                error: error.message,
                isComplete: true
            });
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
        // Save results to persistent storage
        this.saveDiscoveryResults();
        // Update WebSocket service with the new results
        if (results) {
            websocketService.updateDiscoveryProgress({
                ...results,
                status: 'complete',
                isComplete: true
            });
        }
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
        const settings = settingsService.getSettings();
        const { maxConcurrentDownloads = settings.maxConcurrentDownloads } = options;

        try {
            await fs.promises.mkdir(syncDir, { recursive: true });
            await this.loadSyncState(syncDir);
            this.startPeriodicStateSave(syncDir);

            // Sort items based on settings
            const sortedItems = this.sortItemsBySettings(this.downloadQueue);
            this.downloadQueue = sortedItems;

            while (this.downloadQueue.length > 0 && !this.isCancelled) {
                const batchSize = Math.min(settings.batchSize, this.downloadQueue.length);
                const batch = this.downloadQueue.slice(0, batchSize);

                await Promise.all(
                    batch.map(async (item) => {
                        if (this.activeDownloads >= maxConcurrentDownloads) {
                            await this.sleep(100);
                        }
                        this.activeDownloads++;
                        try {
                            await this.processItem(item, syncDir, options);
                        } finally {
                            this.activeDownloads--;
                        }
                    })
                );

                this.downloadQueue.splice(0, batchSize);
                await this.updateSyncStatus();
            }

            if (settings.autoOrganize) {
                await this.cleanupEmptyDirs(syncDir);
            }

            // Process any failed downloads
            await this.retryFailedDownloads(syncDir, options);
            
            // Final state save
            await this.saveSyncState(syncDir);
            this.stopPeriodicStateSave();
        } catch (error) {
            logger.error('Error in download queue processing:', error);
            throw error;
        }
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
        try {
            if (!item || !item.mediaMetadata || !item.mediaMetadata.creationTime) {
                logger.error('Invalid item passed to generateFileName:', item);
                throw new Error('Invalid item: missing required metadata');
            }

            const { filename, id } = item;
            const ext = path.extname(filename || '');
            const name = path.basename(filename || id, ext);
            const timestamp = new Date(item.mediaMetadata.creationTime).getTime();
            const uniqueId = id.slice(-8);

            // If timestamp is invalid, use current time as fallback
            const finalTimestamp = isNaN(timestamp) ? Date.now() : timestamp;

            return `${name}_${finalTimestamp}_${uniqueId}${ext}`;
        } catch (error) {
            logger.error('Error generating filename:', error);
            // Fallback to a safe filename using just the ID
            const ext = item.mediaType === 'video' ? '.mp4' : '.jpg';
            return `${item.id || 'unknown'}_${Date.now()}${ext}`;
        }
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

    // Add periodic state saving
    startPeriodicStateSave(syncDir) {
        this.stopPeriodicStateSave(); // Clear any existing interval
        this.stateSaveInterval = setInterval(async () => {
            if (this.syncState.size > 0) {
                await this.saveSyncState(syncDir);
            }
        }, 5 * 60 * 1000); // Save every 5 minutes
    }

    stopPeriodicStateSave() {
        if (this.stateSaveInterval) {
            clearInterval(this.stateSaveInterval);
            this.stateSaveInterval = null;
        }
    }

    // Memory-efficient batch processing
    async processBatch(items, syncDir, options = {}) {
        const batch = items.slice(0, this.BATCH_SIZE);
        await Promise.all(
            batch.map(item => this.processItem(item, syncDir, options))
        );
        
        // Clear processed items from memory
        items.splice(0, this.BATCH_SIZE);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    }

    async processItem(item, syncDir, options) {
        if (this.isCancelled) return;

        const settings = settingsService.getSettings();
        const creationDate = new Date(item.mediaMetadata.creationTime);
        
        // Generate target directory based on settings
        const targetDir = settings.autoOrganize 
            ? settingsService.generateFolderPath(creationDate, syncDir)
            : syncDir;

        // Ensure target directory exists
        await fs.promises.mkdir(targetDir, { recursive: true });

        const targetPath = path.join(targetDir, this.generateFileName(item));
        
        try {
            await this.downloadPhoto(item, targetPath, options);
        } catch (error) {
            logger.error(`Error processing item ${item.filename}:`, error);
            if (this.shouldRetry(error)) {
                this.addToRetryQueue(item);
            }
        }
    }

    shouldRetry(error) {
        const retryableErrors = [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'NETWORK_ERROR'
        ];
        return retryableErrors.includes(error.code) || error.response?.status >= 500;
    }

    // Improved error handling and retry mechanism
    async retryFailedDownloads(syncDir, options = {}) {
        const failedItems = Array.from(this.syncState.entries())
            .filter(([_, data]) => !data.synced)
            .map(([id, _]) => this.discoveryResults.items.find(item => item.id === id))
            .filter(Boolean);

        if (failedItems.length > 0) {
            logger.info(`Retrying ${failedItems.length} failed downloads...`);
            for (const item of failedItems) {
                if (this.isCancelled) break;
                await this.processItem(item, syncDir, options);
            }
        }
    }

    async updateSyncStatus() {
        const stats = {
            processedItems: this.discoveryResults.length - this.downloadQueue.length,
            totalItems: this.discoveryResults.length,
            syncedItems: Array.from(this.syncState.values()).filter(state => state.synced).length,
            deletedInGooglePhotos: this.deletedInGooglePhotos.size,
            failedItems: Array.from(this.syncState.values()).filter(state => !state.synced).length,
            activeDownloads: this.activeDownloads
        };

        websocketService.updateSyncStatus(stats);
    }

    // Improved cleanup
    cleanup() {
        this.stopPeriodicStateSave();
        this.clearDownloadQueue();
        this.discoveryResults = null;
        // Don't clear syncState and deletedInGooglePhotos as they should persist
        if (global.gc) {
            global.gc();
        }
    }

    // Add method to get sync statistics
    getSyncStats() {
        return {
            totalSynced: Array.from(this.syncState.values()).filter(state => state.synced).length,
            totalFailed: Array.from(this.syncState.values()).filter(state => !state.synced).length,
            totalDeleted: this.deletedInGooglePhotos.size,
            totalDiscovered: this.discoveryResults?.totalItems || 0,
            lastSyncTimestamp: Math.max(
                ...Array.from(this.syncState.values()).map(state => state.timestamp)
            ),
            estimatedStorageUsed: Array.from(this.syncState.values())
                .filter(state => state.synced)
                .reduce((total, state) => {
                    try {
                        const stats = fs.statSync(state.path);
                        return total + stats.size;
                    } catch {
                        return total;
                    }
                }, 0)
        };
    }

    // Add method to organize photos by date
    async organizeByDate(syncDir) {
        const items = Array.from(this.syncState.values())
            .filter(item => item.synced);

        for (const item of items) {
            try {
                const stats = await fs.promises.stat(item.path);
                const date = new Date(stats.mtime);
                const year = date.getFullYear().toString();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                
                const yearDir = path.join(syncDir, year);
                const monthDir = path.join(yearDir, month);
                
                await fs.promises.mkdir(yearDir, { recursive: true });
                await fs.promises.mkdir(monthDir, { recursive: true });
                
                const newPath = path.join(monthDir, path.basename(item.path));
                if (item.path !== newPath) {
                    await fs.promises.rename(item.path, newPath);
                    item.path = newPath;
                }
            } catch (error) {
                logger.error(`Error organizing file ${item.path}:`, error);
            }
        }
        
        await this.saveSyncState(syncDir);
    }

    // Add method to verify file integrity
    async verifyIntegrity(syncDir) {
        const results = {
            verified: 0,
            missing: 0,
            corrupted: 0,
            total: this.syncState.size
        };

        for (const [id, item] of this.syncState.entries()) {
            try {
                const stats = await fs.promises.stat(item.path);
                if (stats.size === 0) {
                    results.corrupted++;
                    logger.warn(`Zero-byte file detected: ${item.path}`);
                } else {
                    results.verified++;
                }
            } catch (error) {
                if (error.code === 'ENOENT') {
                    results.missing++;
                    logger.warn(`Missing file detected: ${item.path}`);
                }
            }
        }

        return results;
    }

    // Add method to monitor storage usage
    async getStorageStats(syncDir) {
        const du = util.promisify(require('child_process').exec);
        try {
            const { stdout } = await du(`du -sb "${syncDir}"`);
            const totalBytes = parseInt(stdout.split('\t')[0]);
            
            const stats = {
                totalSize: totalBytes,
                totalSizeHuman: this.formatBytes(totalBytes),
                photoCount: Array.from(this.syncState.values())
                    .filter(item => item.path.match(/\.(jpg|jpeg|png|gif)$/i)).length,
                videoCount: Array.from(this.syncState.values())
                    .filter(item => item.path.match(/\.(mp4|mov|avi)$/i)).length,
                byYear: new Map()
            };

            // Calculate storage by year
            for (const item of this.syncState.values()) {
                try {
                    const fileStats = await fs.promises.stat(item.path);
                    const year = new Date(fileStats.mtime).getFullYear();
                    if (!stats.byYear.has(year)) {
                        stats.byYear.set(year, { size: 0, count: 0 });
                    }
                    const yearStats = stats.byYear.get(year);
                    yearStats.size += fileStats.size;
                    yearStats.count++;
                } catch (error) {
                    logger.error(`Error getting stats for ${item.path}:`, error);
                }
            }

            return stats;
        } catch (error) {
            logger.error('Error getting storage stats:', error);
            throw error;
        }
    }

    formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    // Add method to generate reports
    async generateReport(syncDir) {
        const storageStats = await this.getStorageStats(syncDir);
        const integrityResults = await this.verifyIntegrity(syncDir);
        const syncStats = this.getSyncStats();

        const report = {
            timestamp: new Date().toISOString(),
            storage: storageStats,
            integrity: integrityResults,
            sync: syncStats,
            deletedItems: {
                count: this.deletedInGooglePhotos.size,
                items: this.getDeletedItems()
            }
        };

        // Save report
        const reportPath = path.join(syncDir, 'reports');
        await fs.promises.mkdir(reportPath, { recursive: true });
        await fs.promises.writeFile(
            path.join(reportPath, `report_${Date.now()}.json`),
            JSON.stringify(report, null, 2)
        );

        return report;
    }

    // Add method to clean up empty directories
    async cleanupEmptyDirs(syncDir) {
        const cleanupDir = async (dir) => {
            const items = await fs.promises.readdir(dir);
            
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = await fs.promises.stat(fullPath);
                
                if (stats.isDirectory()) {
                    const isEmpty = await cleanupDir(fullPath);
                    if (isEmpty) {
                        await fs.promises.rmdir(fullPath);
                        logger.info(`Removed empty directory: ${fullPath}`);
                    }
                }
            }
            
            // Check if directory is empty after processing subdirectories
            const remaining = await fs.promises.readdir(dir);
            return remaining.length === 0;
        };

        await cleanupDir(syncDir);
    }

    // Add method to sort items based on settings
    sortItemsBySettings(items) {
        const settings = settingsService.getSettings();
        const sortedItems = [...items];

        switch (settings.syncOrder) {
            case 'newest':
                sortedItems.sort((a, b) => 
                    new Date(b.mediaMetadata.creationTime) - new Date(a.mediaMetadata.creationTime)
                );
                break;
            
            case 'oldest':
                sortedItems.sort((a, b) => 
                    new Date(a.mediaMetadata.creationTime) - new Date(b.mediaMetadata.creationTime)
                );
                break;
            
            case 'random':
                for (let i = sortedItems.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [sortedItems[i], sortedItems[j]] = [sortedItems[j], sortedItems[i]];
                }
                break;
        }

        return sortedItems;
    }

    async saveDiscoveryCache(syncDir) {
        try {
            if (!this.currentUserId) {
                logger.warn('No user ID available, skipping cache save');
                return;
            }

            const cachePath = this.getDiscoveryCacheFilename(syncDir, this.currentUserId);
            const cacheData = {
                timestamp: Date.now(),
                userId: this.currentUserId,
                results: this.discoveryResults
            };
            await fs.promises.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
            logger.info('Discovery results cached successfully');
        } catch (error) {
            logger.error('Error saving discovery cache:', error);
        }
    }

    async loadDiscoveryCache(syncDir, options = {}) {
        try {
            const settings = settingsService.getSettings();
            if (!settings.enableCaching) {
                logger.info('Caching is disabled in settings');
                return null;
            }

            if (!this.currentUserId) {
                logger.warn('No user ID available, cannot load cache');
                return null;
            }

            const cachePath = this.getDiscoveryCacheFilename(syncDir, this.currentUserId);
            const cacheData = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
            
            // Verify cache belongs to current user
            if (cacheData.userId !== this.currentUserId) {
                logger.warn('Cache file belongs to different user, ignoring');
                return null;
            }

            // Check if cache is still valid using TTL from settings
            const cacheAge = Date.now() - cacheData.timestamp;
            if (cacheAge > settings.discoveryCacheTTL) {
                logger.info(`Discovery cache is too old (${Math.round(cacheAge / (60 * 60 * 1000))} hours), will perform fresh discovery`);
                return null;
            }

            // If force fresh discovery is requested, ignore cache
            if (options.forceFreshDiscovery) {
                logger.info('Force fresh discovery requested, ignoring cache');
                return null;
            }

            // Format the results properly
            const formattedResults = {
                items: cacheData.results.items || [],
                photoCount: cacheData.results.photoCount || 0,
                videoCount: cacheData.results.videoCount || 0,
                totalItems: cacheData.results.totalItems || 0,
                estimatedSizeBytes: cacheData.results.estimatedSizeBytes || 0,
                pagesScanned: cacheData.results.pagesScanned || 0,
                timestamp: cacheData.timestamp,
                cacheAge: cacheAge,
                cacheTTL: settings.discoveryCacheTTL
            };

            this.discoveryResults = formattedResults;
            logger.info(`Loaded cached discovery results with ${formattedResults.totalItems} items (cache age: ${Math.round(cacheAge / (60 * 1000))} minutes)`);

            // Update WebSocket service with the cached results
            websocketService.completeDiscovery({
                ...formattedResults,
                status: 'complete',
                isComplete: true,
                fromCache: true
            });

            return formattedResults;
        } catch (error) {
            logger.info('No valid discovery cache found or error loading cache:', error);
            websocketService.resetDiscovery();
            return null;
        }
    }

    clearDiscoveryResults() {
        this.discoveryResults = null;
        // Remove the discovery results file if it exists
        if (this.discoveryFile) {
            fs.promises.unlink(this.discoveryFile).catch(error => {
                if (error.code !== 'ENOENT') {
                    logger.error('Error removing discovery results file:', error);
                }
            });
        }
    }

    isDiscovering() {
        return this.discoveryInProgress;
    }
}

const photosService = new PhotosService();
export default photosService; 