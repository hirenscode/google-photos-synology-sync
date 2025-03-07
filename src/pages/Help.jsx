import {
  Container,
  Typography,
  Paper,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoIcon from '@mui/icons-material/Info';
import WarningIcon from '@mui/icons-material/Warning';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import { useTheme } from '../context/ThemeContext';

const Help = () => {
  const { isDarkMode } = useTheme();

  return (
    <Container maxWidth="md">
      <Paper 
        elevation={3} 
        sx={{ 
          mt: 4,
          backgroundColor: isDarkMode ? 'background.paper' : 'background.default'
        }}
      >
        <Typography variant="h4" component="h1" gutterBottom sx={{ p: 3, pb: 0 }}>
          Help & Documentation
        </Typography>

        <Box sx={{ p: 3, pt: 2 }}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">Basic Settings</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography paragraph>
                Basic settings allow you to configure the fundamental aspects of the sync process:
              </Typography>
              <Typography component="div" variant="body2">
                <ul>
                  <li>Storage Location: Choose where your photos will be saved on your Synology NAS</li>
                  <li>Media Selection: Choose whether to sync photos, videos, or both</li>
                  <li>Sync Schedule: Set up automatic sync intervals</li>
                  <li>Date Range: Filter photos by date range</li>
                </ul>
              </Typography>
            </AccordionDetails>
          </Accordion>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">Advanced Settings</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography paragraph>
                Advanced settings provide more control over the sync process:
              </Typography>
              <Typography component="div" variant="body2">
                <ul>
                  <li>File Organization: Choose how files are organized on your NAS</li>
                  <li>Media Processing: Configure photo compression and video conversion</li>
                  <li>Network Settings: Adjust bandwidth limits and concurrent downloads</li>
                  <li>Backup Settings: Set up automatic backups</li>
                  <li>Security Settings: Configure access controls and IP whitelisting</li>
                </ul>
              </Typography>
            </AccordionDetails>
          </Accordion>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">Common Issues</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography paragraph>
                Here are some common issues and their solutions:
              </Typography>
              <Typography component="div" variant="body2">
                <ul>
                  <li>
                    <strong>Authentication Issues:</strong> If you're having trouble logging in, try logging out and logging back in.
                  </li>
                  <li>
                    <strong>Storage Space:</strong> Make sure you have enough storage space on your NAS before starting a sync.
                  </li>
                  <li>
                    <strong>Network Issues:</strong> Check your network connection and try adjusting the network timeout settings.
                  </li>
                  <li>
                    <strong>Sync Failures:</strong> If sync fails, check the logs for specific error messages and try again.
                  </li>
                </ul>
              </Typography>
            </AccordionDetails>
          </Accordion>
        </Box>
      </Paper>
    </Container>
  );
};

export default Help; 