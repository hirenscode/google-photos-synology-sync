import fs from 'fs/promises';
import path from 'path';
import logger from './logger.service.js';

class SettingsService {
    constructor() {
        this.settings = {
            syncDir: path.join(process.cwd(), 'photos'), // Default sync directory
            syncOrder: 'newest', // 'newest', 'oldest', 'random'
            folderStructure: 'year/month', // 'year/month', 'year/month/date', 'year/month_date', 'year_month_date', 'flat'
            autoOrganize: true, // Whether to automatically organize files during sync
            batchSize: 50,
            maxConcurrentDownloads: 3,
            autoRetry: true,
            retryAttempts: 3,
            saveStateInterval: 5, // minutes
            discoveryCacheTTL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
            syncCacheTTL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
            enableCaching: true // Whether to use caching at all
        };
        this.configPath = null;
    }

    async initialize(configDir) {
        this.configPath = path.join(configDir, 'settings.json');
        try {
            await fs.access(this.configPath);
            const data = await fs.readFile(this.configPath, 'utf8');
            this.settings = { ...this.settings, ...JSON.parse(data) };
            logger.info('Settings loaded successfully');
        } catch (error) {
            if (error.code === 'ENOENT') {
                await this.saveSettings();
                logger.info('Created default settings file');
            } else {
                logger.error('Error loading settings:', error);
            }
        }
    }

    async saveSettings() {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(this.settings, null, 2));
            logger.info('Settings saved successfully');
        } catch (error) {
            logger.error('Error saving settings:', error);
            throw error;
        }
    }

    async updateSettings(newSettings) {
        this.settings = {
            ...this.settings,
            ...newSettings
        };
        await this.saveSettings();
        return this.settings;
    }

    getSettings() {
        return { ...this.settings };
    }

    // Helper method to generate folder path based on date and settings
    generateFolderPath(date, baseDir) {
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');

        switch (this.settings.folderStructure) {
            case 'year/month':
                return path.join(baseDir, year, month);
            
            case 'year/month/date':
                return path.join(baseDir, year, month, day);
            
            case 'year/month_date':
                return path.join(baseDir, year, `${month}_${day}`);
            
            case 'year_month_date':
                return path.join(baseDir, `${year}_${month}_${day}`);
            
            case 'flat':
                return baseDir;
            
            default:
                return path.join(baseDir, year, month);
        }
    }

    // Get available settings options
    getSettingsOptions() {
        const isProduction = process.env.NODE_ENV === 'production';
        const isSynology = fs.existsSync('/etc/synoinfo.conf') || fs.existsSync('/etc/synology_model_name');

        let syncDirDescription = 'Directory where photos and videos will be synced';
        if (isSynology) {
            syncDirDescription = 'Select a shared folder or volume path on your Synology NAS (e.g., /volume1/photos or /var/services/homes/your-user/photos)';
        } else if (isProduction) {
            syncDirDescription = 'Select a permanent storage location with sufficient space for your photos and videos';
        }

        return {
            syncOrder: [
                { value: 'newest', label: 'Newest First' },
                { value: 'oldest', label: 'Oldest First' },
                { value: 'random', label: 'Random Order' }
            ],
            folderStructure: [
                { value: 'year/month', label: 'Year/Month (2012/08)' },
                { value: 'year/month/date', label: 'Year/Month/Date (2012/08/29)' },
                { value: 'year/month_date', label: 'Year/Month_Date (2012/08_29)' },
                { value: 'year_month_date', label: 'Year_Month_Date (2012_08_29)' },
                { value: 'flat', label: 'No Folders (Flat Structure)' }
            ],
            syncDir: {
                type: 'string',
                label: 'Sync Directory',
                description: syncDirDescription,
                default: path.join(process.cwd(), 'photos'),
                isProduction: isProduction || isSynology,
                examples: isSynology ? [
                    '/volume1/photos',
                    '/volume2/google-photos',
                    '/var/services/homes/your-user/photos'
                ] : []
            },
            cacheTTLOptions: [
                { label: '1 hour', value: 60 * 60 * 1000 },
                { label: '6 hours', value: 6 * 60 * 60 * 1000 },
                { label: '12 hours', value: 12 * 60 * 60 * 1000 },
                { label: '24 hours', value: 24 * 60 * 60 * 1000 },
                { label: '48 hours', value: 48 * 60 * 60 * 1000 },
                { label: '7 days', value: 7 * 24 * 60 * 60 * 1000 }
            ]
        };
    }
}

const settingsService = new SettingsService();
export default settingsService; 