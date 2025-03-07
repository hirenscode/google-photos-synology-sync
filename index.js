import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import axios from 'axios';
import http from 'http';
import { URL } from 'url';
import { WebSocketServer } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const SCOPES = [
    'https://www.googleapis.com/auth/photoslibrary.readonly',
    'https://www.googleapis.com/auth/photoslibrary.sharing',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];
const TOKENS_PATH = 'tokens.json';
const SETTINGS_PATH = 'settings.json';
const LOG_PATH = 'sync.log';
const SYNC_STATUS_PATH = 'sync_status.json';

let syncInterval = null;
let currentSync = loadSyncStatus();
let wsServer = null;

// Add a global variable to store discovery results
let lastDiscoveryResults = null;

// Utility functions
const execAsync = promisify(exec);

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${message}\n`;
    fs.appendFileSync(LOG_PATH, logMessage);
    broadcastToClients({ type: 'log', message });
}

function loadSyncStatus() {
    try {
        if (fs.existsSync(SYNC_STATUS_PATH)) {
            const status = JSON.parse(fs.readFileSync(SYNC_STATUS_PATH, 'utf8'));
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

function saveSyncStatus() {
    try {
        const statusToSave = {
            ...currentSync,
            activeDownloads: Array.from(currentSync.activeDownloads)
        };
        fs.writeFileSync(SYNC_STATUS_PATH, JSON.stringify(statusToSave, null, 2));
    } catch (error) {
        console.error('Error saving sync status:', error);
    }
}

function broadcastSyncStatus() {
    if (wsServer) {
        const status = {
            type: 'syncStatus',
            status: currentSync.status,
            progress: currentSync.totalItems > 0 
                ? Math.round((currentSync.processedItems / currentSync.totalItems) * 100)
                : 0,
            isPaused: currentSync.isPaused,
            message: currentSync.status === 'paused' 
                ? 'Sync paused' 
                : currentSync.status === 'cancelled'
                ? 'Sync cancelled'
                : `${currentSync.processedItems} of ${currentSync.totalItems} items processed`
        };
        broadcastToClients(status);
    }
    saveSyncStatus();
}

function broadcastToClients(data) {
    if (!data) {
        console.error('Cannot broadcast undefined data');
        return;
    }
    
    try {
        console.log('Broadcasting to clients:', JSON.stringify(data));
        
        if (wsServer && wsServer.clients) {
            const clients = Array.from(wsServer.clients);
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

function loadSettings() {
    if (fs.existsSync(SETTINGS_PATH)) {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
    return {
        syncFolder: path.join(process.cwd(), 'photos'),
        syncPhotos: true,
        syncVideos: true,
        syncFrequency: 'manual',
        syncTime: '00:00',
        initialSync: 'immediate',
        initialSyncTime: '00:00',
        organizationMethod: 'flat',
        namingPattern: 'original',
        compressPhotos: false,
        preserveExif: true,
        convertVideos: false,
        generateThumbnails: false,
        bandwidthLimit: 0,
        concurrentDownloads: 3,
        networkTimeout: 30,
        backupLocation: '',
        backupSchedule: 'none',
        backupRetention: 30,
        settingsPassword: '',
        ipWhitelist: '',
        notificationEmail: '',
        maxRetries: 3,
        deleteRemoved: false,
        storageWarning: true,
        useDateRange: false,
        startDate: '',
        endDate: '',
        discoveryLimit: 5
    };
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

async function checkStorageSpace(folder) {
    try {
        const { stdout } = await execAsync(`df -h "${folder}"`);
        const lines = stdout.split('\n');
        const [, diskInfo] = lines;
        const [, size, used, available, usePercent] = diskInfo.split(/\s+/);
        return {
            total: size,
            used,
            available,
            usePercent: parseInt(usePercent)
        };
    } catch (error) {
        log(`Error checking storage space: ${error.message}`);
        return null;
    }
}

async function processPhoto(inputPath, outputPath, settings) {
    if (!settings.compressPhotos) {
        return fs.promises.copyFile(inputPath, outputPath);
    }

    const image = sharp(inputPath);
    if (settings.preserveExif) {
        image.withMetadata();
    }
    return image
        .resize(1920, 1080, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toFile(outputPath);
}

async function processVideo(inputPath, outputPath, settings) {
    if (!settings.convertVideos) {
        return fs.promises.copyFile(inputPath, outputPath);
    }

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('mp4')
            .on('end', resolve)
            .on('error', reject)
            .save(outputPath);
    });
}

async function generateThumbnail(inputPath, outputPath) {
    return sharp(inputPath)
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toFile(outputPath);
}

async function sendEmail(to, subject, text) {
    const settings = loadSettings();
    if (!settings.notificationEmail) return;

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    try {
        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject,
            text
        });
    } catch (error) {
        log(`Error sending email: ${error.message}`);
    }
}

function scheduleSync(settings) {
    if (syncInterval) {
        clearInterval(syncInterval);
    }

    if (settings.syncFrequency === 'manual') {
        return;
    }

    const now = new Date();
    const [hours, minutes] = settings.syncTime.split(':');
    const syncTime = new Date(now);
    syncTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    if (syncTime < now) {
        syncTime.setDate(syncTime.getDate() + 1);
    }

    const delay = syncTime - now;

    setTimeout(() => {
        syncPhotos();
        
        let interval;
        switch (settings.syncFrequency) {
            case 'hourly':
                interval = 60 * 60 * 1000;
                break;
            case 'daily':
                interval = 24 * 60 * 60 * 1000;
                break;
            case 'weekly':
                interval = 7 * 24 * 60 * 60 * 1000;
                break;
            case 'monthly':
                interval = 30 * 24 * 60 * 60 * 1000;
                break;
        }
        
        syncInterval = setInterval(syncPhotos, interval);
    }, delay);
}

async function authenticate() {
    try {
        console.log('Authenticating with Google API...');
        
        // Create OAuth client
        const auth = new google.auth.OAuth2(
            process.env.CLIENT_ID?.trim(),
            process.env.CLIENT_SECRET?.trim(),
            process.env.REDIRECT_URI?.trim()
        );
        
        // Check if tokens file exists
        const absoluteTokenPath = path.resolve(process.cwd(), TOKENS_PATH);
        if (!fs.existsSync(absoluteTokenPath)) {
            console.log('No tokens file found at:', absoluteTokenPath);
            return null;
        }

        try {
            // Read tokens from file
            console.log('Reading tokens from file:', absoluteTokenPath);
            const tokenData = fs.readFileSync(absoluteTokenPath, 'utf8');
            const tokens = JSON.parse(tokenData);
            
            // Basic validation
            if (!tokens || !tokens.access_token) {
                console.error('Invalid token format: missing access_token');
                return null;
            }

            // Set credentials on OAuth client
            auth.setCredentials(tokens);
            console.log('Credentials set successfully');
            
            return auth;
        } catch (error) {
            console.error('Error processing tokens:', error.message);
            return null;
        }
    } catch (error) {
        console.error('Authentication error:', error.message);
        return null;
    }
}

async function getPhotos(auth, settings) {
    try {
        console.log('Initializing Google Photos API client for retrieval...');
        
        const photoClient = {
            mediaItems: {
                list: async (params) => {
                    try {
                        const url = 'https://photoslibrary.googleapis.com/v1/mediaItems';
                        const queryString = new URLSearchParams();
                        
                        if (params.pageSize) {
                            queryString.append('pageSize', params.pageSize);
                        }
                        
                        if (params.pageToken) {
                            queryString.append('pageToken', params.pageToken);
                        }
                        
                        const response = await auth.request({
                            url: `${url}?${queryString.toString()}`,
                            method: 'GET'
                        });
                        
                        return { data: response.data };
                    } catch (error) {
                        console.error('Error making photos API request:', error);
                        throw error;
                    }
                },
                get: async (mediaItemId) => {
                    try {
                        const url = `https://photoslibrary.googleapis.com/v1/mediaItems/${mediaItemId}`;
                        const response = await auth.request({
                            url: url,
                            method: 'GET'
                        });
                        return { data: response.data };
                    } catch (error) {
                        console.error('Error getting media item details:', error);
                        throw error;
                    }
                }
            }
        };
        
        console.log('Photos API client initialized successfully for retrieval');

        let mediaItems = [];
        let nextPageToken = null;
        let pageCount = 0;

        do {
            if (currentSync.isCancelled) {
                console.log('Sync cancelled during photo fetching');
                break;
            }

            if (currentSync.isPaused) {
                console.log('Sync paused during photo fetching');
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            pageCount++;
            console.log(`Fetching page ${pageCount} of media items...`);
            
            const response = await photoClient.mediaItems.list({
                pageSize: 50,
                pageToken: nextPageToken
            });

            if (response.data.mediaItems) {
                // Enhance each media item with its full details
                const enhancedItems = await Promise.all(response.data.mediaItems.map(async (item) => {
                    try {
                        const details = await photoClient.mediaItems.get(item.id);
                        return {
                            ...details.data,
                            // For photos, append =d to get original quality
                            // For videos, we'll handle the download URL separately
                            downloadUrl: details.data.mediaMetadata.photo ? 
                                `${details.data.baseUrl}=d` : 
                                details.data.baseUrl
                        };
                    } catch (error) {
                        console.error(`Error getting details for item ${item.id}:`, error);
                        return item;
                    }
                }));
                
                mediaItems = mediaItems.concat(enhancedItems);
            }
            
            nextPageToken = response.data.nextPageToken;
            log(`Fetched ${mediaItems.length} items so far...`);
            
        } while (nextPageToken && !currentSync.isCancelled);

        // Filter by date range if enabled
        if (settings.useDateRange && !currentSync.isCancelled) {
            console.log('Filtering by date range...');
            
            const startDate = new Date(settings.startDate);
            const endDate = new Date(settings.endDate);
            
            const originalCount = mediaItems.length;
            mediaItems = mediaItems.filter(item => {
                if (!item.mediaMetadata || !item.mediaMetadata.creationTime) {
                    return false;
                }
                const itemDate = new Date(item.mediaMetadata.creationTime);
                return itemDate >= startDate && itemDate <= endDate;
            });
            
            console.log(`Filtered from ${originalCount} to ${mediaItems.length} items by date range`);
        }

        return mediaItems;
    } catch (error) {
        console.error(`Error fetching photos: ${error.message}`);
        log(`Error fetching photos: ${error.message}`);
        throw error;
    }
}

