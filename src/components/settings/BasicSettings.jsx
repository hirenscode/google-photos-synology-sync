import React from 'react';
import {
  Box,
  TextField,
  FormControlLabel,
  Checkbox,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
  Typography,
  Alert,
  Switch,
  FormGroup,
  Button,
  Divider
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';

// Default cache TTL options in case server options aren't loaded
const DEFAULT_CACHE_OPTIONS = [
  { label: '1 hour', value: 3600000 },
  { label: '6 hours', value: 21600000 },
  { label: '12 hours', value: 43200000 },
  { label: '24 hours', value: 86400000 },
  { label: '48 hours', value: 172800000 },
  { label: '7 days', value: 604800000 }
];

const BasicSettings = ({ settings, onSettingsChange, settingsOptions }) => {
  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    onSettingsChange({ ...settings, [field]: value });
  };

  // Use server options if available, otherwise use defaults
  const cacheOptions = settingsOptions?.cacheTTLOptions || DEFAULT_CACHE_OPTIONS;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Location Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={9}>
          <TextField
            fullWidth
            label="Sync Folder"
            value={settings.syncFolder || ''}
            onChange={handleChange('syncFolder')}
            placeholder="/path/to/photos"
            helperText="Location where photos will be saved"
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <Button
            variant="outlined"
            startIcon={<FolderIcon />}
            fullWidth
            sx={{ height: '56px' }}
          >
            Browse
          </Button>
        </Grid>
      </Grid>

      <Box mt={4}>
        <Typography variant="h6" gutterBottom>
          Cache Settings
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Discovery Cache TTL</InputLabel>
              <Select
                value={settings.discoveryCacheTTL || cacheOptions[3].value} // Default to 24 hours
                onChange={handleChange('discoveryCacheTTL')}
                label="Discovery Cache TTL"
              >
                {cacheOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Sync Cache TTL</InputLabel>
              <Select
                value={settings.syncCacheTTL || cacheOptions[3].value} // Default to 24 hours
                onChange={handleChange('syncCacheTTL')}
                label="Sync Cache TTL"
              >
                {cacheOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enableCaching ?? true}
                  onChange={handleChange('enableCaching')}
                />
              }
              label="Enable Caching"
            />
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              Caching helps reduce API calls and improves performance. Disable only if you need real-time updates.
            </Typography>
          </Grid>
        </Grid>
      </Box>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Sync Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.syncPhotos || false}
                  onChange={handleChange('syncPhotos')}
                />
              }
              label="Sync Photos"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.syncVideos || false}
                  onChange={handleChange('syncVideos')}
                />
              }
              label="Sync Videos"
            />
          </FormGroup>
        </Grid>
        <Grid item xs={12} md={6}>
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.deleteRemoved || false}
                  onChange={handleChange('deleteRemoved')}
                />
              }
              label="Delete Removed Photos"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.storageWarning || false}
                  onChange={handleChange('storageWarning')}
                />
              }
              label="Storage Warning"
            />
          </FormGroup>
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Date Range Filter
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.useDateRange || false}
                onChange={handleChange('useDateRange')}
              />
            }
            label="Filter by Date Range"
          />
        </Grid>
        {settings.useDateRange && (
          <>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={settings.startDate || ''}
                onChange={handleChange('startDate')}
                InputLabelProps={{
                  shrink: true,
                }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={settings.endDate || ''}
                onChange={handleChange('endDate')}
                InputLabelProps={{
                  shrink: true,
                }}
              />
            </Grid>
          </>
        )}
      </Grid>
    </Box>
  );
};

export default BasicSettings; 