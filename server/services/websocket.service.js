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
            currentItem: null,
            activeDownloads: new Set()
        };
        this.discoveryProgress = {
            status: 'idle',
            photoCount: 0,
            videoCount: 0,
            totalItems: 0,
            estimatedSizeBytes: 0,
            pagesScanned: 0,
            isComplete: false
        };
    }

    initialize(server) {
        // Increase max listeners to prevent warnings
        server.setMaxListeners(20);
        
        this.wss = new WebSocketServer({ 
            server,
            path: '/ws',
            clientTracking: true
        });

        // Handle connection events
        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        // Setup ping interval
        this.setupPingInterval();

        logger.info('WebSocket server initialized');
        return this.wss;
    }

    handleConnection(ws, req) {
        const clientIp = req.socket.remoteAddress;
        logger.info('New WebSocket connection from:', clientIp);

        // Send initial state immediately
        this.sendInitialState(ws);

        // Setup ping-pong
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
            logger.debug('Received pong from client');
        });

        // Handle messages
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                logger.debug('Received message:', message);
                this.handleMessage(ws, message);
            } catch (error) {
                logger.error('Error handling WebSocket message:', error);
            }
        });

        // Handle close
        ws.on('close', () => {
            logger.info('Client disconnected:', clientIp);
        });

        // Handle errors
        ws.on('error', (error) => {
            logger.error('WebSocket connection error:', error);
        });
    }

    sendToClient(ws, data) {
        if (ws.readyState === 1) { // WebSocket.OPEN
            try {
                const message = JSON.stringify(data);
                ws.send(message);
                logger.debug('Sent message to client:', data.type);
            } catch (error) {
                logger.error('Error sending message to client:', error);
            }
        }
    }

    sendInitialState(ws) {
        // Send current sync status
        this.sendToClient(ws, {
            type: 'syncStatus',
            data: this.currentSync
        });

        // Send current discovery progress
        this.sendToClient(ws, {
            type: 'discoveryProgress',
            data: this.discoveryProgress
        });
    }

    handleMessage(ws, message) {
        logger.debug('Handling message:', message.type);
        
        switch (message.type) {
            case 'ping':
                this.sendToClient(ws, { type: 'pong' });
                break;
            case 'getSyncStatus':
                this.sendToClient(ws, {
                    type: 'syncStatus',
                    data: this.currentSync
                });
                break;
            case 'getDiscoveryProgress':
                this.sendToClient(ws, {
                    type: 'discoveryProgress',
                    data: this.discoveryProgress
                });
                break;
            default:
                logger.warn('Unknown message type:', message.type);
        }
    }

    setupPingInterval() {
        // Clear any existing interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        // Set up ping interval
        this.pingInterval = setInterval(() => {
            if (!this.wss) return;

            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    logger.info('Terminating inactive connection');
                    return ws.terminate();
                }

                ws.isAlive = false;
                try {
                    ws.ping();
                    logger.debug('Sent ping to client');
                } catch (error) {
                    logger.error('Error sending ping:', error);
                    ws.terminate();
                }
            });
        }, 30000);
    }

    cleanup(callback) {
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
                if (callback) callback();
            });
        } else if (callback) {
            callback();
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
            currentItem: null,
            activeDownloads: new Set()
        };
        this.broadcastSyncStatus();
    }

    updateDiscoveryProgress(progress) {
        this.discoveryProgress = {
            ...this.discoveryProgress,
            ...progress,
            status: progress.status || 'discovering'
        };
        
        if (this.wss) {
            const message = {
                type: 'discoveryProgress',
                data: {
                    ...this.discoveryProgress,
                    message: this.formatDiscoveryMessage(this.discoveryProgress)
                }
            };
            
            this.wss.clients.forEach(client => {
                this.sendToClient(client, message);
            });
        }
    }

    completeDiscovery(results) {
        this.discoveryProgress = {
            ...this.discoveryProgress,
            ...results,
            status: results.status || 'complete',
            isComplete: true
        };
        
        if (this.wss) {
            const message = {
                type: 'discoveryProgress',
                data: {
                    ...this.discoveryProgress,
                    message: this.formatDiscoveryMessage(this.discoveryProgress)
                }
            };
            
            this.wss.clients.forEach(client => {
                this.sendToClient(client, message);
            });
        }
    }

    resetDiscovery() {
        this.discoveryProgress = {
            status: 'idle',
            photoCount: 0,
            videoCount: 0,
            totalItems: 0,
            estimatedSizeBytes: 0,
            pagesScanned: 0,
            isComplete: false
        };

        if (this.wss) {
            const message = {
                type: 'discoveryProgress',
                data: this.discoveryProgress
            };
            
            this.wss.clients.forEach(client => {
                this.sendToClient(client, message);
            });
        }
    }

    formatDiscoveryMessage(progress) {
        const { photoCount, videoCount, estimatedSizeBytes, pagesScanned, status } = progress;
        let message = '';

        switch (status) {
            case 'discovering':
                message = `Discovering media... Found ${photoCount} photos and ${videoCount} videos (${this.formatBytes(estimatedSizeBytes)}) in ${pagesScanned} pages`;
                break;
            case 'complete':
                message = `Discovered ${photoCount} photos and ${videoCount} videos (${this.formatBytes(estimatedSizeBytes)}) in ${pagesScanned} pages`;
                break;
            case 'error':
                message = `Discovery failed: ${progress.error || 'Unknown error'}`;
                break;
            case 'cancelled':
                message = `Discovery cancelled. Found ${photoCount} photos and ${videoCount} videos`;
                break;
            default:
                message = `Found ${photoCount} photos and ${videoCount} videos (${this.formatBytes(estimatedSizeBytes)}) in ${pagesScanned} pages`;
        }
        
        return message;
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}

// Create and export a singleton instance
const websocketService = new WebSocketService();
export default websocketService; 