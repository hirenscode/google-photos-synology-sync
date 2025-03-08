import { jest } from '@jest/globals';
import http from 'http';
import { WebSocketServer } from 'ws';

// Create mock WebSocket instance
const mockWs = {
    send: jest.fn(),
    readyState: 1,
    on: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn()
};

// Create mock WebSocket server
const mockWss = {
    on: jest.fn((event, callback) => {
        if (event === 'connection') {
            callback(mockWs, { socket: { remoteAddress: '127.0.0.1' } });
        }
    }),
    clients: new Set([mockWs]),
    close: jest.fn(cb => cb())
};

// Mock the WebSocketServer constructor
const MockWebSocketServer = jest.fn(() => mockWss);
jest.unstable_mockModule('ws', () => ({
    WebSocketServer: MockWebSocketServer,
    default: {
        OPEN: 1
    }
}));

// Import the service after mocking
const { default: websocketService } = await import('../services/websocket.service.js');

describe('WebSocket Service', () => {
    let mockServer;
    
    beforeEach(() => {
        jest.clearAllMocks();
        mockServer = http.createServer();
        // Reset websocketService state
        websocketService.currentSync = {
            status: 'idle',
            totalItems: 0,
            processedItems: 0,
            isPaused: false,
            isCancelled: false,
            message: ''
        };
    });

    describe('initialize', () => {
        it('should initialize WebSocket server', () => {
            websocketService.initialize(mockServer);
            
            expect(MockWebSocketServer).toHaveBeenCalledWith({
                server: mockServer,
                path: '/ws',
                verifyClient: expect.any(Function)
            });
        });

        it('should set up connection handler', () => {
            websocketService.initialize(mockServer);
            
            expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
        });
    });

    describe('updateSyncStatus', () => {
        it('should update sync status and broadcast', () => {
            websocketService.initialize(mockServer);
            
            const update = {
                status: 'running',
                totalItems: 10,
                processedItems: 5
            };
            
            websocketService.updateSyncStatus(update);
            
            // The first call is the initial status on connection
            // The second call is our update
            expect(mockWs.send).toHaveBeenNthCalledWith(2,
                JSON.stringify({
                    type: 'syncStatus',
                    data: expect.objectContaining(update)
                })
            );
        });
    });

    describe('broadcastSyncStatus', () => {
        it('should not broadcast if server not initialized', () => {
            websocketService.wss = null;
            websocketService.broadcastSyncStatus();
            
            expect(mockWs.send).not.toHaveBeenCalled();
        });

        it('should broadcast to all connected clients', () => {
            websocketService.initialize(mockServer);
            
            // Clear previous calls from initialization
            mockWs.send.mockClear();
            
            websocketService.broadcastSyncStatus();
            
            expect(mockWs.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: 'syncStatus',
                    data: expect.any(Object)
                })
            );
        });
    });

    describe('resetSyncStatus', () => {
        it('should reset sync status to initial state', () => {
            websocketService.initialize(mockServer);
            
            // First update the status
            websocketService.updateSyncStatus({
                status: 'running',
                totalItems: 10,
                processedItems: 5
            });
            
            // Clear previous calls
            mockWs.send.mockClear();
            
            // Then reset it
            websocketService.resetSyncStatus();
            
            expect(mockWs.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: 'syncStatus',
                    data: {
                        status: 'idle',
                        totalItems: 0,
                        processedItems: 0,
                        isPaused: false,
                        isCancelled: false,
                        message: ''
                    }
                })
            );
        });
    });

    describe('cleanup', () => {
        it('should clear interval and close server', () => {
            jest.useFakeTimers();
            websocketService.initialize(mockServer);
            
            websocketService.cleanup();
            
            expect(mockWss.close).toHaveBeenCalled();
            jest.useRealTimers();
        });
    });
}); 