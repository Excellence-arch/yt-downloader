const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Directories
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

const binDir = path.join(__dirname, 'bin');

// Resolve yt-dlp path (supports Windows bin/yt-dlp.exe, local Linux bin, and Linux system PATH on Railway)
let ytdlpPath = 'yt-dlp';
const localWinYtdlp = path.join(binDir, 'yt-dlp.exe');
const localLinuxYtdlp = path.join(binDir, 'yt-dlp');

if (process.platform === 'win32' && fs.existsSync(localWinYtdlp)) {
  ytdlpPath = localWinYtdlp;
} else if (fs.existsSync(localLinuxYtdlp)) {
  ytdlpPath = localLinuxYtdlp;
} else {
  ytdlpPath = 'yt-dlp'; // System PATH in Linux Docker (Railway)
}

// Resolve FFmpeg path (ffmpeg-static, system ffmpeg, or bundled)
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath && !fs.existsSync(ffmpegPath)) {
    ffmpegPath = null;
  }
} catch (e) {
  ffmpegPath = null;
}

if (!ffmpegPath) {
  const localFfmpeg = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(localFfmpeg)) {
    ffmpegPath = localFfmpeg;
  } else {
    ffmpegPath = 'ffmpeg'; // System PATH in Linux Docker (Railway)
  }
}

console.log(`[Server] yt-dlp path: ${ytdlpPath}`);
console.log(`[Server] ffmpeg path: ${ffmpegPath || 'Not found (will use default path)'}`);
console.log(`[Server] Downloads directory: ${downloadsDir}`);

// Active download jobs & SSE listeners
const jobs = new Map();
const sseClients = new Map();

function broadcastProgress(jobId, jobData) {
  const clients = sseClients.get(jobId);
  if (clients && clients.length > 0) {
    const payload = `data: ${JSON.stringify(jobData)}\n\n`;
    clients.forEach((res) => {
      try {
        res.write(payload);
      } catch (err) {
        // ignore client closed
      }
    });
  }
}

// Helpers
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return 'Unknown size';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatViews(views) {
  if (!views) return '0 views';
  if (views >= 1000000) {
    return (views / 1000000).toFixed(1) + 'M views';
  }
  if (views >= 1000) {
    return (views / 1000).toFixed(1) + 'K views';
  }
  return views.toLocaleString() + ' views';
}

