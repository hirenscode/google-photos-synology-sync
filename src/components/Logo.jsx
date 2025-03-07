import { Box } from '@mui/material';
import { useTheme } from '../context/ThemeContext';

function Logo({ size = 'medium', showText = true }) {
  const { isDarkMode } = useTheme();

  const sizes = {
    small: {
      width: 32,
      height: 32
    },
    medium: {
      width: 48,
      height: 48
    },
    large: {
      width: 64,
      height: 64
    }
  };

  const currentSize = sizes[size];

  return (
    <Box
      component="div"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        cursor: 'pointer'
      }}
    >
      <img
        src="/images/logo.png"
        alt="Google Photos Sync Logo"
        style={{
          width: currentSize.width,
          height: currentSize.height,
          objectFit: 'contain'
        }}
      />
    </Box>
  );
}

export default Logo; 