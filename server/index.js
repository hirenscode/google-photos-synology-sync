import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.routes.js';
import websocketService from './services/websocket.service.js';
import settingsService from './services/settings.service.js';
import photosService from './services/photos.service.js';
import syncCacheService from './services/sync.cache.service.js';
import logger from './services/logger.service.js';

const app = express();
const server = http.createServer(app);

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS configuration
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Upgrade',
        'Connection',
        'Sec-WebSocket-Key',
        'Sec-WebSocket-Version',
        'Sec-WebSocket-Extensions',
        'Sec-WebSocket-Protocol'
    ],
    credentials: true,
    maxAge: 86400 // 24 hours
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Initialize services
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '../config');

// Initialize all services
try {
    await settingsService.initialize(CONFIG_DIR);
    await photosService.initialize();
    await syncCacheService.initialize();
    await websocketService.initialize(server);
    logger.info('All services initialized successfully');
} catch (error) {
    logger.error('Error initializing services:', error);
    process.exit(1);
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Routes - mount on both /api and root path for backward compatibility
app.use('/api', apiRoutes);
app.use('/', apiRoutes);  // This allows both /api/check-auth and /check-auth to work

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error', 
        message: err.message 
    });
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    // Set a timeout for the graceful shutdown
    const shutdownTimeout = setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
    }, 10000); // 10 seconds timeout

    // Close the WebSocket server first
    websocketService.cleanup(() => {
        // Then close the HTTP server
        server.close(() => {
            logger.info('HTTP server closed');
            
            // Clear the timeout since we've shutdown gracefully
            clearTimeout(shutdownTimeout);
            
            // Exit the process
            process.exit(0);
        });
    });
};

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
}); 