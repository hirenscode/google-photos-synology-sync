import { jest } from '@jest/globals';

// Create mock functions
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockUnlink = jest.fn();
const mockAccess = jest.fn();
const mockGetToken = jest.fn();
const mockGenerateAuthUrl = jest.fn();
const mockSetCredentials = jest.fn();

// Mock the googleapis
jest.unstable_mockModule('googleapis', () => ({
    google: {
        auth: {
            OAuth2: jest.fn(() => ({
                setCredentials: mockSetCredentials,
                getToken: mockGetToken,
                generateAuthUrl: mockGenerateAuthUrl
            }))
        }
    }
}));

// Mock fs promises
jest.unstable_mockModule('fs/promises', () => ({
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    unlink: mockUnlink,
    access: mockAccess
}));

// Import service after mocking
const { default: authService } = await import('../services/auth.service.js');

describe('Auth Service', () => {
    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        // Set default mock implementations
        mockGenerateAuthUrl.mockReturnValue('http://test-auth-url');
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'test_token' } });
    });

    describe('authenticate', () => {
        it('should return false when tokens do not exist', async () => {
            mockAccess.mockRejectedValue(new Error('File does not exist'));
            
            const result = await authService.authenticate();
            expect(result).toBe(false);
        });

        it('should return true when valid tokens exist', async () => {
            mockAccess.mockResolvedValue(undefined);
            mockReadFile.mockResolvedValue(JSON.stringify({ 
                access_token: 'test_token',
                refresh_token: 'test_refresh_token'
            }));

            const result = await authService.authenticate();
            expect(result).toBe(true);
            expect(mockSetCredentials).toHaveBeenCalled();
        });
    });

    describe('generateAuthUrl', () => {
        it('should generate correct auth URL with scopes', () => {
            const scopes = ['scope1', 'scope2'];
            const port = '5173';
            const mockAuthUrl = 'http://test-auth-url';
            
            mockGenerateAuthUrl.mockReturnValue(mockAuthUrl);

            const url = authService.generateAuthUrl(scopes, port);
            
            expect(url).toBe(mockAuthUrl);
            expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    access_type: 'offline',
                    scope: scopes,
                    include_granted_scopes: true,
                    state: port
                })
            );
        });
    });

    describe('getTokens', () => {
        it('should get tokens with auth code', async () => {
            const code = 'test_auth_code';
            const mockTokens = { access_token: 'test_token' };
            
            mockGetToken.mockResolvedValue({ tokens: mockTokens });

            const tokens = await authService.getTokens(code);
            
            expect(tokens).toEqual(mockTokens);
            expect(mockGetToken).toHaveBeenCalledWith(code);
        });

        it('should throw error when token retrieval fails', async () => {
            const code = 'invalid_code';
            const error = new Error('Token retrieval failed');
            
            mockGetToken.mockRejectedValue(error);

            await expect(authService.getTokens(code)).rejects.toThrow('Token retrieval failed');
        });
    });

    describe('saveTokens', () => {
        it('should save tokens to file', async () => {
            const tokens = { access_token: 'test_token' };
            
            await authService.saveTokens(tokens);
            
            expect(mockWriteFile).toHaveBeenCalledWith(
                expect.any(String),
                JSON.stringify(tokens, null, 2)
            );
        });
    });

    describe('deleteTokens', () => {
        it('should delete tokens file if it exists', async () => {
            mockAccess.mockResolvedValue(undefined);
            
            await authService.deleteTokens();
            
            expect(mockUnlink).toHaveBeenCalled();
        });

        it('should not throw if tokens file does not exist', async () => {
            mockAccess.mockRejectedValue(new Error('File does not exist'));
            
            await expect(authService.deleteTokens()).resolves.not.toThrow();
            expect(mockUnlink).not.toHaveBeenCalled();
        });
    });
}); 