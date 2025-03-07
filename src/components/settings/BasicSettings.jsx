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
  Alert
} from '@mui/material';

const BasicSettings = ({ settings, onSettingsChange }) => {
  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    onSettingsChange({ ...settings, [field]: value });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Storage Location
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Synology NAS Folder Path"
            value={settings.syncFolder}
            onChange={handleChange('syncFolder')}
            helperText="Must start with /volume1/"
            error={!settings.syncFolder.startsWith('/volume1/')}
          />
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.deleteRemoved}
                onChange={handleChange('deleteRemoved')}
              />
            }
            label="Delete local copies of removed photos"
          />
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.storageWarning}
                onChange={handleChange('storageWarning')}
              />
            }
            label="Show storage warnings"
          />
        </Grid>
      </Grid>

      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        Media Selection
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.syncPhotos}
                onChange={handleChange('syncPhotos')}
              />
            }
            label="Sync Photos"
          />
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.syncVideos}
                onChange={handleChange('syncVideos')}
              />
            }
            label="Sync Videos"
          />
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.useDateRange}
                onChange={handleChange('useDateRange')}
              />
            }
            label="Use date range filter"
          />
        </Grid>
        {settings.useDateRange && (
          <>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="date"
                label="Start Date"
                value={settings.startDate}
                onChange={handleChange('startDate')}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="date"
                label="End Date"
                value={settings.endDate}
                onChange={handleChange('endDate')}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </>
        )}
      </Grid>

      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        Sync Schedule
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>Sync Frequency</InputLabel>
            <Select
              value={settings.syncFrequency}
              onChange={handleChange('syncFrequency')}
              label="Sync Frequency"
            >
              <MenuItem value="manual">Manual Only</MenuItem>
              <MenuItem value="hourly">Every Hour</MenuItem>
              <MenuItem value="daily">Daily</MenuItem>
              <MenuItem value="weekly">Weekly</MenuItem>
              <MenuItem value="monthly">Monthly</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        {settings.syncFrequency !== 'manual' && (
          <Grid item xs={12}>
            <TextField
              fullWidth
              type="time"
              label="Sync Time"
              value={settings.syncTime}
              onChange={handleChange('syncTime')}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default BasicSettings; 