async function downloadPhoto(url, filename, settings) {
    const response = await axios({ 
        url, 
        responseType: 'stream',
        timeout: settings.networkTimeout * 1000,
        headers: {
            'User-Agent': 'GooglePhotosSync/1.0'
        }
    });

    const tempPath = path.join(settings.syncFolder, '.temp', filename);
    const finalPath = path.join(settings.syncFolder, filename);

    if (!fs.existsSync(path.join(settings.syncFolder, '.temp'))) {
        fs.mkdirSync(path.join(settings.syncFolder, '.temp'), { recursive: true });
    }

    const writer = fs.createWriteStream(tempPath);
    let downloadedBytes = 0;
    const totalBytes = parseInt(response.headers['content-length'], 10);
    
    return new Promise((resolve, reject) => {
        let isDownloadCancelled = false;
        
        response.data.on('data', (chunk) => {
            if (currentSync.isCancelled || currentSync.isPaused) {
                isDownloadCancelled = true;
                writer.end();
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
                if (currentSync.isCancelled) {
                    reject(new Error('Download cancelled'));
                }
                return;
            }
            
            downloadedBytes += chunk.length;
            if (totalBytes) {
                const progress = Math.round((downloadedBytes / totalBytes) * 100);
                if (progress % 10 === 0) { // Log every 10%
                    const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
                    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
                    log(`Downloading ${filename}: ${downloadedMB}MB / ${totalMB}MB (${progress}%)`);
                }
            }
        });
        
        response.data.pipe(writer);

        writer.on('finish', async () => {
            if (isDownloadCancelled) {
                return;
            }
            
            try {
                // Just copy the file as is - we want to preserve the original quality
                await fs.promises.copyFile(tempPath, finalPath);

                // Generate thumbnail if enabled
                if (settings.generateThumbnails && filename.toLowerCase().endsWith('.jpg')) {
                    const thumbnailPath = path.join(settings.syncFolder, '.thumbnails', filename);
                    if (!fs.existsSync(path.join(settings.syncFolder, '.thumbnails'))) {
                        fs.mkdirSync(path.join(settings.syncFolder, '.thumbnails'), { recursive: true });
                    }
                    await generateThumbnail(tempPath, thumbnailPath);
                }

                // Clean up temp file
                fs.unlinkSync(tempPath);
                resolve();
            } catch (error) {
                reject(error);
            }
        });

        writer.on('error', reject);
    });
}

