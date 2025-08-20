(() => {
  /**
   * GhostFeed - YouTube Distraction Removal Extension
   * 
   * Naming Convention:
   * - All data attributes use "data-ghostfeed-" prefix for consistency
   * - Speed controls use "ghostfeed-" prefix for CSS classes and IDs
   * - localStorage keys use "ghostfeed-" prefix
   * - Internal functions and variables use camelCase
   */
   
  const DEFAULT_SETTINGS = {
    masterEnabled: true,
    hideHome: true,
    hideShorts: true,
    hideComments: true,
    hideSidebar: true,
    hideEndscreen: true,
    hideRecs: true,
    hideGuide: false,
    blurThumbs: false,
    playbackRate: 1,
  };

  const BODY_FLAG_ATTRIBUTES = {
    hideHome: "data-ghostfeed-hide-home",
    hideShorts: "data-ghostfeed-hide-shorts",
    hideComments: "data-ghostfeed-hide-comments",
    hideSidebar: "data-ghostfeed-hide-sidebar",
    hideEndscreen: "data-ghostfeed-hide-endscreen",
    hideRecs: "data-ghostfeed-hide-recs",
    hideGuide: "data-ghostfeed-hide-guide",
    blurThumbs: "data-ghostfeed-blur-thumbs",
  };

  const SPEED_CONFIG = {
    buttonId: "ghostfeed-speed-button",
    menuId: "ghostfeed-speed-menu",
    stylesId: "ghostfeed-speed-styles",
    presetSpeeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4],
    customRange: { min: 0.1, max: 16 },
    gracePeriod: 5000,
    watcherInterval: 1000,
  };

  // State
  let currentSettings = { ...DEFAULT_SETTINGS };
  let playbackWatcherIntervalId = null;
  let lastUserInteractionTimestamp = 0;
  let hasUserOverriddenSpeed = false;
  let isSpeedControlsInjected = false;
  let contextInvalidationWarned = false;

  /**
   * Applies body flags for hiding/showing YouTube elements
   * @param {Object} settings - The current extension settings
   */
  function applyBodyFlags(settings) {
    const bodyElement = document.body;
    const isEnabled = !!settings.masterEnabled;
    
    // Set master enabled flag
    if (isEnabled) {
      bodyElement.setAttribute("data-ghostfeed-master-enabled", "true");
    } else {
      bodyElement.removeAttribute("data-ghostfeed-master-enabled");
    }
    
    for (const [settingKey, attributeName] of Object.entries(BODY_FLAG_ATTRIBUTES)) {
      if (!isEnabled) {
        bodyElement.removeAttribute(attributeName);
      } else {
        const shouldApply = !!settings[settingKey];
        if (shouldApply) {
          bodyElement.setAttribute(attributeName, "true");
        } else {
          bodyElement.removeAttribute(attributeName);
        }
      }
    }
    
    // Handle thumbnail blurring
    if (isEnabled && settings.blurThumbs) {
      applyThumbnailBlur();
    } else {
      removeThumbnailBlur();
    }
  }

  /**
   * Applies blur effect to thumbnails using JavaScript for better compatibility
   */
  function applyThumbnailBlur() {
    const thumbnailSelectors = [
      'img.yt-core-image',
      'yt-image img',
      'ytd-thumbnail img',
      'yt-img-shadow img',
      'ytd-moving-thumbnail-renderer img',
      'ytd-playlist-thumbnail img',
      'ytd-video-preview img',
      'ytd-rich-grid-media img',
      '.ytd-thumbnail img'
    ];
    
    thumbnailSelectors.forEach(selector => {
      const images = document.querySelectorAll(selector);
      images.forEach(img => {
        if (!img.hasAttribute('data-ghostfeed-blurred')) {
          img.style.filter = 'blur(12px) saturate(0.6)';
          img.style.transition = 'filter 0.2s ease';
          img.setAttribute('data-ghostfeed-blurred', 'true');
          
          // Add hover effect
          const parent = img.closest('ytd-thumbnail, yt-image, yt-img-shadow, ytd-moving-thumbnail-renderer, ytd-playlist-thumbnail, ytd-video-preview, ytd-rich-grid-media, .ytd-thumbnail');
          if (parent && !parent.hasAttribute('data-ghostfeed-hover-added')) {
            parent.addEventListener('mouseenter', () => {
              img.style.filter = 'none';
            });
            parent.addEventListener('mouseleave', () => {
              if (currentSettings.masterEnabled && currentSettings.blurThumbs) {
                img.style.filter = 'blur(12px) saturate(0.6)';
              }
            });
            parent.setAttribute('data-ghostfeed-hover-added', 'true');
          }
        }
      });
    });
  }

  /**
   * Removes blur effect from all thumbnails
   */
  function removeThumbnailBlur() {
    const blurredImages = document.querySelectorAll('img[data-ghostfeed-blurred]');
    blurredImages.forEach(img => {
      img.style.filter = '';
      img.removeAttribute('data-ghostfeed-blurred');
    });
    
    // Remove hover event markers
    const hoveredParents = document.querySelectorAll('[data-ghostfeed-hover-added]');
    hoveredParents.forEach(parent => {
      parent.removeAttribute('data-ghostfeed-hover-added');
    });
  }

  /**
   * Checks if Chrome storage is available and working
   * @returns {boolean} True if Chrome storage is available
   */
  function isChromeStorageAvailable() {
    try {
      const hasChrome = typeof chrome !== 'undefined';
      const hasStorage = hasChrome && chrome.storage;
      const hasSync = hasStorage && chrome.storage.sync;
      const hasRuntime = hasChrome && chrome.runtime;
      const hasRuntimeId = hasRuntime && chrome.runtime.id;

      if (!hasChrome) {
        console.debug('GhostFeed: Chrome object not available');
        return false;
      }
      if (!hasStorage) {
        console.debug('GhostFeed: Chrome storage not available');
        return false;
      }
      if (!hasSync) {
        console.debug('GhostFeed: Chrome storage.sync not available');
        return false;
      }
      if (!hasRuntime) {
        console.debug('GhostFeed: Chrome runtime not available');
        return false;
      }
      if (!hasRuntimeId) {
        console.debug('GhostFeed: Chrome runtime.id not available - extension context may be invalidated');
        return false;
      }

      return true;
    } catch (error) {
      console.debug('GhostFeed: Error checking chrome storage availability:', error);
      return false;
    }
  }

  /**
   * Loads settings from Chrome storage
   * @returns {Promise<Object>} The loaded settings
   */
  function loadSettingsFromStorage() {
    return new Promise((resolve) => {
      try {
        if (isChromeStorageAvailable()) {
          chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
            // Check if chrome.runtime.lastError indicates context invalidation
            if (chrome.runtime.lastError) {
              console.warn('GhostFeed: Chrome storage error, trying localStorage fallback:', chrome.runtime.lastError);
              const fallbackSettings = loadFromLocalStorageFallback();
              resolve(fallbackSettings);
              return;
            }
            
            const settings = result || DEFAULT_SETTINGS;
            // Save to localStorage as backup for future fallbacks
            saveToLocalStorageBackup(settings);
            resolve(settings);
          });
        } else {
          console.warn('GhostFeed: Chrome storage API not available, using localStorage fallback');
          const fallbackSettings = loadFromLocalStorageFallback();
          resolve(fallbackSettings);
        }
      } catch (error) {
        console.warn('GhostFeed: Failed to load settings from chrome storage, using localStorage fallback:', error);
        const fallbackSettings = loadFromLocalStorageFallback();
        resolve(fallbackSettings);
      }
    });
  }

  /**
   * Loads settings from localStorage as fallback
   * @returns {Object} The loaded settings or defaults
   */
  function loadFromLocalStorageFallback() {
    try {
      const fallbackSettings = { ...DEFAULT_SETTINGS };
      
      // Load each setting from localStorage if available
      Object.keys(DEFAULT_SETTINGS).forEach(key => {
        const stored = localStorage.getItem(`ghostfeed-${key}`);
        if (stored !== null) {
          if (key === 'playbackRate') {
            const rate = parseFloat(stored);
            if (!isNaN(rate) && rate > 0) {
              fallbackSettings[key] = rate;
            }
          } else {
            fallbackSettings[key] = stored === 'true';
          }
        }
      });
      
      console.log('GhostFeed: Loaded settings from localStorage fallback:', fallbackSettings);
      return fallbackSettings;
    } catch (error) {
      console.warn('GhostFeed: Failed to load from localStorage fallback:', error);
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Saves settings to localStorage as backup/fallback
   * @param {Object} settings - Settings to save
   */
  function saveToLocalStorageBackup(settings) {
    try {
      Object.keys(settings).forEach(key => {
        if (settings[key] !== undefined) {
          localStorage.setItem(`ghostfeed-${key}`, settings[key].toString());
        }
      });
    } catch (error) {
      console.warn('GhostFeed: Failed to save to localStorage backup:', error);
    }
  }

  /**
   * Checks if the extension context is still valid
   * @returns {boolean} True if context is valid, false otherwise
   */
  function isExtensionContextValid() {
    return isChromeStorageAvailable();
  }

  /**
   * Applies settings immediately
   * @param {Object} settings - Settings to apply
   */
  function applySettingsImmediately(settings) {
    applyBodyFlags(settings);
    
    // Only apply functionality if master toggle is enabled
    if (!settings.masterEnabled) {
      // Reset all videos to normal speed when disabled
      document.querySelectorAll("video").forEach((video) => {
        video.playbackRate = 1;
      });
      return;
    }
    
    // For playback rate, only apply if there's a video and we have a specific rate set
    // Don't override the current video playback rate on first load
    const videoElement = document.querySelector('video');
    if (videoElement && settings.playbackRate && settings.playbackRate !== 1) {
      videoElement.playbackRate = settings.playbackRate;
    } else if (videoElement) {
      // Update our settings to match the current video speed
      currentSettings.playbackRate = videoElement.playbackRate;
    }
  }  /**
   * Applies playback rate to all video elements
   */
  function applyPlaybackRateToVideos(playbackRate) {
    if (!currentSettings.masterEnabled) return;
    
    document.querySelectorAll("video").forEach((videoElement) => {
      if (typeof videoElement.playbackRate !== "number") return;

      const timeSinceUserAction = Date.now() - lastUserInteractionTimestamp;
      if (hasUserOverriddenSpeed && timeSinceUserAction < SPEED_CONFIG.gracePeriod) {
        return;
      }
      
      const clampedRate = Math.max(0.0625, Math.min(16, playbackRate));
      
      if (Math.abs(videoElement.playbackRate - clampedRate) > 0.01) {
        videoElement.playbackRate = clampedRate;
        hasUserOverriddenSpeed = false;
      }
    });
  }

  /**
   * Starts the playback rate watcher
   */
  function startPlaybackRateWatcher() {
    if (playbackWatcherIntervalId) {
      clearInterval(playbackWatcherIntervalId);
    }

    if (!currentSettings.masterEnabled) return;

    playbackWatcherIntervalId = setInterval(() => {
      const targetRate = currentSettings.playbackRate || 1;
      applyPlaybackRateToVideos(targetRate);
    }, SPEED_CONFIG.watcherInterval);
  }

  /**
   * Sets up SPA navigation hooks
   */
  function setupSpaNavigationHooks() {
    const reapplySettings = () => applySettingsImmediately(currentSettings);
    document.addEventListener("yt-navigate-finish", reapplySettings);
    document.addEventListener("yt-page-data-updated", reapplySettings);
  }

  function hookSpaEvents() {
    // Re-apply on YouTube SPA navigations
    const reapply = () => applyNow(currentSettings);
    document.addEventListener("yt-navigate-finish", reapply);
    document.addEventListener("yt-page-data-updated", reapply);
  }

  /**
   * Creates and starts the video mutation observer for detecting new videos
   */
  function createVideoMutationObserver() {
    const videoObserver = new MutationObserver((mutations) => {
      let hasNewVideo = false;
      let hasNewThumbnails = false;
      
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes || []) {
          if (addedNode.nodeType === 1) {
            // Check for new videos
            if (addedNode.tagName === "VIDEO" || 
               (addedNode.querySelector && addedNode.querySelector("video"))) {
              hasNewVideo = true;
            }
            
            // Check for new thumbnails
            if (addedNode.tagName === "IMG" ||
                (addedNode.querySelector && addedNode.querySelector("img")) ||
                addedNode.tagName === "YTD-THUMBNAIL" ||
                addedNode.tagName === "YT-IMAGE" ||
                addedNode.tagName === "YT-IMG-SHADOW") {
              hasNewThumbnails = true;
            }
          }
        }
        if (hasNewVideo && hasNewThumbnails) break;
      }
      
      if (hasNewVideo) {
        handleNewVideoDetected();
      }
      
      if (hasNewThumbnails && currentSettings.masterEnabled && currentSettings.blurThumbs) {
        // Delay to ensure DOM is ready
        setTimeout(() => {
          applyThumbnailBlur();
        }, 100);
      }
    });

    return videoObserver;
  }

  /**
   * Handles when a new video is detected
   */
  function handleNewVideoDetected() {
    // Reset user override flags for new videos
    hasUserOverriddenSpeed = false;
    lastUserInteractionTimestamp = 0;
    
    // Apply current settings to the new video
    applyPlaybackRateToVideos(currentSettings.playbackRate || 1);
    
    // Re-inject speed controls for new video player
    if (currentSettings.masterEnabled) {
      setTimeout(() => {
        injectSpeedControls();
      }, 1000);
    }
  }

  /**
   * Starts the video mutation observer
   */
  function startVideoObserver() {
    const observer = createVideoMutationObserver();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
    });
  }

  /**
   * Creates and injects the speed control styles
   */
  function injectSpeedControlStyles() {
    if (document.getElementById(SPEED_CONFIG.stylesId)) return;
    
    const styles = `
      <style id="${SPEED_CONFIG.stylesId}">
        /* Speed Button - Use important to override YouTube's styles */
        .ytp-right-controls .${SPEED_CONFIG.buttonId} {
          display: inline-block !important;
          width: 48px !important;
          height: 48px !important;
          padding: 0 !important;
          margin: 0 !important;
          background: transparent !important;
          border: none !important;
          color: white !important;
          font-family: "YouTube Sans", "Roboto", sans-serif !important;
          font-size: 14px !important;
          font-weight: 400 !important;
          cursor: pointer !important;
          border-radius: 0 !important;
          transition: background-color 0.1s ease !important;
          position: relative !important;
          opacity: 0.9 !important;
          vertical-align: top !important;
          line-height: 48px !important;
          text-align: center !important;
          box-sizing: border-box !important;
          outline: none !important;
          min-width: 48px !important;
          max-width: 48px !important;
        }
        
        .ytp-right-controls .${SPEED_CONFIG.buttonId}:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          opacity: 1 !important;
        }
        
        .${SPEED_CONFIG.buttonId}:active {
          background: rgba(255, 255, 255, 0.2);
        }
        
        /* Speed Menu */
        .${SPEED_CONFIG.menuId} {
          position: fixed;
          background: rgba(28, 28, 28, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 8px;
          padding: 8px;
          min-width: 160px;
          max-width: 200px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          z-index: 99999;
          font-family: "YouTube Sans", "Roboto", sans-serif;
          color: white;
          display: none;
          flex-direction: column;
          gap: 2px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transform: translateY(4px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          opacity: 0;
        }
        
        .${SPEED_CONFIG.menuId}.visible {
          opacity: 1;
          transform: translateY(0);
        }
        
        .ghostfeed-speed-item {
          padding: 8px 12px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 14px;
          transition: background-color 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: space-between;
          user-select: none;
        }
        
        .ghostfeed-speed-item:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        
        .ghostfeed-speed-item.active {
          background: rgba(62, 166, 255, 0.2);
          color: #3ea6ff;
        }
        
        .ghostfeed-speed-item.active::after {
          content: "✓";
          color: #3ea6ff;
          font-weight: bold;
        }
        
        .ghostfeed-custom-speed {
          padding: 8px 12px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          font-size: 14px;
          width: 100%;
          box-sizing: border-box;
          margin-top: 4px;
          outline: none;
          text-align: center;
        }
        
        .ghostfeed-custom-speed:focus {
          border-color: #3ea6ff;
          box-shadow: 0 0 0 2px rgba(62, 166, 255, 0.2);
        }
        
        .ghostfeed-custom-speed::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }
        
        .ghostfeed-custom-label {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
          margin-top: 4px;
          margin-bottom: 2px;
          padding: 0 4px;
        }
      </style>
    `;
    
    document.head.insertAdjacentHTML('beforeend', styles);
  }
  /**
   * Creates the speed button for YouTube's control bar
   */
  function createSpeedButton() {
    const videoElement = document.querySelector('video');
    if (!videoElement) return null;
    
    const currentSpeed = videoElement.playbackRate || 1;
    let displaySpeed;
    if (currentSpeed === 1) {
      displaySpeed = '1×';
    } else if (currentSpeed < 1) {
      displaySpeed = currentSpeed + '×';
    } else if (currentSpeed % 1 === 0) {
      displaySpeed = currentSpeed + '×';
    } else {
      displaySpeed = currentSpeed.toFixed(2).replace(/\.?0+$/, '') + '×';
    }
    
    const button = document.createElement('button');
    button.className = SPEED_CONFIG.buttonId;
    button.textContent = displaySpeed;
    button.title = 'Playback Speed (Enhanced)';
    button.setAttribute('aria-label', 'Playback Speed');
    
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      showSpeedMenu(button);
    });
    
    return button;
  }

  /**
   * Creates the speed menu HTML
   */
  function createSpeedMenu() {
    if (document.getElementById(SPEED_CONFIG.menuId)) return;
    
    const speedItems = SPEED_CONFIG.presetSpeeds.map(speed => {
      const displayText = speed === 1 ? 'Normal' : speed.toString();
      return `<div class="ghostfeed-speed-item" data-speed="${speed}">${displayText}</div>`;
    }).join('');
    
    const menuHTML = `
      <div class="${SPEED_CONFIG.menuId}" id="${SPEED_CONFIG.menuId}">
        ${speedItems}
        <div class="ghostfeed-custom-label">Custom (${SPEED_CONFIG.customRange.min}-${SPEED_CONFIG.customRange.max}×):</div>
        <input type="number" class="ghostfeed-custom-speed" 
               min="${SPEED_CONFIG.customRange.min}" 
               max="${SPEED_CONFIG.customRange.max}" 
               step="0.1" 
               placeholder="e.g. 0.1, 1.7, 8.5">&nbsp;
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', menuHTML);
    setupSpeedMenuEvents();
  }

  /**
   * Injects the speed button into YouTube's control bar
   */
  function injectSpeedButton() {
    const controlsRight = document.querySelector('.ytp-right-controls');
    if (!controlsRight || document.querySelector(`.${SPEED_CONFIG.buttonId}`)) return;
    
    const speedButton = createSpeedButton();
    if (!speedButton) return;
    
    // Insert before the settings button
    const settingsButton = controlsRight.querySelector('.ytp-settings-button');
    if (settingsButton) {
      controlsRight.insertBefore(speedButton, settingsButton);
    } else {
      controlsRight.appendChild(speedButton);
    }
  }
  
  /**
   * Sets up event listeners for the speed menu
   */
  function setupSpeedMenuEvents() {
    const speedMenu = document.getElementById(SPEED_CONFIG.menuId);
    if (!speedMenu) return;

    const customInput = speedMenu.querySelector('.ghostfeed-custom-speed');
    const speedItems = speedMenu.querySelectorAll('.ghostfeed-speed-item');
    
    // Handle preset speed clicks
    speedItems.forEach(item => {
      item.addEventListener('click', (event) => {
        try {
          event.stopPropagation();
          const speed = parseFloat(item.dataset.speed);
          if (isNaN(speed)) {
            console.warn('GhostFeed: Invalid speed data:', item.dataset.speed);
            return;
          }
          
          // Check if video element exists before trying to set speed
          const videoElement = document.querySelector('video');
          if (!videoElement) {
            console.warn('GhostFeed: No video element found, skipping speed change');
            return;
          }
          
          setVideoSpeed(speed);
        } catch (error) {
          console.error('GhostFeed: Error in speed item click handler:', error);
        }
      });
    });
    
    // Handle custom input
    if (customInput) {
      customInput.addEventListener('input', (event) => {
        try {
          // Real-time validation feedback
          const speed = parseFloat(customInput.value);
          if (!isNaN(speed) && speed >= SPEED_CONFIG.customRange.min && speed <= SPEED_CONFIG.customRange.max) {
            customInput.style.borderColor = 'rgba(62, 166, 255, 0.6)';
          } else {
            customInput.style.borderColor = 'rgba(255, 100, 100, 0.6)';
          }
        } catch (error) {
          console.error('GhostFeed: Error in custom input handler:', error);
        }
      });
      
      customInput.addEventListener('change', (event) => {
        try {
          event.stopPropagation();
          const speed = parseFloat(customInput.value);
          console.log('GhostFeed: Custom input change:', speed); // Debug log
          if (!isNaN(speed) && speed >= SPEED_CONFIG.customRange.min && speed <= SPEED_CONFIG.customRange.max) {
            // Check if video element exists before trying to set speed
            const videoElement = document.querySelector('video');
            if (!videoElement) {
              console.warn('GhostFeed: No video element found, skipping speed change');
              return;
            }
            
            setVideoSpeed(speed);
            customInput.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          } else {
            // Invalid input - reset to current speed
            const currentVideo = document.querySelector('video');
            if (currentVideo) {
              customInput.value = currentVideo.playbackRate;
            }
            customInput.style.borderColor = 'rgba(255, 100, 100, 0.6)';
          }
        } catch (error) {
          console.error('GhostFeed: Error in custom input change handler:', error);
        }
      });
    }
    
    customInput.addEventListener('keydown', (event) => {
      try {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          const speed = parseFloat(customInput.value);
          if (!isNaN(speed) && speed >= SPEED_CONFIG.customRange.min && speed <= SPEED_CONFIG.customRange.max) {
            // Check if video element exists before trying to set speed
            const videoElement = document.querySelector('video');
            if (!videoElement) {
              console.warn('GhostFeed: No video element found, skipping speed change');
              return;
            }
            
            setVideoSpeed(speed);
          }
        }
      } catch (error) {
        console.error('GhostFeed: Error in custom input keydown handler:', error);
      }
    });
    
    // Close menu on outside click (only add once)
    if (!document.documentElement.hasAttribute('data-ghostfeed-outside-click-setup')) {
      document.addEventListener('click', (event) => {
        const speedMenu = document.getElementById(SPEED_CONFIG.menuId);
        const speedButton = document.querySelector(`.${SPEED_CONFIG.buttonId}`);
        
        if (speedMenu && speedMenu.style.display !== 'none' && 
            !speedMenu.contains(event.target) && !speedButton?.contains(event.target)) {
          hideSpeedMenu();
        }
      });
      document.documentElement.setAttribute('data-ghostfeed-outside-click-setup', 'true');
    }
  }
  
  /**
   * Updates the speed display in the button
   */
  function updateSpeedDisplay(speed) {
    const button = document.querySelector(`.${SPEED_CONFIG.buttonId}`);
    const speedMenu = document.getElementById(SPEED_CONFIG.menuId);
    
    if (button) {
      let speedText;
      if (speed === 1) {
        speedText = '1×';
      } else if (speed < 1) {
        speedText = speed + '×';
      } else if (speed % 1 === 0) {
        speedText = speed + '×';
      } else {
        speedText = speed.toFixed(2).replace(/\.?0+$/, '') + '×';
      }
      button.textContent = speedText;
    }
    
    if (speedMenu && speedMenu.style.display !== 'none') {
      // Update menu item states
      const speedItems = speedMenu.querySelectorAll('.ghostfeed-speed-item');
      speedItems.forEach(item => {
        const itemSpeed = parseFloat(item.dataset.speed);
        item.classList.toggle('active', Math.abs(itemSpeed - speed) < 0.01);
      });
      
      // Update custom input
      const customInput = speedMenu.querySelector('.ghostfeed-custom-speed');
      if (customInput) {
        const isPreset = SPEED_CONFIG.presetSpeeds.some(preset => Math.abs(preset - speed) < 0.01);
        customInput.value = isPreset ? '' : speed;
        // Always show the custom input field, just empty it for presets
      }
    }
  }

  /**
   * Sets the video playback speed and saves to storage
   */
  function setVideoSpeed(speed) {
    try {
      // Check if extension context is still valid
      if (!isExtensionContextValid() && !contextInvalidationWarned) {
        console.warn('GhostFeed: Extension context invalidated, continuing with local operations only');
        contextInvalidationWarned = true;
      }
      
      const videoElement = document.querySelector('video');
      if (!videoElement) {
        console.warn('GhostFeed: Video element not found');
        return;
      }

      // Validate speed value
      if (typeof speed !== 'number' || isNaN(speed) || speed <= 0) {
        console.warn('GhostFeed: Invalid speed value:', speed);
        return;
      }

      // Mark user interaction
      lastUserInteractionTimestamp = Date.now();
      hasUserOverriddenSpeed = true;

      videoElement.playbackRate = speed;
      currentSettings.playbackRate = speed;
      
      // Try to save to storage with better error handling
      const contextValid = isChromeStorageAvailable();
      
      if (contextValid) {
        try {
          chrome.storage.sync.set({ playbackRate: speed }, () => {
            if (chrome.runtime.lastError) {
              // Fall back to localStorage if Chrome storage fails
              try {
                localStorage.setItem('ghostfeed-playbackRate', speed.toString());
              } catch (fallbackError) {
                console.warn('GhostFeed: Both storage methods failed:', fallbackError);
              }
            }
          });
        } catch (error) {
          // Fall back to localStorage if Chrome storage API fails
          try {
            localStorage.setItem('ghostfeed-playbackRate', speed.toString());
          } catch (fallbackError) {
            console.warn('GhostFeed: All storage methods failed:', fallbackError);
          }
        }
      } else {
        // Extension context is invalid, use localStorage directly
        try {
          localStorage.setItem('ghostfeed-playbackRate', speed.toString());
        } catch (error) {
          console.warn('GhostFeed: localStorage fallback failed:', error);
        }
      }
      
      updateSpeedDisplay(speed);
      
      // Hide menu after selection with a small delay for better UX
      setTimeout(() => {
        try {
          hideSpeedMenu();
        } catch (hideError) {
          console.warn('GhostFeed: Error hiding speed menu:', hideError);
        }
      }, 150);
    } catch (error) {
      console.error('GhostFeed: Error in setVideoSpeed:', error);
    }
  }
  
  /**
   * Shows the speed menu positioned near the button
   */
  function showSpeedMenu(buttonElement) {
    const speedMenu = document.getElementById(SPEED_CONFIG.menuId);
    const videoElement = document.querySelector('video');
    
    if (!speedMenu || !videoElement) return;
    
    // Make menu visible temporarily to get its dimensions
    speedMenu.style.display = 'flex';
    speedMenu.style.visibility = 'hidden';
    speedMenu.style.opacity = '0';
    
    // Calculate position after a frame to ensure dimensions are accurate
    requestAnimationFrame(() => {
      const buttonRect = buttonElement.getBoundingClientRect();
      const menuRect = speedMenu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 12;
      
      // Center horizontally relative to button
      let left = buttonRect.left + (buttonRect.width / 2) - (menuRect.width / 2);
      
      // Ensure menu stays within horizontal viewport bounds
      if (left < margin) {
        left = margin;
      } else if (left + menuRect.width > viewportWidth - margin) {
        left = viewportWidth - menuRect.width - margin;
      }
      
      // Position above the button by default
      let top = buttonRect.top - menuRect.height - margin;
      
      // If no space above, position below
      if (top < margin) {
        top = buttonRect.bottom + margin;
        
        // If still goes off bottom, clamp to screen
        if (top + menuRect.height > viewportHeight - margin) {
          top = viewportHeight - menuRect.height - margin;
        }
      }
      
      speedMenu.style.left = left + 'px';
      speedMenu.style.top = top + 'px';
      speedMenu.style.visibility = 'visible';
      speedMenu.style.opacity = '1';
      
      // Trigger smooth animation
      setTimeout(() => {
        speedMenu.classList.add('visible');
      }, 10);
      
      updateSpeedDisplay(videoElement.playbackRate);
    });
  }

  /**
   * Hides the speed menu
   */
  function hideSpeedMenu() {
    const speedMenu = document.getElementById(SPEED_CONFIG.menuId);
    if (speedMenu) {
      speedMenu.classList.remove('visible');
      setTimeout(() => {
        speedMenu.style.display = 'none';
      }, 200); // Match the transition duration
    }
  }

  /**
   * Injects all speed controls (button + menu)
   */
  function injectSpeedControls() {
    if (isSpeedControlsInjected) return;
    
    injectSpeedControlStyles();
    createSpeedMenu();
    
    // Try to inject button, retry if controls not ready
    const tryInjectButton = () => {
      injectSpeedButton();
      if (!document.querySelector(`.${SPEED_CONFIG.buttonId}`)) {
        setTimeout(tryInjectButton, 1000);
      }
    };
    
    tryInjectButton();
    isSpeedControlsInjected = true;
  }
  
  /**
   * Cleanup function to remove event listeners and DOM elements
   */
  function cleanupSpeedControls() {
    // Remove injected styles
    const styles = document.getElementById(SPEED_CONFIG.stylesId);
    if (styles) styles.remove();
    
    // Remove speed menu
    const speedMenu = document.getElementById(SPEED_CONFIG.menuId);
    if (speedMenu) speedMenu.remove();
    
    // Remove speed button
    const speedButton = document.querySelector(`.${SPEED_CONFIG.buttonId}`);
    if (speedButton) speedButton.remove();
    
    isSpeedControlsInjected = false;
  }  /**
   * Modifies only the speed menu item without breaking other items
   */
  function modifySpeedMenuItem() {
    const speedMenuItem = Array.from(document.querySelectorAll('.ytp-menuitem')).find(item => {
      const label = item.querySelector('.ytp-menuitem-label');
      return label && label.textContent.trim() === 'Playback speed';
    });
    
    if (speedMenuItem && !speedMenuItem.hasAttribute('data-unhooker-modified')) {
      speedMenuItem.setAttribute('data-unhooker-modified', 'true');
      
      // Add visual indicator that this item has enhanced functionality
      const label = speedMenuItem.querySelector('.ytp-menuitem-label');
      if (label) {
        label.title = 'Enhanced with speeds up to 16×';
      }
    }
  }

  /**
   * Checks if a menu item is related to playback speed
   * @param {string} labelText - The menu item's label text
   * @returns {boolean} Whether this is a playback speed menu item
   */
  function isPlaybackSpeedMenuItem(labelText) {
    // Only match the main "Playback speed" item, not individual speed values
    return labelText === 'Playback speed' || labelText.includes('Playback speed');
  }

  /**
   * Removes the custom speed menu and its styles
   */
  /**
   * Handles changes in Chrome storage
   * @param {Object} changes - The storage changes
   * @param {string} area - The storage area that changed
   */
  function handleStorageChanges(changes, area) {
    if (area !== "sync") return;
    
    loadSettingsFromStorage().then((newSettings) => {
      const wasEnabled = currentSettings.masterEnabled;
      const wasBlurEnabled = currentSettings.blurThumbs;
      currentSettings = newSettings;
      
      // If user recently changed speed manually, don't override immediately
      const timeSinceUserAction = Date.now() - lastUserInteractionTimestamp;
      if (hasUserOverriddenSpeed && timeSinceUserAction < 3000) { // 3 seconds grace period
        // Update settings but don't apply speed immediately
        applyBodyFlags(currentSettings);
      } else {
        applySettingsImmediately(currentSettings);
      }
      
      startPlaybackRateWatcher();

      // Handle speed controls injection/removal based on master toggle
      if (currentSettings.masterEnabled && !wasEnabled) {
        injectSpeedControls();
      } else if (!currentSettings.masterEnabled && wasEnabled) {
        cleanupSpeedControls();
      }

      // Handle thumbnail blur changes specifically
      if (currentSettings.blurThumbs !== wasBlurEnabled) {
        if (currentSettings.masterEnabled && currentSettings.blurThumbs) {
          setTimeout(() => applyThumbnailBlur(), 100);
        } else {
          removeThumbnailBlur();
        }
      }

      // Only reset to 1x if master was ON and is now OFF
      if (wasEnabled && !currentSettings.masterEnabled) {
        document.querySelectorAll("video").forEach((video) => {
          video.playbackRate = 1;
        });
      }
    });
  }

  /**
   * Initializes the extension with retry mechanism
   */
  async function initializeExtension() {
    try {
      console.log('GhostFeed: Initializing extension...');
      currentSettings = await loadSettingsFromStorage();
      
      applySettingsImmediately(currentSettings);
      startPlaybackRateWatcher();
      setupSpaNavigationHooks();
      startVideoObserver();
      
      // Only inject speed controls if master is enabled
      if (currentSettings.masterEnabled) {
        injectSpeedControls();
      }

      // Set up storage change listener only if chrome storage is available
      if (isChromeStorageAvailable()) {
        chrome.storage.onChanged.addListener(handleStorageChanges);
        console.log('GhostFeed: Extension initialized successfully with Chrome storage');
      } else {
        console.warn('GhostFeed: Chrome storage not available, storage change listener not set up');
        console.log('GhostFeed: Extension initialized successfully with localStorage fallback');
      }
      
    } catch (error) {
      console.error('GhostFeed: Failed to initialize extension:', error);
    }
  }

  /**
   * Initializes extension with retry for chrome storage availability
   */
  function initializeWithRetry() {
    // Try immediate initialization
    if (isChromeStorageAvailable()) {
      initializeExtension();
      return;
    }

    // If chrome storage is not available, wait a bit and try again
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 100; // ms

    const tryInit = () => {
      if (isChromeStorageAvailable() || retryCount >= maxRetries) {
        initializeExtension();
        return;
      }
      
      retryCount++;
      console.log(`GhostFeed: Chrome storage not ready, retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})`);
      setTimeout(tryInit, retryDelay);
    };

    tryInit();
  }

  /**
   * Starts the extension when DOM is ready
   */
  function startExtension() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeWithRetry, { once: true });
    } else {
      initializeWithRetry();
    }
  }

  // Start the extension
  startExtension();
})();
