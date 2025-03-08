import { WebSocketServer } from 'ws';
import logger from './logger.service.js';

class WebSocketService {
    constructor() {
        this.wss = null;
        this.pingInterval = null;
        this.currentSync = {
            status: 'idle',
            isPaused: false,
            isCancelled: false,
            processedItems: 0,
            totalItems: 0,
            currentItem: null
        };
    }

    initialize(server) {
        // Increase max listeners to prevent warnings
        server.setMaxListeners(20);
        
        this.wss = new WebSocketServer({ 
            server,
            path: '/ws',
            verifyClient: (info) => {
                // Allow all origins in development
                const origin = info.origin || info.req.headers.origin;
                logger.info('WebSocket connection attempt from origin:', origin);
                return true;
            }
        });

        // Increase max listeners for WebSocket server
        this.wss.setMaxListeners(20);

        this.wss.on('connection', (ws, req) => {
            logger.info('New WebSocket client connected from:', req.socket.remoteAddress);
            
            // Send initial sync status
            this.sendToClient(ws, {
                type: 'syncStatus',
                data: this.currentSync
            });

            ws.on('error', (error) => {
                logger.error('WebSocket error:', error);
            });

            ws.on('close', () => {
                logger.info('Client disconnected');
                // Clean up any client-specific resources
                ws.removeAllListeners();
            });

            // Keep connection alive
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });
        });

        // Set up ping interval to keep connections alive
        this.pingInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    logger.info('Terminating inactive WebSocket connection');
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping(() => {});
            });
        }, 30000);

        this.wss.on('error', (error) => {
            logger.error('WebSocket server error:', error);
        });

        // Add cleanup handler
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());

        logger.info('WebSocket server initialized successfully');
    }

    sendToClient(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(data));
            } catch (error) {
                logger.error('Error sending message to client:', error);
            }
        }
    }

    updateSyncStatus(update) {
        this.currentSync = {
            ...this.currentSync,
            ...update
        };
        this.broadcastSyncStatus();
    }

    broadcastSyncStatus() {
        if (!this.wss) {
            logger.warn('WebSocket server not initialized');
            return;
        }

        const message = {
            type: 'syncStatus',
            data: this.currentSync
        };

        this.wss.clients.forEach(client => {
            this.sendToClient(client, message);
        });
    }

    resetSyncStatus() {
        this.currentSync = {
            status: 'idle',
            totalItems: 0,
            processedItems: 0,
            isPaused: false,
            isCancelled: false,
            currentItem: null
        };
        this.broadcastSyncStatus();
    }

    cleanup() {
        logger.info('Cleaning up WebSocket connections...');
        
        // Clear the ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        // Close all client connections
        if (this.wss) {
            this.wss.clients.forEach((ws) => {
                try {
                    ws.removeAllListeners();
                    ws.terminate();
                } catch (error) {
                    logger.error('Error closing WebSocket connection:', error);
                }
            });

            // Close the WebSocket server
            this.wss.close(() => {
                logger.info('WebSocket server closed');
            });
        }
    }
}

const websocketService = new WebSocketService();
export default websocketService; 