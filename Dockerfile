# Use Node.js LTS version
FROM node:20-alpine

# Install dependencies for better performance
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create volume mount points
RUN mkdir -p /data/photos /data/config

# Set environment variables
ENV NODE_ENV=production \
    PHOTOS_DIR=/data/photos \
    CONFIG_DIR=/data/config

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"] 