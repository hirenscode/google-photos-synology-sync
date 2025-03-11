import express from 'express';
import settingsService from '../services/settings.service.js';
import logger from '../services/logger.service.js';

const router = express.Router();

// Get current settings
router.get('/get-settings', async (req, res) => {
    try {
        const settings = settingsService.getSettings();
        const options = settingsService.getSettingsOptions();
        res.json({
            settings,
            options
        });
    } catch (error) {
        logger.error('Error getting settings:', error);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// Update settings
router.post('/update-settings', async (req, res) => {
    try {
        const newSettings = req.body;
        const updatedSettings = await settingsService.updateSettings(newSettings);
        res.json(updatedSettings);
    } catch (error) {
        logger.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Get folder organization preview
router.post('/preview-organization', async (req, res) => {
    try {
        const { date, baseDir } = req.body;
        const previewPath = settingsService.generateFolderPath(new Date(date), baseDir);
        res.json({ previewPath });
    } catch (error) {
        logger.error('Error generating preview:', error);
        res.status(500).json({ error: 'Failed to generate preview' });
    }
});

export default router; 