import { 
  Typography, 
  Box, 
  Paper, 
  Grid, 
  Card, 
  CardContent, 
  List, 
  ListItem, 
  ListItemIcon, 
  ListItemText,
  Divider,
  Link,
  useMediaQuery,
  useTheme as useMuiTheme
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import BugReportIcon from '@mui/icons-material/BugReport';
import InfoIcon from '@mui/icons-material/Info';
import GitHubIcon from '@mui/icons-material/GitHub';
import LayersIcon from '@mui/icons-material/Layers';
import { useTheme } from '../context/ThemeContext';

function About() {
  const { isDarkMode } = useTheme();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'));

  return (
    <Box>
      <Typography 
        variant={isMobile ? "h5" : "h4"} 
        component="h1"
        gutterBottom
        sx={{ mb: 3 }}
      >
        About Google Photos Synology Sync
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          What is Google Photos Synology Sync?
        </Typography>
        
        <Typography variant="body1" paragraph>
          Google Photos Synology Sync is an application that helps you download and sync your Google Photos to your Synology NAS or any local storage. 
          It provides a simple and efficient way to back up your cloud photos locally.
        </Typography>
        
        <Typography variant="body1" paragraph>
          This tool is designed to help you maintain control over your photo collection by keeping a local copy, while still enjoying the benefits of Google Photos cloud storage.
        </Typography>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <LayersIcon sx={{ mr: 1 }} />
                Features
              </Typography>
              
              <Divider sx={{ mb: 2 }} />
              
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <PhotoLibraryIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Sync Photos & Videos" 
                    secondary="Download your media files from Google Photos"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <StorageIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Local Storage" 
                    secondary="Keep your photos on your Synology NAS or any local storage"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <CodeIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Customizable Settings" 
                    secondary="Configure sync options, scheduling, and organization methods"
                  />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <InfoIcon sx={{ mr: 1 }} />
                Technical Information
              </Typography>
              
              <Divider sx={{ mb: 2 }} />
              
              <List dense>
                <ListItem>
                  <ListItemText 
                    primary="Version" 
                    secondary="1.0.0"
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Technologies" 
                    secondary="React, Node.js, Express, Google Photos API"
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="License" 
                    secondary="MIT"
                  />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <BugReportIcon sx={{ mr: 1 }} />
                Issues & Support
              </Typography>
              
              <Divider sx={{ mb: 2 }} />
              
              <Typography variant="body1" paragraph>
                If you encounter any issues or have suggestions for improvement, please report them on our GitHub repository:
              </Typography>
              
              <Box sx={{ textAlign: 'center', my: 2 }}>
                <Link 
                  href="https://github.com/yourusername/google-photos-synology-sync" 
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ 
                    display: 'inline-flex', 
                    alignItems: 'center',
                    textDecoration: 'none'
                  }}
                >
                  <GitHubIcon sx={{ mr: 1 }} />
                  <Typography variant="body1">
                    GitHub Repository
                  </Typography>
                </Link>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                This application is not affiliated with or endorsed by Google or Synology. Google Photos and Synology are trademarks of their respective owners.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default About; 