import fs from 'fs';
import path from 'path';
import logger from './logger.service.js';
import settingsService from './settings.service.js';

class SyncCacheService {
    constructor() {
        this.syncCache = new Map();
        this.cacheFile = '.sync_cache.json';
        this.isDirty = false;
        this.lastSave = Date.now();
        this.SAVE_INTERVAL = 5 * 60 * 1000; // Save every 5 minutes
        this.CACHE_VERSION = 1; // For future compatibility
    }

    async initialize() {
        try {
            // Get sync directory from settings
            const settings = settingsService.getSettings();
            const syncDir = settings.syncDir || path.join(process.cwd(), 'photos');

            // Ensure sync directory exists
            if (!fs.existsSync(syncDir)) {
                fs.mkdirSync(syncDir, { recursive: true });
            }

            // Update cache file path to use sync directory
            this.cacheFile = path.join(syncDir, '.sync_cache.json');
            
            await this.loadCache();
            this.startPeriodicSave();
            logger.info('Sync cache service initialized');
        } catch (error) {
            logger.error('Error initializing sync cache service:', error);
            throw error;
        }
    }

    async loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
                
                // Version check for future compatibility
                if (data.version === this.CACHE_VERSION) {
                    // Convert the object back to a Map
                    this.syncCache = new Map(Object.entries(data.items));
                    logger.info(`Loaded ${this.syncCache.size} items from sync cache`);
                }
            }
        } catch (error) {
            logger.error('Error loading sync cache:', error);
            // Start fresh if cache is corrupted
            this.syncCache = new Map();
        }
    }

    async saveCache() {
        if (!this.isDirty) return;

        try {
            const data = {
                version: this.CACHE_VERSION,
                lastUpdate: new Date().toISOString(),
                items: Object.fromEntries(this.syncCache)
            };

            fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
            this.isDirty = false;
            this.lastSave = Date.now();
            logger.info(`Saved ${this.syncCache.size} items to sync cache`);
        } catch (error) {
            logger.error('Error saving sync cache:', error);
        }
    }

    startPeriodicSave() {
        setInterval(() => {
            if (this.isDirty && Date.now() - this.lastSave >= this.SAVE_INTERVAL) {
                this.saveCache();
            }
        }, this.SAVE_INTERVAL);
    }

    updateItem(itemId, data) {
        this.syncCache.set(itemId, {
            ...data,
            lastSync: new Date().toISOString()
        });
        this.isDirty = true;
    }

    getItem(itemId) {
        return this.syncCache.get(itemId);
    }

    isItemSynced(itemId) {
        const item = this.syncCache.get(itemId);
        return item ? true : false;
    }

    getSyncedItems() {
        return Array.from(this.syncCache.entries()).map(([id, data]) => ({
            id,
            ...data
        }));
    }

    async cleanup(maxAge = 30 * 24 * 60 * 60 * 1000) { // Default 30 days
        const now = Date.now();
        let cleanupCount = 0;

        for (const [id, data] of this.syncCache.entries()) {
            const syncDate = new Date(data.lastSync).getTime();
            if (now - syncDate > maxAge) {
                this.syncCache.delete(id);
                cleanupCount++;
            }
        }

        if (cleanupCount > 0) {
            this.isDirty = true;
            await this.saveCache();
            logger.info(`Cleaned up ${cleanupCount} old items from sync cache`);
        }
    }

    async reset() {
        this.syncCache.clear();
        this.isDirty = true;
        await this.saveCache();
        logger.info('Sync cache reset');
    }
}

const syncCacheService = new SyncCacheService();
export default syncCacheService; 