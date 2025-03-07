import { AppBar, Toolbar, Button, Box, IconButton, Menu, MenuItem, useMediaQuery, useTheme as useMuiTheme } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import HelpIcon from '@mui/icons-material/Help';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import { useTheme } from '../context/ThemeContext';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import Logo from './Logo';
import { useState } from 'react';

const Navbar = () => {
  const navigate = useNavigate();
  const { isDarkMode, toggleTheme } = useTheme();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'));
  const [anchorEl, setAnchorEl] = useState(null);

  const handleMenu = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to logout?')) {
      try {
        const response = await fetch('http://localhost:3000/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          localStorage.removeItem('token');
          navigate('/', { replace: true });
        } else {
          console.error('Logout failed');
          alert('Failed to logout. Please try again.');
        }
      } catch (error) {
        console.error('Error during logout:', error);
        alert('An error occurred during logout. Please try again.');
      }
    }
    handleClose();
  };

  const handleNavigation = (path) => {
    navigate(path);
    handleClose();
  };

  return (
    <AppBar position="static">
      <Toolbar>
        <Logo size="small" />
        <Box sx={{ flexGrow: 1 }} />
        {isMobile ? (
          <>
            <IconButton
              color="inherit"
              onClick={toggleTheme}
              sx={{ mr: 1 }}
            >
              {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
            <IconButton
              edge="end"
              color="inherit"
              aria-label="menu"
              onClick={handleMenu}
            >
              <MenuIcon />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              anchorOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
            >
              <MenuItem onClick={() => handleNavigation('/')}>
                <HomeIcon sx={{ mr: 1 }} /> Home
              </MenuItem>
              <MenuItem onClick={() => handleNavigation('/settings')}>
                <SettingsIcon sx={{ mr: 1 }} /> Settings
              </MenuItem>
              <MenuItem onClick={() => handleNavigation('/help')}>
                <HelpIcon sx={{ mr: 1 }} /> Help
              </MenuItem>
              <MenuItem onClick={handleLogout}>
                <LogoutIcon sx={{ mr: 1 }} /> Logout
              </MenuItem>
            </Menu>
          </>
        ) : (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              color="inherit"
              component={RouterLink}
              to="/"
              startIcon={<HomeIcon />}
              sx={{ minWidth: '100px' }}
            >
              Home
            </Button>
            <Button
              color="inherit"
              component={RouterLink}
              to="/settings"
              startIcon={<SettingsIcon />}
              sx={{ minWidth: '100px' }}
            >
              Settings
            </Button>
            <Button
              color="inherit"
              component={RouterLink}
              to="/help"
              startIcon={<HelpIcon />}
              sx={{ minWidth: '100px' }}
            >
              Help
            </Button>
            <Button
              color="inherit"
              onClick={toggleTheme}
              sx={{ minWidth: '40px' }}
            >
              {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
            </Button>
            <Button
              color="inherit"
              onClick={handleLogout}
              startIcon={<LogoutIcon />}
              sx={{ minWidth: '100px' }}
            >
              Logout
            </Button>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default Navbar; 