// 1. Fetch Video Info and Available Resolutions
app.post('/api/info', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid YouTube video URL.' });
  }

  const cleanUrl = url.trim();
  console.log(`[Info] Extracting metadata for: ${cleanUrl}`);

  const args = [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    cleanUrl
  ];

  const child = spawn(ytdlpPath, args);
  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  child.on('close', (code) => {
    if (code !== 0 || !stdoutData.trim()) {
      console.error(`[Info Error] Code ${code}: ${stderrData}`);
      return res.status(400).json({
        error: stderrData.includes('Private video') 
          ? 'This video is private.'
          : stderrData.includes('Video unavailable')
          ? 'This video is unavailable or has been removed.'
          : 'Failed to fetch video information. Please check the URL and try again.'
      });
    }

    try {
      const data = JSON.parse(stdoutData.trim());
      
      // Process available formats
      const rawFormats = data.formats || [];
      const resolutionMap = new Map();

      // Standard resolution height benchmarks
      const qualityLabels = {
        4320: '8K Ultra HD',
        2160: '4K Ultra HD',
        1440: '2K Quad HD',
        1080: '1080p Full HD',
        720: '720p HD',
        480: '480p SD',
        360: '360p Medium',
        240: '240p Low',
        144: '144p Tiny'
      };

      rawFormats.forEach((f) => {
        if (!f.height || f.vcodec === 'none') return;
        const h = f.height;
        const fps = f.fps || 30;
        const key = `${h}p${fps > 30 ? '60' : ''}`;

        let sizeEst = f.filesize || f.filesize_approx;
        if (!sizeEst && f.tbr && data.duration) {
          sizeEst = Math.round((f.tbr * 1024 * data.duration) / 8);
        }

        const existing = resolutionMap.get(key);
        if (!existing || (f.tbr && (!existing.tbr || f.tbr > existing.tbr))) {
          resolutionMap.set(key, {
            key,
            height: h,
            fps,
            label: `${h}p${fps > 30 ? ' 60fps' : ''}`,
            qualityName: qualityLabels[h] || `${h}p`,
            isHd: h >= 720,
            isUhd: h >= 1440,
            ext: 'mp4',
            vcodec: f.vcodec,
            tbr: f.tbr,
            filesize: sizeEst,
            filesizeFormatted: sizeEst ? formatBytes(sizeEst) : 'Estimated ~' + (f.tbr ? formatBytes((f.tbr * 1024 * (data.duration || 60)) / 8) : 'N/A')
          });
        }
      });

      // Sort resolutions descending by height, then fps
      const resolutions = Array.from(resolutionMap.values()).sort((a, b) => {
        if (b.height !== a.height) return b.height - a.height;
        return b.fps - a.fps;
      });

      // Audio options
      const audioFormats = rawFormats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
      const bestAudio = audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
      const audioSize = bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || (data.duration ? Math.round((192 * 1024 * data.duration) / 8) : 0)) : 0;

      const audioOptions = [
        {
          key: 'mp3_320',
          label: 'MP3 - High Quality (320 kbps)',
          ext: 'mp3',
          bitrate: '320k',
          filesizeFormatted: audioSize ? formatBytes(audioSize * 1.5) : '~10 MB'
        },
        {
          key: 'mp3_192',
          label: 'MP3 - Standard Quality (192 kbps)',
          ext: 'mp3',
          bitrate: '192k',
          filesizeFormatted: audioSize ? formatBytes(audioSize) : '~6 MB'
        },
        {
          key: 'm4a',
          label: 'M4A - Original Audio (AAC)',
          ext: 'm4a',
          bitrate: 'original',
          filesizeFormatted: audioSize ? formatBytes(audioSize * 0.9) : '~5 MB'
        }
      ];

      // Video metadata
      const videoInfo = {
        id: data.id,
        title: data.title,
        webpage_url: data.webpage_url || cleanUrl,
        thumbnail: data.thumbnail,
        duration: data.duration,
        durationFormatted: formatDuration(data.duration),
        channel: data.uploader || data.channel || 'Unknown Channel',
        channel_url: data.uploader_url || data.channel_url || '',
        channel_avatar: data.channel_follower_count ? null : null,
        view_count: data.view_count,
        viewsFormatted: formatViews(data.view_count),
        upload_date: data.upload_date ? `${data.upload_date.slice(0, 4)}-${data.upload_date.slice(4, 6)}-${data.upload_date.slice(6, 8)}` : null,
        description: data.description ? data.description.slice(0, 300) : ''
      };

      return res.json({
        success: true,
        info: videoInfo,
        resolutions,
        audioOptions
      });
    } catch (parseErr) {
      console.error('[JSON Parse Error]', parseErr);
      return res.status(500).json({ error: 'Failed to parse video details from YouTube.' });
    }
  });
});