// Add this function to get discovery items for sync
async function getDiscoveredItems(auth, settings) {
    // If we already have discovery results, use them
    if (lastDiscoveryResults && lastDiscoveryResults.items && lastDiscoveryResults.items.length > 0) {
        console.log(`Using ${lastDiscoveryResults.items.length} previously discovered items for sync`);
        return lastDiscoveryResults.items;
    } else {
        // Otherwise fall back to regular getPhotos
        console.log('No discovery results available, fetching items directly');
        return await getPhotos(auth, settings);
    }
}

// Modify discoverPhotos to store full items
async function discoverPhotos(auth, settings) {
  try {
    console.log('Starting photo discovery process...');
    
    // Initialize variables based on continuation status
    const continueDiscovery = settings.continueDiscovery || false;
    let initialPageToken = settings.pageToken || null;
    
    if (continueDiscovery && initialPageToken) {
      console.log(`Continuing discovery from token: ${initialPageToken}`);
    } else {
      console.log('Starting fresh discovery');
    }
    
    // Google Photos API requires a different initialization approach
    console.log('Initializing Google Photos API client...');
    
    // For the Google Photos Library API, we need to use the API key directly
    const photoClient = {
      mediaItems: {
        list: async (params) => {
          try {
            // Use auth.request to make authenticated requests to the Photos API
            const url = 'https://photoslibrary.googleapis.com/v1/mediaItems';
            const queryString = new URLSearchParams();
            
            if (params.pageSize) {
              queryString.append('pageSize', params.pageSize);
            }
            
            if (params.pageToken) {
              queryString.append('pageToken', params.pageToken);
            }
            
            const response = await auth.request({
              url: `${url}?${queryString.toString()}`,
              method: 'GET'
            });
            
            return { data: response.data };
          } catch (error) {
            console.error('Error making photos API request:', error);
            throw error;
          }
        }
      }
    };
    
    console.log('Photos API client initialized successfully');
    
    let mediaItems = [];
    let photoCount = 0;
    let videoCount = 0;
    let nextPageToken = initialPageToken; // Start with initial token if continuing
    let totalSizeEstimate = 0;
    let pageCount = 0;
    const maxPages = settings.discoveryLimit || 5; // Limit pages for quicker discovery
    
    try {
      do {
        pageCount++;
        console.log(`Fetching page ${pageCount} of media items for discovery...${nextPageToken ? ' (with token)' : ''}`);
        
        const response = await photoClient.mediaItems.list({
          pageSize: 100,  // Larger page size for discovery
          pageToken: nextPageToken
        });
        
        if (response?.data?.mediaItems) {
          const newItems = response.data.mediaItems;
          console.log(`Discovered ${newItems.length} media items on page ${pageCount}`);
          
          // Count photos and videos
          newItems.forEach(item => {
            if (item.mediaMetadata?.photo) {
              photoCount++;
              // Rough estimate of photo size (5MB average)
              totalSizeEstimate += 5 * 1024 * 1024;
            } else if (item.mediaMetadata?.video) {
              videoCount++;
              // Rough estimate of video size (20MB average)
              totalSizeEstimate += 20 * 1024 * 1024;
            }
          });
          
          // Store the complete items for syncing
          mediaItems = mediaItems.concat(newItems);
        }
        
        nextPageToken = response?.data?.nextPageToken;
        
        // Limit to specified number of pages for discovery
        if (pageCount >= maxPages) {
          console.log(`Reached discovery page limit (${maxPages})`);
          break;
        }
        
      } while (nextPageToken);
    } catch (apiError) {
      console.error('Error calling Google Photos API during discovery:', apiError);
      throw new Error(`Google Photos API error during discovery: ${apiError.message}`);
    }
    
    // Filter by date range if enabled
    let filteredItems = [...mediaItems];
    if (settings.useDateRange && settings.startDate && settings.endDate) {
      console.log('Filtering discovered items by date range...');
      const startDate = new Date(settings.startDate);
      const endDate = new Date(settings.endDate);
      
      filteredItems = mediaItems.filter(item => {
        if (!item.mediaMetadata || !item.mediaMetadata.creationTime) {
          return false;
        }
        const itemDate = new Date(item.mediaMetadata.creationTime);
        return itemDate >= startDate && itemDate <= endDate;
      });
      
      console.log(`After date filtering: ${filteredItems.length} items (was ${mediaItems.length})`);
    }
    
    // Only update the global discovery results if this is a fresh discovery (not continuation)
    if (!continueDiscovery) {
      // Store last discovery results for sync
      lastDiscoveryResults = {
        items: filteredItems,
        totalItems: mediaItems.length,
        photoCount,
        videoCount,
        filteredItems: filteredItems.length,
        estimatedSizeBytes: totalSizeEstimate,
        estimatedSizeMB: Math.round(totalSizeEstimate / (1024 * 1024)),
        hasMore: !!nextPageToken,
        pagesScanned: pageCount,
        dateFiltered: settings.useDateRange && settings.startDate && settings.endDate
      };
    } else {
      // Merge with existing discovery results
      if (lastDiscoveryResults) {
        lastDiscoveryResults = {
          items: [...lastDiscoveryResults.items, ...filteredItems],
          totalItems: lastDiscoveryResults.totalItems + mediaItems.length,
          photoCount: lastDiscoveryResults.photoCount + photoCount,
          videoCount: lastDiscoveryResults.videoCount + videoCount,
          filteredItems: lastDiscoveryResults.filteredItems + filteredItems.length,
          estimatedSizeBytes: lastDiscoveryResults.estimatedSizeBytes + totalSizeEstimate,
          estimatedSizeMB: Math.round((lastDiscoveryResults.estimatedSizeBytes + totalSizeEstimate) / (1024 * 1024)),
          hasMore: !!nextPageToken,
          pagesScanned: lastDiscoveryResults.pagesScanned + pageCount,
          dateFiltered: settings.useDateRange && settings.startDate && settings.endDate
        };
      } else {
        // No existing results to merge with
        lastDiscoveryResults = {
          items: filteredItems,
          totalItems: mediaItems.length,
          photoCount,
          videoCount,
          filteredItems: filteredItems.length,
          estimatedSizeBytes: totalSizeEstimate,
          estimatedSizeMB: Math.round(totalSizeEstimate / (1024 * 1024)),
          hasMore: !!nextPageToken,
          pagesScanned: pageCount,
          dateFiltered: settings.useDateRange && settings.startDate && settings.endDate
        };
      }
    }
    
    // Return discovery summary (without the actual items to keep response size small)
    const discoveryResults = {
      totalItems: mediaItems.length,
      photoCount,
      videoCount,
      filteredItems: filteredItems.length,
      estimatedSizeBytes: totalSizeEstimate,
      estimatedSizeMB: Math.round(totalSizeEstimate / (1024 * 1024)),
      hasMore: !!nextPageToken,
      nextPageToken,
      pagesScanned: pageCount,
      dateFiltered: settings.useDateRange && settings.startDate && settings.endDate
    };
    
    console.log('Discovery results:', discoveryResults);
    return discoveryResults;
  } catch (error) {
    console.error(`Error discovering photos: ${error.message}`);
    throw error;
  }
}

