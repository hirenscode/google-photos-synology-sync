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
  Divider
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
              value={settings.organizationMethod}
              onChange={handleChange('organizationMethod')}
              label="Organization Method"
            >
              <MenuItem value="flat">Flat Structure</MenuItem>
              <MenuItem value="date">By Date (YYYY/MM/DD)</MenuItem>
              <MenuItem value="album">By Album</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>File Naming</InputLabel>
            <Select
              value={settings.namingPattern}
              onChange={handleChange('namingPattern')}
              label="File Naming"
            >
              <MenuItem value="original">Keep Original Names</MenuItem>
              <MenuItem value="date">Date Based</MenuItem>
              <MenuItem value="custom">Custom Pattern</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        {settings.namingPattern === 'custom' && (
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Custom Pattern"
              value={settings.customPattern || ''}
              onChange={handleChange('customPattern')}
              helperText="Available variables: {date}, {id}, {album}, {index}"
            />
          </Grid>
        )}
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
            label="Concurrent Downloads"
            value={settings.concurrentDownloads}
            onChange={handleChange('concurrentDownloads')}
            inputProps={{ min: 1, max: 10 }}
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