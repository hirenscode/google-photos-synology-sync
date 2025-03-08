import fs from 'fs';
import { PATHS, DEFAULT_SETTINGS } from '../config/constants.js';
import logger from './logger.service.js';

class SettingsService {
    constructor() {
        this.settings = null;
        this.loadSettings();
    }

    loadSettings() {
        try {
            if (fs.existsSync(PATHS.SETTINGS_PATH)) {
                const settingsData = fs.readFileSync(PATHS.SETTINGS_PATH, 'utf8');
                this.settings = JSON.parse(settingsData);
                logger.info('Settings loaded successfully');
            } else {
                this.settings = { ...DEFAULT_SETTINGS };
                this.saveSettings(this.settings);
                logger.info('Default settings created and saved');
            }
            return this.settings;
        } catch (error) {
            logger.error('Error loading settings:', error);
            this.settings = { ...DEFAULT_SETTINGS };
            return this.settings;
        }
    }

    saveSettings(newSettings) {
        try {
            // Validate required fields
            if (!newSettings.syncDir) {
                throw new Error('syncDir is required');
            }

            // Merge with existing settings
            this.settings = {
                ...this.settings,
                ...newSettings
            };

            // Ensure the sync directory exists
            if (!fs.existsSync(this.settings.syncDir)) {
                fs.mkdirSync(this.settings.syncDir, { recursive: true });
            }

            // Save to file
            fs.writeFileSync(
                PATHS.SETTINGS_PATH,
                JSON.stringify(this.settings, null, 2)
            );

            logger.info('Settings saved successfully');
            return true;
        } catch (error) {
            logger.error('Error saving settings:', error);
            throw error;
        }
    }

    getSettings() {
        return this.settings || this.loadSettings();
    }

    updateSettings(updates) {
        try {
            const newSettings = {
                ...this.settings,
                ...updates
            };
            return this.saveSettings(newSettings);
        } catch (error) {
            logger.error('Error updating settings:', error);
            throw error;
        }
    }

    validateSettings(settings) {
        const errors = [];

        // Check required fields
        if (!settings.syncDir) {
            errors.push('Sync directory is required');
        }

        // Validate date range if specified
        if (settings.startDate && settings.endDate) {
            const start = new Date(settings.startDate);
            const end = new Date(settings.endDate);
            if (start > end) {
                errors.push('Start date must be before end date');
            }
        }

        // Validate numeric values
        if (settings.maxConcurrentDownloads && settings.maxConcurrentDownloads < 1) {
            errors.push('Maximum concurrent downloads must be at least 1');
        }

        if (settings.retryAttempts && settings.retryAttempts < 0) {
            errors.push('Retry attempts must be 0 or greater');
        }

        if (settings.retryDelay && settings.retryDelay < 0) {
            errors.push('Retry delay must be 0 or greater');
        }

        if (settings.autoSyncInterval && settings.autoSyncInterval < 60000) {
            errors.push('Auto sync interval must be at least 1 minute (60000 ms)');
        }

        return errors;
    }

    resetSettings() {
        try {
            this.settings = { ...DEFAULT_SETTINGS };
            this.saveSettings(this.settings);
            logger.info('Settings reset to defaults');
            return true;
        } catch (error) {
            logger.error('Error resetting settings:', error);
            throw error;
        }
    }

    async checkStorageSpace(folder) {
        try {
            const { stdout } = await execAsync(`df -h "${folder}"`);
            const lines = stdout.split('\n');
            const [, diskInfo] = lines;
            const [, size, used, available, usePercent] = diskInfo.split(/\s+/);
            return {
                total: size,
                used,
                available,
                usePercent: parseInt(usePercent)
            };
        } catch (error) {
            console.error(`Error checking storage space: ${error.message}`);
            return null;
        }
    }
}

const settingsService = new SettingsService();
export default settingsService; 