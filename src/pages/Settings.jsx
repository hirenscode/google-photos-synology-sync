import React, { useState, useEffect } from 'react';
import {
    Box,
    Tabs,
    Tab,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    Snackbar
} from '@mui/material';
import BasicSettings from '../components/settings/BasicSettings';
import AdvancedSettings from '../components/settings/AdvancedSettings';

const Settings = () => {
    const [activeTab, setActiveTab] = useState(0);
    const [settings, setSettings] = useState(null);
    const [settingsOptions, setSettingsOptions] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        fetchSettings();
        fetchSettingsOptions();
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/settings');
            if (!response.ok) {
                throw new Error('Failed to fetch settings');
            }
            const data = await response.json();
            setSettings(data);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching settings:', error);
            setError('Failed to load settings');
            setLoading(false);
        }
    };

    const fetchSettingsOptions = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/settings/options');
            if (!response.ok) {
                throw new Error('Failed to fetch settings options');
            }
            const data = await response.json();
            setSettingsOptions(data);
        } catch (error) {
            console.error('Error fetching settings options:', error);
            setError('Failed to load settings options');
        }
    };

    const handleSettingsChange = async (newSettings) => {
        try {
            const response = await fetch('http://localhost:3000/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newSettings),
            });

            if (!response.ok) {
                throw new Error('Failed to save settings');
            }

            setSettings(newSettings);
            setSaveSuccess(true);
        } catch (error) {
            console.error('Error saving settings:', error);
            setError('Failed to save settings');
        }
    };

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                <CircularProgress />
            </Box>
        );
    }

    if (!settings) {
        return (
            <Box p={3}>
                <Alert severity="error">
                    Failed to load settings. Please try refreshing the page.
                </Alert>
            </Box>
        );
    }

    return (
        <Box p={3}>
            <Typography variant="h4" gutterBottom>
                Settings
            </Typography>
            
            <Paper sx={{ mt: 3 }}>
                <Tabs
                    value={activeTab}
                    onChange={handleTabChange}
                    indicatorColor="primary"
                    textColor="primary"
                    variant="fullWidth"
                >
                    <Tab label="Basic Settings" />
                    <Tab label="Advanced Settings" />
                </Tabs>

                <Box p={3}>
                    {activeTab === 0 && (
                        <BasicSettings
                            settings={settings}
                            onSettingsChange={handleSettingsChange}
                            settingsOptions={settingsOptions}
                        />
                    )}
                    {activeTab === 1 && (
                        <AdvancedSettings
                            settings={settings}
                            onSettingsChange={handleSettingsChange}
                            settingsOptions={settingsOptions}
                        />
                    )}
                </Box>
            </Paper>

            <Snackbar
                open={error !== null}
                autoHideDuration={6000}
                onClose={() => setError(null)}
            >
                <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                </Alert>
            </Snackbar>

            <Snackbar
                open={saveSuccess}
                autoHideDuration={3000}
                onClose={() => setSaveSuccess(false)}
            >
                <Alert severity="success" onClose={() => setSaveSuccess(false)}>
                    Settings saved successfully
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default Settings; 