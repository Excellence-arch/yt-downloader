# Use official Node.js 20 LTS Debian slim image
FROM node:20-bookworm-slim

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

WORKDIR /app

# Install system dependencies: FFmpeg, Python3, curl, ca-certificates
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        curl \
        ca-certificates && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package dependencies and install production packages
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Railway dynamically assigns PORT and exposes it
EXPOSE 5000

# Start server
CMD ["node", "server.js"]