// Update syncPhotos to use discovered items
async function syncPhotos() {
    const settings = loadSettings();

    const auth = await authenticate();
    if (!auth) {
        log('Not authenticated. Please log in first.');
        return;
    }

    if (!fs.existsSync(settings.syncFolder)) {
        log(`Creating sync folder: ${settings.syncFolder}`);
        fs.mkdirSync(settings.syncFolder, { recursive: true });
    }

    log('Fetching photos from Google Photos...');
    const photos = await getDiscoveredItems(auth, settings);
    
    if (!photos || photos.length === 0) {
        log('No photos found to sync. Run discovery first.');
        currentSync = {
            status: 'completed',
            isPaused: false,
            isCancelled: false,
            totalItems: 0,
            processedItems: 0,
            activeDownloads: new Set()
        };
        saveSyncStatus();
        broadcastSyncStatus();
        return;
    }
    
    log(`Found ${photos.length} photos to process`);
    currentSync = {
        status: 'running',
        isPaused: false,
        isCancelled: false,
        totalItems: photos.length,
        processedItems: 0,
        activeDownloads: new Set()
    };
    saveSyncStatus();
    broadcastSyncStatus();
    
    try {
        log('Starting sync process...');
        
        const storage = await checkStorageSpace(settings.syncFolder);
        if (storage && storage.usePercent > 90) {
            log('Warning: Storage space is running low!');
            if (settings.notificationEmail) {
                await sendEmail(
                    settings.notificationEmail,
                    'Storage Warning',
                    `Storage space is running low on ${settings.syncFolder}. Current usage: ${storage.usePercent}%`
                );
            }
        }

        // Create a queue for concurrent downloads
        const queue = await Promise.all(photos.map(async photo => {
            try {
                // Get the full media item details for each photo
                const details = await auth.request({
                    url: `https://photoslibrary.googleapis.com/v1/mediaItems/${photo.id}`,
                    method: 'GET'
                });
                
                const mediaItem = details.data;
                const isVideo = mediaItem.mediaMetadata.video;
                const extension = isVideo ? '.mp4' : '.jpg';
                
                // Construct the proper download URL
                const downloadUrl = isVideo ? 
                    `${mediaItem.baseUrl}=dv` : // Original video quality
                    `${mediaItem.baseUrl}=d`;   // Original photo quality
                
                return {
                    id: mediaItem.id,
                    filename: `${mediaItem.id}${extension}`,
                    downloadUrl: downloadUrl,
                    mediaType: isVideo ? 'video' : 'photo',
                    width: mediaItem.mediaMetadata.width,
                    height: mediaItem.mediaMetadata.height,
                    creationTime: mediaItem.mediaMetadata.creationTime
                };
            } catch (error) {
                console.error(`Error getting details for item ${photo.id}:`, error);
                return null;
            }
        }));

        // Filter out any failed items
        const validQueue = queue.filter(item => item !== null);
        
        log(`Prepared ${validQueue.length} items for download`);
        
        const concurrentDownloads = Math.min(settings.concurrentDownloads || 3, 5);
        
        while ((validQueue.length > 0 || currentSync.activeDownloads.size > 0) && !currentSync.isCancelled) {
            if (currentSync.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            while (validQueue.length > 0 && currentSync.activeDownloads.size < concurrentDownloads && !currentSync.isPaused && !currentSync.isCancelled) {
                const item = validQueue.shift();
                
                if (!settings.syncPhotos && item.mediaType === 'photo') {
                    currentSync.processedItems++;
                    broadcastSyncStatus();
                    continue;
                }
                if (!settings.syncVideos && item.mediaType === 'video') {
                    currentSync.processedItems++;
                    broadcastSyncStatus();
                    continue;
                }

                const filepath = path.join(settings.syncFolder, item.filename);
                
                if (!fs.existsSync(filepath)) {
                    currentSync.activeDownloads.add(item.id);
                    log(`Starting download of ${item.mediaType}: ${item.filename} (${item.width}x${item.height})`);
                    
                    try {
                        // Make a HEAD request to get the file size
                        const headResponse = await axios.head(item.downloadUrl);
                        const fileSize = headResponse.headers['content-length'];
                        const fileSizeMB = fileSize ? (fileSize / (1024 * 1024)).toFixed(2) : 'unknown';
                        log(`File size: ${fileSizeMB} MB`);
                        
                        await downloadPhoto(item.downloadUrl, item.filename, settings);
                        
                        // Verify the downloaded file size
                        const downloadedSize = fs.statSync(filepath).size;
                        const downloadedSizeMB = (downloadedSize / (1024 * 1024)).toFixed(2);
                        log(`Successfully downloaded ${item.filename} (${downloadedSizeMB} MB)`);
                        
                        currentSync.processedItems++;
                        currentSync.activeDownloads.delete(item.id);
                        broadcastSyncStatus();
                    } catch (error) {
                        log(`Error downloading ${item.filename}: ${error.message}`);
                        currentSync.activeDownloads.delete(item.id);
                        broadcastSyncStatus();
                    }
                } else {
                    currentSync.processedItems++;
                    log(`Skipping: ${item.filename} (already exists)`);
                    broadcastSyncStatus();
                }
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (currentSync.isCancelled) {
            log('Sync cancelled by user');
            currentSync.status = 'cancelled';
        } else if (currentSync.isPaused) {
            log('Sync paused by user');
            currentSync.status = 'paused';
        } else {
            if (settings.deleteRemoved) {
                log('Checking for removed photos...');
                const localFiles = fs.readdirSync(settings.syncFolder);
                const remoteIds = photos.map(p => p.id);
                for (const file of localFiles) {
                    const fileId = file.split('.')[0];
                    if (!remoteIds.includes(fileId)) {
                        fs.unlinkSync(path.join(settings.syncFolder, file));
                        log(`Deleted removed file: ${file}`);
                    }
                }
            }
            
            currentSync.status = 'completed';
            log('Sync complete!');
        }
        
        broadcastSyncStatus();
    } catch (error) {
        log(`Error during sync: ${error.message}`);
        console.error('Full error:', error);
        currentSync.status = 'error';
        broadcastSyncStatus();
        throw error;
    }
}

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all routes with specific options
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add preflight handling for OPTIONS requests
app.options('*', cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the public directory
app.use(express.static('public'));

// API Routes
app.get('/check-auth', async (req, res) => {
  try {
    console.log('Checking authentication status...');
    const auth = await authenticate();
    
    if (auth) {
      console.log('Authentication successful');
      res.json({ 
        authenticated: true, 
        message: 'User is authenticated' 
      });
    } else {
      console.log('Authentication failed or no tokens available');
      res.json({ 
        authenticated: false, 
        message: 'User is not authenticated' 
      });
    }
  } catch (error) {
    console.error('Error checking auth status:', error);
    res.json({ 
      authenticated: false, 
      message: 'Error checking authentication status', 
      error: error.message 
    });
  }
});

app.get('/auth', (req, res) => {
  console.log('Auth endpoint hit, generating auth URL...');
  
  // Get the React app port if provided
  const reactAppPort = req.query.port || '5173';
  console.log('React app port (from query):', reactAppPort);
  
  // Set environment variable for later use in the callback
  process.env.REACT_APP_PORT = reactAppPort;
  
  // Print environment variables for debugging (without secrets)
  console.log('CLIENT_ID:', process.env.CLIENT_ID?.trim());
  console.log('REDIRECT_URI:', process.env.REDIRECT_URI?.trim());
  
  // Create an OAuth client
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID?.trim(),
    process.env.CLIENT_SECRET?.trim(),
    process.env.REDIRECT_URI?.trim()
  );

  // Generate the URL to Google's OAuth 2.0 server
  const authUrl = oauth2Client.generateAuthUrl({
    // 'offline' gets refresh token
    access_type: 'offline',
    // Scopes for Google Photos API
    scope: SCOPES,
    // Force approval prompt to always get a refresh token
    prompt: 'consent',
    // Include previously granted scopes
    include_granted_scopes: true,
    // Pass the React port in state for callback
    state: reactAppPort
  });

  console.log('Redirecting to Google auth URL:', authUrl);
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    console.log('OAuth callback received with query params:', JSON.stringify(req.query));
    
    // Get parameters from request
    const { code, error: authError, state } = req.query;
    
    // Extract React app port from state if available
    const reactAppPort = state || process.env.REACT_APP_PORT || '5173';
    console.log('React app port (from state):', reactAppPort);
    
    // Construct the base redirect URL for success/error
    const baseRedirectUrl = `http://localhost:${reactAppPort}`;
    
    // Handle errors from Google OAuth
    if (authError) {
        console.error('Error returned from Google OAuth:', authError);
        return res.redirect(`${baseRedirectUrl}/?auth=error&error=` + encodeURIComponent('Google authorization error: ' + authError));
    }
    
    // Ensure we have an authorization code
    if (!code) {
        console.error('No authorization code received');
        return res.redirect(`${baseRedirectUrl}/?auth=error&error=` + encodeURIComponent('No authorization code received'));
    }
    
    try {
        console.log('Received auth code, exchanging for tokens...');
        
        // Create OAuth client
        const oauth2Client = new google.auth.OAuth2(
            process.env.CLIENT_ID?.trim(),
            process.env.CLIENT_SECRET?.trim(),
            process.env.REDIRECT_URI?.trim()
        );

        // Exchange authorization code for tokens
        console.log('Calling OAuth2Client.getToken()...');
        let tokenResponse;
        try {
            tokenResponse = await oauth2Client.getToken(code);
            console.log('Token response received');
        } catch (tokenError) {
            console.error('Error getting tokens:', tokenError);
            throw new Error('Failed to exchange auth code for tokens: ' + tokenError.message);
        }
        
        if (!tokenResponse || !tokenResponse.tokens) {
            throw new Error('Empty token response from Google');
        }
        
        const tokens = tokenResponse.tokens;
        console.log('Tokens received with properties:', Object.keys(tokens).join(', '));
        
        // Ensure we have an access token
        if (!tokens.access_token) {
            throw new Error('No access token received from Google');
        }
        
        // Set the credentials on the OAuth2 client
        oauth2Client.setCredentials(tokens);
        
        // Skip verification for now, just save the tokens
        try {
            const absoluteTokenPath = path.resolve(process.cwd(), TOKENS_PATH);
            console.log('Saving tokens to:', absoluteTokenPath);
            fs.writeFileSync(absoluteTokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
            console.log('Tokens saved successfully');
        } catch (saveError) {
            console.error('Error saving tokens:', saveError);
            throw new Error('Could not save tokens: ' + saveError.message);
        }
        
        // Success! Redirect back to the app
        console.log('Authentication successful, redirecting to:', `${baseRedirectUrl}/?auth=success`);
        res.redirect(`${baseRedirectUrl}/?auth=success`);
    } catch (error) {
        console.error('Error in OAuth callback:', error);
        console.error('Error details:', error.stack);
        
        // Delete tokens file if it exists (cleanup on error)
        try {
            if (fs.existsSync(TOKENS_PATH)) {
                fs.unlinkSync(TOKENS_PATH);
                console.log('Deleted invalid tokens file');
            }
        } catch (cleanupError) {
            console.error('Error cleaning up tokens file:', cleanupError);
        }
        
        // Redirect with error
        const redirectUrl = `${baseRedirectUrl}/?auth=error&error=${encodeURIComponent(error.message)}`;
        console.log('Redirecting to error URL:', redirectUrl);
        res.redirect(redirectUrl);
    }
});

app.post('/logout', (req, res) => {
  try {
    if (fs.existsSync('tokens.json')) {
      fs.unlinkSync('tokens.json');
      res.json({ success: true });
    } else {
      res.json({ success: true, message: 'No tokens file found' });
    }
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/get-settings', (req, res) => {
  try {
    if (fs.existsSync('settings.json')) {
      const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
      res.json(settings);
    } else {
      // Return default settings if file doesn't exist
      const defaultSettings = {
        syncFolder: path.join(process.cwd(), 'photos'),
        deleteRemoved: false,
        storageWarning: true,
        syncPhotos: true,
        syncVideos: true,
        useDateRange: false,
        startDate: '',
        endDate: '',
        syncFrequency: 'manual',
        syncTime: '00:00',
        organizationMethod: 'date',
        namingPattern: 'original',
        customPattern: '',
        compressPhotos: false,
        preserveExif: true,
        convertVideos: false,
        generateThumbnails: true,
        bandwidthLimit: 0,
        concurrentDownloads: 3,
        networkTimeout: 30,
        backupLocation: '',
        backupSchedule: 'none',
        backupRetention: 30,
        settingsPassword: '',
        ipWhitelist: '',
        notificationEmail: '',
        maxRetries: 3
      };
      res.json(defaultSettings);
    }
  } catch (error) {
    console.error('Error reading settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

app.post('/save-settings', (req, res) => {
  try {
    fs.writeFileSync('settings.json', JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.get('/sync/status', (req, res) => {
    try {
        const status = {
            status: currentSync.status,
            progress: currentSync.totalItems > 0 
                ? Math.round((currentSync.processedItems / currentSync.totalItems) * 100)
                : 0,
            isPaused: currentSync.isPaused,
            message: currentSync.status === 'paused' 
                ? 'Sync paused' 
                : currentSync.status === 'cancelled'
                ? 'Sync cancelled'
                : `${currentSync.processedItems} of ${currentSync.totalItems} items processed`
        };
        res.json(status);
    } catch (error) {
        console.error('Error getting sync status:', error);
        res.status(500).json({ error: 'Failed to get sync status' });
    }
});

app.post('/sync', async (req, res) => {
    try {
        // Check if sync is already running
        if (currentSync.status === 'running' || currentSync.status === 'paused') {
            return res.status(400).json({ error: 'Sync is already in progress' });
        }

        const auth = await authenticate();
        if (!auth) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Start the sync process
        syncPhotos().catch(error => {
            console.error('Sync error:', error);
        });

        res.json({ success: true, message: 'Sync started' });
    } catch (error) {
        console.error('Error starting sync:', error);
        res.status(500).json({ error: 'Failed to start sync' });
    }
});

app.post('/sync/pause', (req, res) => {
  try {
    if (currentSync.status === 'running') {
      currentSync.isPaused = true;
      currentSync.status = 'paused';
      log('Sync paused by user');
      broadcastSyncStatus();
      res.json({ success: true, message: 'Sync paused' });
    } else {
      res.status(400).json({ error: 'Sync is not running' });
    }
  } catch (error) {
    console.error('Error pausing sync:', error);
    res.status(500).json({ error: 'Failed to pause sync' });
  }
});

app.post('/sync/resume', (req, res) => {
  try {
    if (currentSync.status === 'paused') {
      currentSync.isPaused = false;
      currentSync.status = 'running';
      log('Sync resumed by user');
      broadcastSyncStatus();
      res.json({ success: true, message: 'Sync resumed' });
    } else {
      res.status(400).json({ error: 'Sync is not paused' });
    }
  } catch (error) {
    console.error('Error resuming sync:', error);
    res.status(500).json({ error: 'Failed to resume sync' });
  }
});

app.post('/sync/cancel', (req, res) => {
  try {
    if (currentSync.status === 'running' || currentSync.status === 'paused') {
      currentSync.isCancelled = true;
      currentSync.status = 'cancelled';
      log('Sync cancelled by user');
      broadcastSyncStatus();
      res.json({ success: true, message: 'Sync cancelled' });
    } else {
      res.status(400).json({ error: 'No sync in progress' });
    }
  } catch (error) {
    console.error('Error cancelling sync:', error);
    res.status(500).json({ error: 'Failed to cancel sync' });
  }
});

// Add a new discovery endpoint
app.post('/discover', async (req, res) => {
  try {
    console.log('Discovery request received', req.body);
    
    // Check authentication
    const auth = await authenticate();
    if (!auth) {
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated' 
      });
    }
    
    // Get settings or use defaults
    const settings = loadSettings();
    
    // Add pagination settings from request
    const discoveryOptions = {
      ...settings,
      continueDiscovery: req.body?.continueDiscovery || false,
      pageToken: req.body?.pageToken || null
    };
    
    // If continuing discovery and we have a saved token, use it
    if (discoveryOptions.continueDiscovery && discoveryOptions.pageToken) {
      console.log('Continuing discovery with token:', discoveryOptions.pageToken);
    } else if (discoveryOptions.continueDiscovery) {
      console.log('Continue discovery requested but no token provided, starting fresh');
    }
    
    // Start discovery process
    const discoveryResults = await discoverPhotos(auth, discoveryOptions);
    
    // Return discovery results
    res.json({
      success: true,
      discovery: {
        ...discoveryResults,
        nextPageToken: discoveryResults.nextPageToken || null
      }
    });
  } catch (error) {
    console.error('Error during discovery:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to discover photos' 
    });
  }
});

// Create HTTP server and start it properly
const server = http.createServer(app);

// Create WebSocket server with improved configuration
wsServer = new WebSocketServer({
  server: server,
  path: '/ws',
  clientTracking: true, // Track connected clients
  // Use default perMessageDeflate settings
  perMessageDeflate: true
});

console.log('WebSocket server created with path: /ws');

// Handle WebSocket server errors
wsServer.on('error', (error) => {
  console.error('WebSocket server error:', error.message);
});

// Handle client connections
wsServer.on('connection', (ws, request) => {
  console.log('WebSocket client connected from:', request.socket.remoteAddress);
  
  // Keep connection alive with ping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocketServer.OPEN) {
      try {
        ws.ping();
      } catch (err) {
        console.error('Error sending ping:', err.message);
      }
    }
  }, 30000);
  
  // Send initial sync status on connection
  const status = {
    type: 'syncStatus',
    status: currentSync.status,
    progress: currentSync.totalItems > 0 
      ? Math.round((currentSync.processedItems / currentSync.totalItems) * 100)
      : 0,
    isPaused: currentSync.isPaused,
    message: currentSync.status === 'paused' 
      ? 'Sync paused' 
      : currentSync.status === 'cancelled'
      ? 'Sync cancelled'
      : `${currentSync.processedItems} of ${currentSync.totalItems} items processed`
  };
  
  // Send initial status with a slight delay
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
    // Connection is alive
    console.log('Received pong from client');
  });
});

// Start the server after setting up all routes and WebSocket
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  console.log(`WebSocket server available at ws://localhost:${port}/ws`);
  
  // Initialize sync status
  broadcastSyncStatus();
  
  // Set up a periodic sync status broadcast
  setInterval(() => {
    // Only broadcast if there are clients connected
    if (wsServer && wsServer.clients && wsServer.clients.size > 0) {
      broadcastSyncStatus();
    }
  }, 10000);
});

