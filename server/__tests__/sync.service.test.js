import { jest } from '@jest/globals';

// Create mock functions
const mockLoadSettings = jest.fn();
const mockGetPhotos = jest.fn();
const mockResetSyncStatus = jest.fn();
const mockUpdateSyncStatus = jest.fn();

// Mock dependencies
jest.unstable_mockModule('../services/websocket.service.js', () => ({
    default: {
        currentSync: {
            status: 'idle',
            totalItems: 0,
            processedItems: 0,
            isPaused: false,
            isCancelled: false,
            message: ''
        },
        resetSyncStatus: mockResetSyncStatus,
        updateSyncStatus: mockUpdateSyncStatus
    }
}));

jest.unstable_mockModule('../services/photos.service.js', () => ({
    default: {
        getPhotos: mockGetPhotos
    }
}));

jest.unstable_mockModule('../services/settings.service.js', () => ({
    default: {
        loadSettings: mockLoadSettings
    }
}));

// Import services after mocking
const { default: syncService } = await import('../services/sync.service.js');
const { default: websocketService } = await import('../services/websocket.service.js');

describe('Sync Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset websocketService state
        Object.assign(websocketService.currentSync, {
            status: 'idle',
            totalItems: 0,
            processedItems: 0,
            isPaused: false,
            isCancelled: false,
            message: ''
        });
    });

    describe('getSyncStatus', () => {
        it('should return current sync status', async () => {
            Object.assign(websocketService.currentSync, {
                status: 'running',
                totalItems: 10,
                processedItems: 5,
                isPaused: false,
                isCancelled: false,
                message: 'Processing'
            });

            const status = await syncService.getSyncStatus();

            expect(status).toEqual({
                status: 'running',
                progress: 50,
                totalItems: 10,
                processedItems: 5,
                isPaused: false,
                isCancelled: false,
                message: 'Processing'
            });
        });

        it('should handle zero total items', async () => {
            Object.assign(websocketService.currentSync, {
                status: 'idle',
                totalItems: 0,
                processedItems: 0
            });

            const status = await syncService.getSyncStatus();

            expect(status.progress).toBe(0);
        });
    });

    describe('startSync', () => {
        const mockAuth = { credentials: 'test' };
        const mockSettings = { syncPath: '/test/path' };
        const mockPhotos = [
            { id: '1', name: 'photo1' },
            { id: '2', name: 'photo2' }
        ];

        beforeEach(() => {
            mockLoadSettings.mockReturnValue(mockSettings);
            mockGetPhotos.mockResolvedValue(mockPhotos);
            syncService.syncInProgress = false;
        });

        it('should start sync process successfully', async () => {
            await syncService.startSync(mockAuth);

            expect(mockResetSyncStatus).toHaveBeenCalled();
            expect(mockUpdateSyncStatus).toHaveBeenCalledWith({
                status: 'running',
                message: 'Starting sync process...'
            });
            expect(mockGetPhotos).toHaveBeenCalledWith(mockAuth, mockSettings);
            expect(mockUpdateSyncStatus).toHaveBeenCalledWith({
                totalItems: 2,
                message: 'Found 2 items to sync'
            });
        });

        it('should handle sync cancellation', async () => {
            websocketService.currentSync.isCancelled = true;

            await syncService.startSync(mockAuth);

            expect(mockUpdateSyncStatus).toHaveBeenCalledWith({
                status: 'cancelled',
                message: 'Sync cancelled by user'
            });
        });

        it('should handle sync pause and resume', async () => {
            websocketService.currentSync.isPaused = true;

            // Mock setTimeout to resolve immediately
            jest.useFakeTimers();

            const syncPromise = syncService.startSync(mockAuth);

            // Simulate resume after 1 second
            setTimeout(() => {
                websocketService.currentSync.isPaused = false;
            }, 1000);

            jest.runAllTimers();
            await syncPromise;

            expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'completed'
                })
            );

            jest.useRealTimers();
        });

        it('should handle errors during sync', async () => {
            const error = new Error('Sync failed');
            mockGetPhotos.mockRejectedValue(error);

            await syncService.startSync(mockAuth);

            expect(mockUpdateSyncStatus).toHaveBeenCalledWith({
                status: 'error',
                message: 'Sync failed: Sync failed'
            });
        });

        it('should prevent multiple concurrent syncs', async () => {
            syncService.syncInProgress = true;

            await expect(syncService.startSync(mockAuth)).rejects.toThrow('Sync is already in progress');
        });
    });
}); 