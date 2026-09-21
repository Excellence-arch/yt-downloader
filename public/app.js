// YouTube Downloader Frontend Logic
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const urlForm = document.getElementById('url-form');
  const urlInput = document.getElementById('video-url-input');
  const btnPaste = document.getElementById('btn-paste');
  const btnClear = document.getElementById('btn-clear');
  const btnFetch = document.getElementById('btn-fetch');
  const btnQuickPlay = document.getElementById('btn-quick-play');
  const btnFetchText = document.getElementById('btn-fetch-text');
  const fetchSpinner = document.getElementById('fetch-spinner');
  const alertBanner = document.getElementById('alert-banner');
  const alertMessage = document.getElementById('alert-message');

  // Video info elements
  const videoSection = document.getElementById('video-section');
  const videoThumbnail = document.getElementById('video-thumbnail');
  const videoDuration = document.getElementById('video-duration');
  const videoTitle = document.getElementById('video-title');
  const videoChannel = document.getElementById('video-channel');
  const videoViews = document.getElementById('video-views');
  const videoDate = document.getElementById('video-date');
  const videoDesc = document.getElementById('video-desc');

  // Tabs & Grids
  const tabVideo = document.getElementById('tab-video');
  const tabAudio = document.getElementById('tab-audio');
  const videoResolutionsGroup = document.getElementById('video-resolutions-group');
  const audioOptionsGroup = document.getElementById('audio-options-group');
  const resolutionsGrid = document.getElementById('resolutions-grid');
  const audioGrid = document.getElementById('audio-grid');
  const selectedSpecText = document.getElementById('selected-spec-text');
  const btnStartDownload = document.getElementById('btn-start-download');
  const btnDownloadText = document.getElementById('btn-download-text');
  const btnOpenPlayer = document.getElementById('btn-open-player');

  // Progress elements
  const progressSection = document.getElementById('progress-section');
  const progressTitle = document.getElementById('progress-title');
  const progressStepText = document.getElementById('progress-step-text');
  const progressPercentageLabel = document.getElementById('progress-percentage-label');
  const progressFill = document.getElementById('progress-fill');
  const metricSpeed = document.getElementById('metric-speed');
  const metricEta = document.getElementById('metric-eta');
  const metricSize = document.getElementById('metric-size');
  const metricStatus = document.getElementById('metric-status');
  const completedBox = document.getElementById('completed-box');
  const completedFilename = document.getElementById('completed-filename');
  const btnSaveFile = document.getElementById('btn-save-file');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnOpenFolderCompleted = document.getElementById('btn-open-folder-completed');

  // History elements
  const historyList = document.getElementById('history-list');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');

  // State
  let currentVideoUrl = '';
  let currentVideoData = null;
  let selectedMode = 'video'; // 'video' or 'audio'
  let selectedResolution = null;
  let selectedAudio = null;
  let currentEventSource = null;

  // Initial load
  loadHistory();

  // URL Input Clear / Paste helpers
  urlInput.addEventListener('input', () => {
    btnClear.style.display = urlInput.value.trim() ? 'flex' : 'none';
  });

  btnClear.addEventListener('click', () => {
    urlInput.value = '';
    btnClear.style.display = 'none';
    urlInput.focus();
  });

  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        btnClear.style.display = 'flex';
        fetchVideoInfo();
      }
    } catch (err) {
      console.warn('Clipboard read permission not granted:', err);
      urlInput.focus();
    }
  });

  // 1-Click Instant Play & Save As without waiting for metadata
  btnQuickPlay.addEventListener('click', () => {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showAlert('Please paste a YouTube video link first.');
      urlInput.focus();
      return;
    }
    const params = new URLSearchParams({
      url: rawUrl,
      height: '720',
      format: 'webm',
      inline: 'true'
    });
    window.open(`/player.html?${params.toString()}`, '_blank');
  });

  // Sample Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      urlInput.value = chip.getAttribute('data-url');
      btnClear.style.display = 'flex';
      fetchVideoInfo();
    });
  });

  // Form Submit
  urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    fetchVideoInfo();
  });

  // Open folder button
  btnOpenFolder.addEventListener('click', openDownloadsFolder);
  btnOpenFolderCompleted.addEventListener('click', openDownloadsFolder);

  btnRefreshHistory.addEventListener('click', loadHistory);

  // Fetch Video Information
  async function fetchVideoInfo() {
    const url = urlInput.value.trim();
    if (!url) return;

    hideAlert();
    setFetchLoading(true);

    try {
      const response = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch video details.');
      }

      currentVideoUrl = url;
      currentVideoData = data;
      renderVideoDetails(data);
    } catch (err) {
      showAlert(err.message);
    } finally {
      setFetchLoading(false);
    }
  }

  function setFetchLoading(isLoading) {
    btnFetch.disabled = isLoading;
    fetchSpinner.style.display = isLoading ? 'inline-block' : 'none';
    btnFetchText.textContent = isLoading ? 'Analyzing...' : 'Fetch Resolutions';
  }

  function showAlert(msg) {
    alertMessage.textContent = msg;
    alertBanner.style.display = 'flex';
  }

  function hideAlert() {
    alertBanner.style.display = 'none';
  }

  // Render Video Preview & Quality Choices
  function renderVideoDetails(data) {
    const info = data.info;
    videoThumbnail.src = info.thumbnail;
    videoDuration.textContent = info.durationFormatted;
    videoTitle.textContent = info.title;
    videoChannel.textContent = info.channel;
    videoViews.textContent = info.viewsFormatted;
    videoDate.textContent = info.upload_date ? `Uploaded ${info.upload_date}` : '';
    videoDesc.textContent = info.description || 'No description available.';

    // Render Resolutions
    renderResolutions(data.resolutions);
    renderAudioOptions(data.audioOptions);

    // Switch to video mode by default
    setMode('video');

    // Show section with smooth animation
    videoSection.style.display = 'block';
    progressSection.style.display = 'none';
    videoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderResolutions(resolutions) {
    resolutionsGrid.innerHTML = '';

    if (!resolutions || resolutions.length === 0) {
      resolutionsGrid.innerHTML = '<div style="color: var(--text-dim); padding: 12px;">No video resolutions found.</div>';
      return;
    }

    // Default select 1080p if present, or highest available
    const preferred = resolutions.find(r => r.height === 1080) || resolutions[0];
    selectedResolution = preferred;

    resolutions.forEach((res) => {
      const card = document.createElement('div');
      card.className = `quality-card ${res === preferred ? 'selected' : ''}`;
      card.id = `quality-${res.key}`;

      let tagHtml = '';
      if (res.isUhd) {
        tagHtml = `<span class="tag-uhd">${res.height >= 2160 ? '4K UHD' : '2K QHD'}</span>`;
      } else if (res.isHd) {
        tagHtml = `<span class="tag-hd">HD</span>`;
      }

      card.innerHTML = `
        <div class="card-top">
          <span class="resolution-badge">${res.label}</span>
          ${tagHtml}
        </div>
        <div class="card-middle">
          <span class="quality-name">${res.qualityName}</span>
          <span class="filesize-est">${res.filesizeFormatted}</span>
        </div>
        <div class="card-bottom">
          <span class="fps-pill">${res.fps} FPS • MP4</span>
          <div class="select-indicator">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.quality-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedResolution = res;
        updateSummary();
      });

      resolutionsGrid.appendChild(card);
    });

    updateSummary();
  }

  function renderAudioOptions(audioOptions) {
    audioGrid.innerHTML = '';

    if (!audioOptions || audioOptions.length === 0) {
      audioGrid.innerHTML = '<div style="color: var(--text-dim); padding: 12px;">No audio streams found.</div>';
      return;
    }

    selectedAudio = audioOptions[0];

    audioOptions.forEach((audio, idx) => {
      const card = document.createElement('div');
      card.className = `quality-card ${idx === 0 ? 'selected' : ''}`;
      card.id = `audio-${audio.key}`;

      card.innerHTML = `
        <div class="card-top">
          <span class="resolution-badge">${audio.ext.toUpperCase()}</span>
          <span class="tag-hd" style="background: linear-gradient(135deg, #10b981, #06b6d4);">AUDIO</span>
        </div>
        <div class="card-middle">
          <span class="quality-name">${audio.label}</span>
          <span class="filesize-est">${audio.filesizeFormatted}</span>
        </div>
        <div class="card-bottom">
          <span class="fps-pill">${audio.bitrate}</span>
          <div class="select-indicator">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('#audio-grid .quality-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedAudio = audio;
        updateSummary();
      });

      audioGrid.appendChild(card);
    });
  }

  // Tabs
  tabVideo.addEventListener('click', () => setMode('video'));
  tabAudio.addEventListener('click', () => setMode('audio'));

  function setMode(mode) {
    selectedMode = mode;
    if (mode === 'video') {
      tabVideo.classList.add('active');
      tabAudio.classList.remove('active');
      videoResolutionsGroup.style.display = 'block';
      audioOptionsGroup.style.display = 'none';
    } else {
      tabAudio.classList.add('active');
      tabVideo.classList.remove('active');
      videoResolutionsGroup.style.display = 'none';
      audioOptionsGroup.style.display = 'block';
    }
    updateSummary();
  }

  function updateSummary() {
    if (selectedMode === 'video' && selectedResolution) {
      selectedSpecText.textContent = `${selectedResolution.label} (${selectedResolution.qualityName}) • MP4`;
      btnDownloadText.textContent = `Download in ${selectedResolution.label}`;
    } else if (selectedMode === 'audio' && selectedAudio) {
      selectedSpecText.textContent = `${selectedAudio.label}`;
      btnDownloadText.textContent = `Download ${selectedAudio.ext.toUpperCase()}`;
    }
  }

  // Open in Player Page (HTML5 video with Right-Click & Save As)
  btnOpenPlayer.addEventListener('click', () => {
    if (!currentVideoUrl) return;

    const title = currentVideoData?.info?.title || 'video';
    const isAudio = selectedMode === 'audio';
    const height = selectedResolution ? selectedResolution.height : 1080;
    const format = isAudio ? (selectedAudio ? selectedAudio.ext : 'mp3') : 'mp4';
    const audioBitrate = selectedAudio ? selectedAudio.bitrate : '320k';

    const params = new URLSearchParams({
      url: currentVideoUrl,
      title: title,
      height: height,
      format: format,
      audioOnly: isAudio ? 'true' : 'false',
      audioBitrate: audioBitrate
    });

    window.open(`/player.html?${params.toString()}`, '_blank');
  });

  // Immediate Direct Stream Download to Device
  btnStartDownload.addEventListener('click', () => {
    if (!currentVideoUrl) return;

    const title = currentVideoData?.info?.title || 'video';
    const isAudio = selectedMode === 'audio';
    const height = selectedResolution ? selectedResolution.height : 1080;
    const format = isAudio ? (selectedAudio ? selectedAudio.ext : 'mp3') : 'mp4';
    const audioBitrate = selectedAudio ? selectedAudio.bitrate : '320k';

    const params = new URLSearchParams({
      url: currentVideoUrl,
      title: title,
      height: height,
      format: format,
      audioOnly: isAudio ? 'true' : 'false',
      audioBitrate: audioBitrate
    });

    const streamUrl = `/api/stream?${params.toString()}`;

    // 1. Immediately trigger the browser's native download dialog onto the device
    triggerDeviceDownload(streamUrl);

    // 2. Instantly update UI without making the user wait
    progressSection.style.display = 'block';
    progressTitle.textContent = '🚀 Downloading Directly to Your Device!';
    progressStepText.textContent = `Streaming "${title.substring(0, 45)}..." straight to your browser's Downloads folder!`;
    progressFill.style.width = '100%';
    progressPercentageLabel.textContent = 'Active';
    
    metricSpeed.textContent = 'Direct Stream';
    metricEta.textContent = 'In Browser';
    metricSize.textContent = isAudio ? (selectedAudio?.filesizeFormatted || '~6 MB') : (selectedResolution?.filesizeFormatted || 'Full Quality');
    metricStatus.textContent = 'Downloading';
    metricStatus.style.color = '#10b981';

    completedFilename.textContent = `${title}.${format}`;
    btnSaveFile.href = streamUrl;
    btnSaveFile.setAttribute('download', `${title}.${format}`);
    completedBox.style.display = 'flex';

    progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Server-Sent Events (SSE) Progress Tracker
  function listenToProgress(jobId) {
    if (currentEventSource) {
      currentEventSource.close();
    }

    currentEventSource = new EventSource(`/api/progress/${jobId}`);

    currentEventSource.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data);
        updateProgressUI(job);

        if (job.status === 'completed') {
          currentEventSource.close();
          currentEventSource = null;
          handleJobSuccess(job);
        } else if (job.status === 'error') {
          currentEventSource.close();
          currentEventSource = null;
          handleJobError(job);
        }
      } catch (err) {
        console.error('Failed to parse SSE progress:', err);
      }
    };

    currentEventSource.onerror = (err) => {
      console.warn('SSE disconnected or closed:', err);
    };
  }

  function updateProgressUI(job) {
    const pct = Math.min(100, Math.max(0, job.percent || 0));
    progressFill.style.width = `${pct}%`;
    progressPercentageLabel.textContent = `${Math.round(pct)}%`;

    if (job.step) {
      progressStepText.textContent = job.step;
    }

    if (job.speed) {
      metricSpeed.textContent = job.speed;
    }

    if (job.eta) {
      metricEta.textContent = job.eta;
    }

    if (job.totalBytes) {
      metricSize.textContent = job.totalBytes;
    }

    if (job.status === 'downloading') {
      metricStatus.textContent = 'Downloading';
      metricStatus.style.color = '#38bdf8';
    } else if (job.status === 'merging') {
      metricStatus.textContent = 'Merging (FFmpeg)';
      metricStatus.style.color = '#f59e0b';
    } else if (job.status === 'converting') {
      metricStatus.textContent = 'Converting (FFmpeg)';
      metricStatus.style.color = '#f59e0b';
    } else if (job.status === 'completed') {
      metricStatus.textContent = 'Complete';
      metricStatus.style.color = '#10b981';
    }
  }

  function triggerDeviceDownload(url) {
    // 1. Try invisible iframe navigation (works across desktop, android, ios without popup blocking)
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 60000);

    // 2. Also simulate anchor download as fallback
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 2000);
  }

  function handleJobSuccess(job) {
    btnStartDownload.disabled = false;
    btnStartDownload.style.opacity = '1';

    progressTitle.textContent = 'Processing Completed!';
    progressStepText.textContent = 'Your file is downloading to your device!';
    progressFill.style.width = '100%';
    progressPercentageLabel.textContent = '100%';

    completedFilename.textContent = job.fileName || 'Video file';
    const downloadUrl = `/api/file/${job.id}`;
    btnSaveFile.href = downloadUrl;
    btnSaveFile.setAttribute('download', job.fileName || 'video.mp4');

    completedBox.style.display = 'flex';

    // Auto-trigger direct download to device
    triggerDeviceDownload(downloadUrl);

    // Reload history list
    loadHistory();
  }

  function handleJobError(job) {
    btnStartDownload.disabled = false;
    btnStartDownload.style.opacity = '1';
    metricStatus.textContent = 'Error';
    metricStatus.style.color = '#ef4444';
    progressTitle.textContent = 'Download Failed';
    progressStepText.textContent = job.error || 'An error occurred during download.';
    showAlert(job.error || 'Download failed. Please try another resolution or video.');
  }

  // Load Download History
  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (!data.success || !data.history) return;

      if (data.history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No downloads yet in this folder. Videos you download will appear here.</div>';
        return;
      }

      historyList.innerHTML = '';
      data.history.forEach(item => {
        const row = document.createElement('div');
        row.className = 'history-item';
        row.innerHTML = `
          <div class="history-item-left">
            <div class="history-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
            </div>
            <div class="history-item-info">
              <div class="history-item-name" title="${item.fileName}">${item.fileName}</div>
              <div class="history-item-meta">${item.sizeFormatted} • ${item.dateFormatted}</div>
            </div>
          </div>
          <a href="${item.downloadUrl}" class="btn btn-secondary btn-sm" download="${item.fileName}" title="Save file to device">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Save</span>
          </a>
        `;
        historyList.appendChild(row);
      });
    } catch (err) {
      console.warn('Failed to load history:', err);
    }
  }

  // Open Downloads folder
  async function openDownloadsFolder() {
    try {
      await fetch('/api/open-folder', { method: 'POST' });
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }
});
