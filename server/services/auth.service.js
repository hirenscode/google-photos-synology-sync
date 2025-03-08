import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import logger from './logger.service.js';
import dotenv from 'dotenv';

// Load environment variables from root directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TOKENS_PATH = 'tokens.json';

class AuthService {
    constructor() {
        const clientId = process.env.CLIENT_ID?.trim();
        const clientSecret = process.env.CLIENT_SECRET?.trim();
        const redirectUri = process.env.REDIRECT_URI?.trim();

        if (!clientId || !clientSecret || !redirectUri) {
            throw new Error('Missing required OAuth credentials. Please check your .env file.');
        }

        this.oAuth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            redirectUri
        );

        // Initialize token refresh on startup
        this.initializeTokenRefresh();
    }

    // Sanitize tokens for logging to prevent binary blob output
    sanitizeTokensForLogging(tokens) {
        if (!tokens) return null;
        return {
            token_type: tokens.token_type,
            scope: tokens.scope,
            expiry_date: tokens.expiry_date,
            // Only log the first and last 4 characters of sensitive fields
            access_token: tokens.access_token ? `${tokens.access_token.slice(0, 4)}...${tokens.access_token.slice(-4)}` : null,
            refresh_token: tokens.refresh_token ? `${tokens.refresh_token.slice(0, 4)}...${tokens.refresh_token.slice(-4)}` : null,
        };
    }

    async initializeTokenRefresh() {
        try {
            // Try to refresh token on startup
            const auth = await this.authenticate();
            if (auth) {
                logger.info('Initial token refresh successful');
                
                // Set up periodic token refresh (every 30 minutes)
                setInterval(async () => {
                    try {
                        await this.refreshTokenIfNeeded();
                    } catch (error) {
                        logger.error('Periodic token refresh failed:', error);
                    }
                }, 30 * 60 * 1000); // 30 minutes
            }
        } catch (error) {
            logger.error('Initial token refresh failed:', error);
        }
    }

    async refreshTokenIfNeeded() {
        try {
            // Check if tokens exist
            try {
                await fs.access(TOKENS_PATH);
            } catch (error) {
                return null;
            }

            // Read current tokens
            const tokensData = await fs.readFile(TOKENS_PATH, 'utf8');
            const tokens = JSON.parse(tokensData);

            // Check if token will expire in the next hour
            const expiryDate = tokens.expiry_date;
            const oneHourFromNow = Date.now() + (60 * 60 * 1000);

            if (expiryDate < oneHourFromNow && tokens.refresh_token) {
                logger.info('Token expires soon, refreshing...', { 
                    currentToken: this.sanitizeTokensForLogging(tokens)
                });
                const { credentials } = await this.oAuth2Client.refreshAccessToken();
                await this.saveTokens(credentials);
                logger.info('Token refreshed successfully', { 
                    newToken: this.sanitizeTokensForLogging(credentials)
                });
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Error in refreshTokenIfNeeded:', error);
            return false;
        }
    }

    async authenticate() {
        try {
            // Check if tokens file exists
            try {
                await fs.access(TOKENS_PATH);
            } catch (error) {
                logger.info('No tokens found');
                return null;
            }

            // Read tokens from file
            const tokensData = await fs.readFile(TOKENS_PATH, 'utf8');
            const tokens = JSON.parse(tokensData);

            // Set credentials
            this.oAuth2Client.setCredentials(tokens);

            // Try to refresh token if needed
            await this.refreshTokenIfNeeded();

            // Verify token validity
            try {
                // Try to get user info to verify token validity
                const oauth2 = google.oauth2({ version: 'v2', auth: this.oAuth2Client });
                await oauth2.userinfo.get();
                return this.oAuth2Client;
            } catch (error) {
                logger.error('Token verification failed:', error);
                await this.deleteTokens();
                return null;
            }
        } catch (error) {
            logger.error('Authentication error:', error);
            return null;
        }
    }

    generateAuthUrl(scopes) {
        return this.oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            include_granted_scopes: true,
            prompt: 'consent' // Always ask for consent to ensure we get a refresh token
        });
    }

    async getTokens(code) {
        try {
            const { tokens } = await this.oAuth2Client.getToken(code);
            logger.info('Tokens retrieved successfully');
            return tokens;
        } catch (error) {
            logger.error('Error retrieving tokens:', error);
            throw error;
        }
    }

    setCredentials(tokens) {
        this.oAuth2Client.setCredentials(tokens);
    }

    async saveTokens(tokens) {
        try {
            await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));
            logger.info('Tokens saved successfully', {
                tokens: this.sanitizeTokensForLogging(tokens)
            });
        } catch (error) {
            logger.error('Error saving tokens:', error);
            throw error;
        }
    }

    async deleteTokens() {
        try {
            await fs.unlink(TOKENS_PATH);
            logger.info('Tokens deleted successfully');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Error deleting tokens:', error);
                throw error;
            }
        }
    }

    getAuth() {
        return this.oAuth2Client;
    }
}

const authService = new AuthService();
export default authService; 