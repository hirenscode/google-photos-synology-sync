import { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Paper,
  Grid,
  TextField,
  Switch,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Button,
  Divider,
  Alert,
  Snackbar,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  useMediaQuery,
  useTheme as useMuiTheme
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import FolderIcon from '@mui/icons-material/Folder';
import { useTheme } from '../context/ThemeContext';

function Settings() {
  const [settings, setSettings] = useState({
    syncFolder: '',
    syncPhotos: true,
    syncVideos: true,
    syncFrequency: 'manual',
    syncTime: '00:00',
    organizationMethod: 'flat',
    namingPattern: 'original',
    compressPhotos: false,
    preserveExif: true,
    convertVideos: false,
    generateThumbnails: false,
    bandwidthLimit: 0,
    concurrentDownloads: 3,
    networkTimeout: 30,
    deleteRemoved: false,
    storageWarning: true,
    useDateRange: false,
    startDate: '',
    endDate: ''
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { isDarkMode } = useTheme();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'));

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000/get-settings');
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }
      const data = await response.json();
      setSettings(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching settings:', error);
      setError('Failed to load settings. Using defaults.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event) => {
    const { name, value, checked, type } = event.target;
    
    setSettings({
      ...settings,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleSave = async () => {
    try {
      setError(null);
      const response = await fetch('http://localhost:3000/save-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });
      
      if (!response.ok) {
        throw new Error('Failed to save settings');
      }
      
      const data = await response.json();
      if (data.success) {
        setSuccess(true);
      } else {
        throw new Error(data.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Settings save error:', error);
      setError(error.message);
    }
  };

  const handleCloseSnackbar = () => {
    setSuccess(false);
  };

  if (loading) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ mt: 2 }}>
          Loading settings...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography 
        variant={isMobile ? "h5" : "h4"} 
        component="h1"
        gutterBottom
        sx={{ mb: 3 }}
      >
        Sync Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Location Settings
            </Typography>
            <Divider sx={{ mb: 2 }} />
          </Grid>
          
          <Grid item xs={12} md={9}>
            <TextField
              fullWidth
              label="Sync Folder"
              name="syncFolder"
              value={settings.syncFolder}
              onChange={handleChange}
              placeholder="/path/to/photos"
              helperText="Location where photos will be saved"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <Button 
              variant="outlined" 
              startIcon={<FolderIcon />}
              fullWidth
              sx={{ height: isMobile ? 'auto' : '56px' }}
            >
              Browse
            </Button>
          </Grid>

          <Grid item xs={12} sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Sync Settings
            </Typography>
            <Divider sx={{ mb: 2 }} />
          </Grid>

          <Grid item xs={12} md={6}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.syncPhotos}
                    onChange={handleChange}
                    name="syncPhotos"
                  />
                }
                label="Sync Photos"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.syncVideos}
                    onChange={handleChange}
                    name="syncVideos"
                  />
                }
                label="Sync Videos"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.compressPhotos}
                    onChange={handleChange}
                    name="compressPhotos"
                  />
                }
                label="Compress Photos"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.preserveExif}
                    onChange={handleChange}
                    name="preserveExif"
                    disabled={!settings.compressPhotos}
                  />
                }
                label="Preserve EXIF Data"
              />
            </FormGroup>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.convertVideos}
                    onChange={handleChange}
                    name="convertVideos"
                  />
                }
                label="Convert Videos"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.generateThumbnails}
                    onChange={handleChange}
                    name="generateThumbnails"
                  />
                }
                label="Generate Thumbnails"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.deleteRemoved}
                    onChange={handleChange}
                    name="deleteRemoved"
                  />
                }
                label="Delete Removed Photos"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.storageWarning}
                    onChange={handleChange}
                    name="storageWarning"
                  />
                }
                label="Storage Warning"
              />
            </FormGroup>
          </Grid>

          <Grid item xs={12} sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Schedule Settings
            </Typography>
            <Divider sx={{ mb: 2 }} />
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel id="sync-frequency-label">Sync Frequency</InputLabel>
              <Select
                labelId="sync-frequency-label"
                name="syncFrequency"
                value={settings.syncFrequency}
                onChange={handleChange}
                label="Sync Frequency"
              >
                <MenuItem value="manual">Manual</MenuItem>
                <MenuItem value="hourly">Hourly</MenuItem>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
              </Select>
            </FormControl>
            
            {settings.syncFrequency !== 'manual' && (
              <TextField
                fullWidth
                label="Sync Time"
                type="time"
                name="syncTime"
                value={settings.syncTime}
                onChange={handleChange}
                InputLabelProps={{
                  shrink: true,
                }}
                inputProps={{
                  step: 300, // 5 min
                }}
              />
            )}
          </Grid>
          
          <Grid item xs={12} md={6}>
            <FormControl component="fieldset" sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.useDateRange}
                    onChange={handleChange}
                    name="useDateRange"
                  />
                }
                label="Filter by Date Range"
              />
            </FormControl>
            
            {settings.useDateRange && (
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Start Date"
                    type="date"
                    name="startDate"
                    value={settings.startDate}
                    onChange={handleChange}
                    InputLabelProps={{
                      shrink: true,
                    }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="End Date"
                    type="date"
                    name="endDate"
                    value={settings.endDate}
                    onChange={handleChange}
                    InputLabelProps={{
                      shrink: true,
                    }}
                  />
                </Grid>
              </Grid>
            )}
          </Grid>
          
          <Grid item xs={12} sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                size="large"
              >
                Save Settings
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>
      
      <Snackbar
        open={success}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity="success" sx={{ width: '100%' }}>
          Settings saved successfully!
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default Settings; 