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
  Divider,
  FormHelperText
} from '@mui/material';

const AdvancedSettings = ({ settings, onSettingsChange }) => {
  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    onSettingsChange({ ...settings, [field]: value });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        File Organization
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>Organization Method</InputLabel>
            <Select
              value={settings.folderStructure}
              onChange={handleChange('folderStructure')}
              label="Organization Method"
            >
              <MenuItem value="year/month">Year/Month (2012/08)</MenuItem>
              <MenuItem value="year/month/date">Year/Month/Date (2012/08/29)</MenuItem>
              <MenuItem value="year/month_date">Year/Month_Date (2012/08_29)</MenuItem>
              <MenuItem value="year_month_date">Year_Month_Date (2012_08_29)</MenuItem>
              <MenuItem value="flat">Flat Structure</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>Sync Order</InputLabel>
            <Select
              value={settings.syncOrder}
              onChange={handleChange('syncOrder')}
              label="Sync Order"
            >
              <MenuItem value="newest">Newest First (Default)</MenuItem>
              <MenuItem value="oldest">Oldest First (Requires full library scan)</MenuItem>
              <MenuItem value="random">Random Order</MenuItem>
            </Select>
            <FormHelperText>
              Note: Due to Google Photos API limitations, selecting "Oldest First" requires scanning your entire library before starting the sync.
            </FormHelperText>
          </FormControl>
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.autoOrganize}
                onChange={handleChange('autoOrganize')}
              />
            }
            label="Automatically organize files during sync"
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Performance Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            type="number"
            label="Batch Size"
            value={settings.batchSize}
            onChange={handleChange('batchSize')}
            inputProps={{ min: 10, max: 100 }}
            helperText="Number of items to process in each batch (10-100)"
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            type="number"
            label="Concurrent Downloads"
            value={settings.maxConcurrentDownloads}
            onChange={handleChange('maxConcurrentDownloads')}
            inputProps={{ min: 1, max: 10 }}
            helperText="Maximum parallel downloads (1-10)"
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Media Processing
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography variant="subtitle1" gutterBottom>
            Photo Processing
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.compressPhotos}
                onChange={handleChange('compressPhotos')}
              />
            }
            label="Compress photos"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.preserveExif}
                onChange={handleChange('preserveExif')}
              />
            }
            label="Preserve EXIF data"
          />
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1" gutterBottom>
            Video Processing
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.convertVideos}
                onChange={handleChange('convertVideos')}
              />
            }
            label="Convert videos to MP4"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.generateThumbnails}
                onChange={handleChange('generateThumbnails')}
              />
            }
            label="Generate thumbnails"
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Network Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="number"
            label="Bandwidth Limit (MB/s)"
            value={settings.bandwidthLimit}
            onChange={handleChange('bandwidthLimit')}
            inputProps={{ min: 0, step: 0.1 }}
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="number"
            label="Network Timeout (seconds)"
            value={settings.networkTimeout}
            onChange={handleChange('networkTimeout')}
            inputProps={{ min: 10, max: 300 }}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Backup Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Backup Location"
            value={settings.backupLocation}
            onChange={handleChange('backupLocation')}
            helperText="Path to backup folder"
          />
        </Grid>
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>Backup Schedule</InputLabel>
            <Select
              value={settings.backupSchedule}
              onChange={handleChange('backupSchedule')}
              label="Backup Schedule"
            >
              <MenuItem value="none">No Backup</MenuItem>
              <MenuItem value="daily">Daily</MenuItem>
              <MenuItem value="weekly">Weekly</MenuItem>
              <MenuItem value="monthly">Monthly</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="number"
            label="Backup Retention (days)"
            value={settings.backupRetention}
            onChange={handleChange('backupRetention')}
            inputProps={{ min: 1 }}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Security Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="password"
            label="Password Protection"
            value={settings.settingsPassword}
            onChange={handleChange('settingsPassword')}
            helperText="Leave empty to disable"
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="IP Whitelist"
            value={settings.ipWhitelist}
            onChange={handleChange('ipWhitelist')}
            helperText="Comma-separated IP addresses"
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Error Handling
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="email"
            label="Email Notifications"
            value={settings.notificationEmail}
            onChange={handleChange('notificationEmail')}
            helperText="Email address for notifications"
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="number"
            label="Max Retries"
            value={settings.maxRetries}
            onChange={handleChange('maxRetries')}
            inputProps={{ min: 0, max: 5 }}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdvancedSettings; 