// 1.5. Direct Device Streaming (Immediate download to device without intermediate waiting)
app.get('/api/stream', (req, res) => {
  const { url, height, format, audioOnly, audioBitrate, title } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('Video URL is required.');
  }

  const cleanUrl = url.trim();
  const isAudio = audioOnly === 'true' || audioOnly === true;
  const ext = isAudio ? (format === 'm4a' ? 'm4a' : 'mp3') : (format || 'mp4');

  // Sanitize title for filename
  const rawTitle = title || 'video';
  const cleanTitle = rawTitle.replace(/[\\/*?:"<>|]/g, '').trim().substring(0, 100) || 'video';
  const fileName = `${cleanTitle}.${ext}`;

  const isInline = req.query.inline === 'true' || req.query.play === 'true';
  const streamFormat = isAudio ? ext : (isInline ? 'webm' : (format || 'mp4'));
  const finalFileName = `${cleanTitle}.${streamFormat}`;

  if (isInline) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(finalFileName)}"`);
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalFileName)}"; filename*=UTF-8''${encodeURIComponent(finalFileName)}`);
  }
  res.setHeader('Content-Type', isAudio ? (ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4') : (streamFormat === 'webm' ? 'video/webm' : 'video/mp4'));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Transfer-Encoding', 'chunked');

  const args = [
    '--no-playlist',
    '--js-runtimes', 'node',
    '--concurrent-fragments', '8',
    '--buffer-size', '64K',
    '--http-chunk-size', '10M',
    '--extractor-args', 'youtube:player_client=android,web'
  ];

  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }

  if (isAudio) {
    args.push('-x');
    if (ext === 'm4a') {
      args.push('--audio-format', 'm4a');
    } else {
      args.push('--audio-format', 'mp3');
      if (audioBitrate) {
        args.push('--audio-quality', audioBitrate === '320k' ? '0' : '2');
      }
    }
  } else {
    const targetHeight = parseInt(height, 10) || 720;
    // For inline browser playback, select best matching stream and merge to webm for instant non-seekable pipe playback
    const formatSelector = isInline
      ? `bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`
      : `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;
    args.push('-f', formatSelector);
    args.push('--merge-output-format', streamFormat);
  }

  args.push('-o', '-'); // Output directly to stdout
  args.push(cleanUrl);

  const child = spawn(ytdlpPath, args);

  // Pipe stream straight to browser response
  child.stdout.pipe(res);

  child.stderr.on('data', (data) => {
    // console.log(`[Stream stderr] ${data.toString()}`);
  });

  child.on('close', (code) => {
    console.log(`[Direct Stream] Finished with code ${code} for "${fileName}"`);
  });

  child.on('error', (err) => {
    console.error(`[Direct Stream Error]`, err);
    if (!res.headersSent) {
      res.status(500).send('Streaming failed.');
    }
  });

  // If user cancels download in browser, terminate the process
  req.on('close', () => {
    if (!child.killed) {
      console.log(`[Direct Stream] Client aborted download for: "${fileName}"`);
      child.kill('SIGINT');
    }
  });
});

// 2. Start Download Job (Optional background job with on-screen stats)
app.post('/api/download', (req, res) => {
  const { url, height, fps, format, audioOnly, audioBitrate, customTitle } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Video URL is required.' });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const outputTemplate = path.join(downloadsDir, '%(title)s [%(id)s].%(ext)s');

  const job = {
    id: jobId,
    url,
    title: customTitle || 'Downloading video...',
    status: 'starting',
    step: 'Initializing download...',
    percent: 0,
    speed: '',
    eta: '',
    downloadedBytes: '',
    totalBytes: '',
    filePath: null,
    fileName: null,
    error: null,
    createdAt: Date.now()
  };

  jobs.set(jobId, job);

  // Construct yt-dlp arguments with high-speed concurrency optimizations
  const args = [
    '--newline',
    '--progress',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--concurrent-fragments', '8',
    '--buffer-size', '64K',
    '--http-chunk-size', '10M',
    '--extractor-args', 'youtube:player_client=android,web',
    '-o', outputTemplate
  ];

  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }

  if (audioOnly) {
    args.push('-x');
    if (format === 'm4a') {
      args.push('--audio-format', 'm4a');
    } else {
      args.push('--audio-format', 'mp3');
      if (audioBitrate) {
        args.push('--audio-quality', audioBitrate === '320k' ? '0' : '2');
      }
    }
  } else {
    // Video with audio merged
    const targetHeight = height || 1080;
    // Format selector: select best video up to height, prefer mp4, and best audio, then merge to mp4
    const formatSelector = `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;
    args.push('-f', formatSelector);
    args.push('--merge-output-format', format || 'mp4');
  }

  args.push(url);

  console.log(`[Job ${jobId}] Starting yt-dlp with args:`, args.join(' '));

  const child = spawn(ytdlpPath, args);
  let finalFile = null;

  child.stdout.on('data', (dataChunk) => {
    const text = dataChunk.toString();
    const lines = text.split(/[\r\n]+/);

    for (const line of lines) {
      if (!line.trim()) continue;

      // Extract Destination / Merged filename
      const destMatch = line.match(/Destination:\s+(.+)$/i) || line.match(/Merging formats into\s+"([^"]+)"/i) || line.match(/\[ExtractAudio\] Destination:\s+(.+)$/i);
      if (destMatch && destMatch[1]) {
        finalFile = destMatch[1].trim();
        job.filePath = finalFile;
        job.fileName = path.basename(finalFile);
      }

      // Title line if available
      const titleMatch = line.match(/\[download\] Destination:\s+(.+?)(\s+\[[a-zA-Z0-9_-]+\])?\.[a-zA-Z0-9]+$/);
      if (titleMatch && titleMatch[1]) {
        const inferredTitle = path.basename(titleMatch[1]);
        if (inferredTitle) job.title = inferredTitle;
      }

      // Detect phases
      if (line.includes('[download]')) {
        job.status = 'downloading';

        // Parse progress: [download]  45.2% of  120.50MiB at  12.34MiB/s ETA 00:05
        const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)(?:\s+at\s+([\d.]+\w+\/s))?(?:\s+ETA\s+([\d:]+))?/i);
        if (progressMatch) {
          job.percent = parseFloat(progressMatch[1]);
          job.totalBytes = progressMatch[2] || '';
          job.speed = progressMatch[3] || job.speed;
          job.eta = progressMatch[4] || job.eta;
          job.step = `Downloading stream: ${job.percent}% (${job.totalBytes})`;
          broadcastProgress(jobId, job);
        }
      } else if (line.includes('[Merger]')) {
        job.status = 'merging';
        job.step = 'Merging video and audio with FFmpeg...';
        job.percent = 98;
        broadcastProgress(jobId, job);
      } else if (line.includes('[ExtractAudio]')) {
        job.status = 'converting';
        job.step = 'Converting audio with FFmpeg...';
        job.percent = 95;
        broadcastProgress(jobId, job);
      }
    }
  });

  child.stderr.on('data', (errChunk) => {
    console.log(`[Job ${jobId} stderr]`, errChunk.toString().trim());
  });

  child.on('close', (exitCode) => {
    console.log(`[Job ${jobId}] Finished with code ${exitCode}`);
    if (exitCode === 0) {
      // Find actual downloaded file if not caught directly from stdout
      if (!job.filePath || !fs.existsSync(job.filePath)) {
        try {
          const files = fs.readdirSync(downloadsDir);
          // Find most recently created file in downloadsDir
          let newestFile = null;
          let newestTime = 0;
          for (const f of files) {
            const isTemp = f.endsWith('.part') || f.endsWith('.ytdl') || f.includes('.temp') || /\.f\d+\./.test(f);
            if (isTemp) continue;
            const p = path.join(downloadsDir, f);
            const stat = fs.statSync(p);
            if (stat.mtimeMs > newestTime && stat.mtimeMs >= job.createdAt - 5000) {
              newestTime = stat.mtimeMs;
              newestFile = p;
            }
          }
          if (newestFile) {
            job.filePath = newestFile;
            job.fileName = path.basename(newestFile);
          }
        } catch (e) {
          console.error('Error scanning downloads directory:', e);
        }
      }

      job.status = 'completed';
      job.percent = 100;
      job.step = 'Download ready!';
      job.speed = '';
      job.eta = '00:00';
    } else {
      job.status = 'error';
      job.error = 'Download failed or was interrupted.';
    }
    broadcastProgress(jobId, job);
  });

  return res.json({
    success: true,
    jobId,
    message: 'Download job started.'
  });
});

// 3. Real-Time Progress via Server-Sent Events (SSE)
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send current state
  res.write(`data: ${JSON.stringify(job)}\n\n`);

  if (!sseClients.has(jobId)) {
    sseClients.set(jobId, []);
  }
  sseClients.get(jobId).push(res);

  req.on('close', () => {
    const clients = sseClients.get(jobId) || [];
    sseClients.set(jobId, clients.filter(c => c !== res));
  });
});

// 4. Download / Serve Final File to Browser
app.get('/api/file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File not found or still processing.' });
  }

  const fileName = job.fileName || path.basename(job.filePath);
  res.download(job.filePath, fileName, (err) => {
    if (err) {
      console.error('[Download error]', err);
    }
  });
});

// 5. Download History List
app.get('/api/history', (req, res) => {
  try {
    const files = fs.readdirSync(downloadsDir);
    const history = [];

    files.forEach((f) => {
      const isTemp = f.endsWith('.part') || f.endsWith('.ytdl') || f.includes('.temp') || /\.f\d+\./.test(f);
      if (isTemp) return;
      const fullPath = path.join(downloadsDir, f);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        history.push({
          fileName: f,
          size: stat.size,
          sizeFormatted: formatBytes(stat.size),
          createdAt: stat.mtimeMs,
          dateFormatted: new Date(stat.mtimeMs).toLocaleString(),
          downloadUrl: `/api/download-file?name=${encodeURIComponent(f)}`
        });
      }
    });

    history.sort((a, b) => b.createdAt - a.createdAt);
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read download history.' });
  }
});

// Download directly from history by filename
app.get('/api/download-file', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).send('Filename required');
  const safeName = path.basename(name);
  const filePath = path.join(downloadsDir, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  return res.download(filePath, safeName);
});

// 6. Open Downloads Folder in Windows Explorer
app.post('/api/open-folder', (req, res) => {
  const cmd = `explorer.exe "${downloadsDir}"`;
  exec(cmd, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not open folder on system.' });
    }
    return res.json({ success: true, path: downloadsDir });
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 YouTube Downloader is live at http://localhost:${PORT}`);
  console.log(`====================================================`);
});
