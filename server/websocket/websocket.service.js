import { WebSocketServer } from 'ws';
import fs from 'fs';
import { PATHS } from '../config/constants.js';

class WebSocketService {
    constructor() {
        this.wsServer = null;
        this.currentSync = this.loadSyncStatus();
    }

    initialize(server) {
        this.wsServer = new WebSocketServer({
            server: server,
            path: '/ws',
            clientTracking: true,
            perMessageDeflate: true
        });

        this.setupEventHandlers();
        console.log('WebSocket server created with path: /ws');
    }

    setupEventHandlers() {
        this.wsServer.on('error', (error) => {
            console.error('WebSocket server error:', error.message);
        });

        this.wsServer.on('connection', this.handleConnection.bind(this));
    }

    handleConnection(ws, request) {
        console.log('WebSocket client connected from:', request.socket.remoteAddress);
        
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocketServer.OPEN) {
                try {
                    ws.ping();
                } catch (err) {
                    console.error('Error sending ping:', err.message);
                }
            }
        }, 30000);

        this.sendInitialStatus(ws);

        ws.on('message', (message) => {
            try {
                console.log('Received message from client:', message.toString());
            } catch (error) {
                console.error('Error processing message:', error.message);
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket client error:', error.message);
        });

        ws.on('close', (code, reason) => {
            console.log(`Client disconnected. Code: ${code}, Reason: ${reason || 'none'}`);
            clearInterval(pingInterval);
        });

        ws.on('pong', () => {
            console.log('Received pong from client');
        });
    }

    sendInitialStatus(ws) {
        const status = this.createStatusMessage();
        setTimeout(() => {
            try {
                if (ws.readyState === WebSocketServer.OPEN) {
                    ws.send(JSON.stringify(status));
                    console.log('Sent initial sync status to client');
                }
            } catch (error) {
                console.error('Error sending initial status:', error.message);
            }
        }, 500);
    }

    createStatusMessage() {
        return {
            type: 'syncStatus',
            status: this.currentSync.status,
            progress: this.currentSync.totalItems > 0 
                ? Math.round((this.currentSync.processedItems / this.currentSync.totalItems) * 100)
                : 0,
            isPaused: this.currentSync.isPaused,
            message: this.currentSync.status === 'paused' 
                ? 'Sync paused' 
                : this.currentSync.status === 'cancelled'
                ? 'Sync cancelled'
                : `${this.currentSync.processedItems} of ${this.currentSync.totalItems} items processed`
        };
    }

    broadcastToClients(data) {
        if (!data) {
            console.error('Cannot broadcast undefined data');
            return;
        }
        
        try {
            console.log('Broadcasting to clients:', JSON.stringify(data));
            
            if (this.wsServer && this.wsServer.clients) {
                const clients = Array.from(this.wsServer.clients);
                console.log(`Broadcasting to ${clients.length} connected clients`);
                
                clients.forEach(client => {
                    try {
                        if (client.readyState === WebSocketServer.OPEN) {
                            client.send(JSON.stringify(data));
                        }
                    } catch (error) {
                        console.error('Error broadcasting to client:', error.message);
                    }
                });
            } else {
                console.error('WebSocket server not initialized or no clients collection');
            }
        } catch (error) {
            console.error('Error in broadcastToClients:', error.message);
        }
    }

    loadSyncStatus() {
        try {
            if (fs.existsSync(PATHS.SYNC_STATUS)) {
                const status = JSON.parse(fs.readFileSync(PATHS.SYNC_STATUS, 'utf8'));
                return {
                    ...status,
                    activeDownloads: new Set(status.activeDownloads || [])
                };
            }
        } catch (error) {
            console.error('Error loading sync status:', error);
        }
        
        return {
            status: 'idle',
            isPaused: false,
            isCancelled: false,
            totalItems: 0,
            processedItems: 0,
            activeDownloads: new Set()
        };
    }

    saveSyncStatus() {
        try {
            const statusToSave = {
                ...this.currentSync,
                activeDownloads: Array.from(this.currentSync.activeDownloads)
            };
            fs.writeFileSync(PATHS.SYNC_STATUS, JSON.stringify(statusToSave, null, 2));
        } catch (error) {
            console.error('Error saving sync status:', error);
        }
    }

    broadcastSyncStatus() {
        if (this.wsServer) {
            this.broadcastToClients(this.createStatusMessage());
        }
        this.saveSyncStatus();
    }

    updateSyncStatus(update) {
        this.currentSync = { ...this.currentSync, ...update };
        this.broadcastSyncStatus();
    }
}

export default new WebSocketService(); 