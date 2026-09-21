# YouTube Video Downloader (Resolution Selector & MP3 Converter)

A web application designed to download YouTube videos in any resolution you want (up to 4K / 8K, 1080p Full HD, 720p HD, 480p, 360p, 240p) or extract high-bitrate audio (MP3 / M4A).

## Features

- **Custom Resolution Picker**: Choose from any available resolution (4K UHD, 2K QHD, 1080p 60fps, 1080p, 720p, 480p, 360p, 240p, 144p).
- **Lossless FFmpeg Audio-Video Merging**: Automatically multiplexes high-resolution adaptive video streams with high-bitrate audio tracks into a clean `.mp4` container.
- **Audio Only Mode**: Extract high-fidelity MP3 (320kbps / 192kbps) or original AAC M4A.
- **Real-Time Download Tracking**: Server-Sent Events (SSE) tracking live download speed (MB/s), ETA countdown, percent, and active phase (Downloading -> Merging -> Ready).
- **One-Click Save & Folder Explorer**: Save directly to your browser's download folder or open the server's `downloads/` folder directly via Windows Explorer.
- **Download History**: View previously downloaded media with file sizes, timestamps, and instant re-download options.
- **Modern Dark Glass UI**: YouTube-inspired neon ruby & dark onyx glassmorphic design.

---

## How to Run

1. Open your terminal in this directory (`c:\Users\USER\Desktop\Oluwayimika\yt-downloader`).
2. Start the server:
   ```bash
   npm.cmd start
   ```
   *(or `node server.js`)*
3. Open your web browser and navigate to:
   [http://localhost:3000](http://localhost:3000)

---

## How to Use

1. Paste any YouTube video link or Shorts link into the input box (or click one of the quick sample chips).
2. Click **Fetch Resolutions**.
3. Inspect video details (thumbnail, title, duration, views) and select your desired resolution from the interactive grid.
4. Click **Start Download**. Watch the real-time progress bar and metrics.
5. Once complete, the file will automatically be saved to your device, and you can also click **Save to Device** or **Open Folder**.
