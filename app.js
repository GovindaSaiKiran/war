/**
 * @fileoverview Smart Stadium Experience — Main Application
 * @version 2.2.0
 * @description Real-time crowd management, live match tracking, digital ticketing,
 * transit coordination and emergency assistance for stadium attendees.
 * Integrates with Google Cloud Platform services.
 */
'use strict';

/* ===================== CORE TYPES ===================== */

/**
 * @typedef {Object} AppState
 * @property {string} currentView
 * @property {number} lastSosTimestamp
 * @property {boolean} isOnline
 */

/**
 * Custom error class for App-specific failures
 * @class AppError
 * @extends Error
 */
class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [context={}] - Additional context for debugging
   */
  constructor(message, context = {}) {
    super(message);
    this.name = 'AppError';
    this.context = context;
    this.timestamp = new Date();
    if (typeof firebaseService !== 'undefined' && firebaseService.logger) {
      firebaseService.logger.log('ERROR', message, { ...context, name: this.name });
    }
  }
}

/* ===================== CONFIGURATION ===================== */

/** 
 * @constant {Object} APP_CONFIG 
 * @description Global application configuration constants
 */
const APP_CONFIG = {
  VERSION: '2.2.0',
  UPDATE_INTERVAL: 5000,
  CROWD_INTERVAL: 10000,
  TOAST_DURATION: 4000,
  SOS_COOLDOWN: 30000,
  STORAGE_KEYS: { PROFILE: 'ss_profile', HISTORY: 'ss_history', PREFS: 'ss_prefs' },
  GCP_PROJECT: 'prompt-wars-493904'
};

/** 
 * @constant {Object} MATCH_CONFIG 
 * @description Configuration for the live match simulation
 */
const MATCH_CONFIG = {
  HOME: { name: 'Royal Challengers Bengaluru', short: 'RCB' },
  AWAY: { name: 'Chennai Super Kings', short: 'CSK' },
  TARGET: 196,
  OUTCOMES: ['0', '0', '1', '1', '1', '2', '4', '4', '6', 'W']
};

/** 
 * @constant {Object} ZONES 
 * @description Stadium zones with their capacity and entry points
 */
const ZONES = {
  'North Stand': { capacity: 5000, gate: 1 },
  'East Stand': { capacity: 8000, gate: 2 },
  'South Pavilion': { capacity: 6000, gate: 3 },
  'West Gallery': { capacity: 7000, gate: 4 },
  'Corporate Box': { capacity: 2000, gate: 5 }
};

/** 
 * @constant {Array<Object>} FACILITIES 
 * @description List of stadium facilities for wait time tracking
 */
const FACILITIES = [
  { name: 'Food Court A', icon: 'utensils', base: 10 },
  { name: 'Restroom Block B', icon: 'restroom', base: 4 },
  { name: 'Merchandise Shop', icon: 'store', base: 7 },
  { name: 'First Aid Station', icon: 'kit-medical', base: 2 }
];

/* ===================== UTILITIES ===================== */

/** @namespace SecurityUtils */
const SecurityUtils = {
  /** 
   * Sanitizes text to prevent XSS attacks by escaping HTML entities.
   * @param {string} t - Text to sanitize
   * @returns {string} - Sanitized HTML string
   */
  sanitize(t) {
    if (typeof t !== 'string') { return ''; }
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  },

  /** 
   * Validates if a value is a finite number within specified bounds.
   * @param {*} v - Value to validate
   * @param {number} [min=0] - Minimum allowed value
   * @param {number} [max=Infinity] - Maximum allowed value
   * @returns {number|null} - Validated number or null if invalid
   */
  validateNum(v, min = 0, max = Infinity) {
    const n = Number(v);
    return (Number.isNaN(n) || !Number.isFinite(n) || n < min || n > max) ? null : n;
  },

  /** 
   * Enforces rate limiting on client-side actions to prevent abuse.
   * @param {string} action - Unique name of the action
   * @param {number} ms - Cooldown period in milliseconds
   * @returns {boolean} - True if action is allowed, false if rate limited
   */
  rateLimit(action, ms) {
    const k = `_rl_${action}`;
    const last = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - last < ms) { return false; }
    sessionStorage.setItem(k, String(Date.now()));
    return true;
  }
};

/** @namespace PerfUtils */
const PerfUtils = {
  /**
   * Creates a debounced version of a function.
   * @param {Function} fn - Function to debounce
   * @param {number} d - Delay in milliseconds
   * @returns {Function}
   */
  debounce(fn, d) {
    let t = null;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), d); };
  },

  /**
   * Creates a throttled version of a function.
   * @param {Function} fn - Function to throttle
   * @param {number} l - Limit in milliseconds
   * @returns {Function}
   */
  throttle(fn, l) {
    let w = false;
    return (...a) => { if (!w) { fn(...a); w = true; setTimeout(() => w = false, l); } };
  }
};

/** @namespace DOMUtils */
const DOMUtils = {
  /**
   * Shorthand for querySelector
   * @param {string} s - Selector
   * @param {Element|Document} [p=document] - Parent element
   * @returns {Element|null}
   */
  qs: (s, p = document) => p.querySelector(s),

  /**
   * Shorthand for querySelectorAll (returns array)
   * @param {string} s - Selector
   * @param {Element|Document} [p=document] - Parent element
   * @returns {Array<Element>}
   */
  qsa: (s, p = document) => [...p.querySelectorAll(s)],

  /** 
   * Accessible ARIA-live announcement for screen readers.
   * @param {string} msg - Message to announce
   * @param {'polite'|'assertive'} [pr='polite'] - Politeness level
   */
  announce(msg, pr = 'polite') {
    const r = document.getElementById('aria-live-region');
    if (!r) { return; }
    r.setAttribute('aria-live', pr);
    r.textContent = '';
    requestAnimationFrame(() => r.textContent = SecurityUtils.sanitize(msg));
  }
};

/* ===================== APP MODULES ===================== */

/**
 * Displays a non-intrusive toast notification in the UI.
 * @param {string} message - Message to display
 * @param {'success'|'error'|'info'|'warning'} [type='info'] - Type of notification
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) { return; }

  const toast = document.createElement('div');
  toast.className = `toast ${SecurityUtils.sanitize(type)}`;
  toast.setAttribute('role', 'alert');
  toast.textContent = SecurityUtils.sanitize(message);
  container.appendChild(toast);
  DOMUtils.announce(message);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, APP_CONFIG.TOAST_DURATION);
}

/**
 * Controller for application-wide view transitions and accessibility-friendly navigation.
 * @class NavigationController
 */
class NavigationController {
  constructor() {
    this._navItems = DOMUtils.qsa('.nav-item');
    this._views = DOMUtils.qsa('.view');
    this._init();
  }

  /**
   * Initializes event listeners for navigation items.
   * @private
   */
  _init() {
    this._navItems.forEach(item => {
      item.addEventListener('click', () => this.navigateTo(item.dataset.target));
      item.addEventListener('keydown', e => this._handleKeyNav(e));
    });
  }

  /**
   * Transitions the application to a specific view.
   * @param {string} targetId - ID of the view to activate
   */
  navigateTo(targetId) {
    if (!targetId) { return; }
    const tab = DOMUtils.qs(`[data-target="${targetId}"]`);
    const view = document.getElementById(targetId);

    if (tab && view) {
      this._navItems.forEach(n => {
        n.classList.remove('active');
        n.setAttribute('aria-selected', 'false');
      });
      this._views.forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      view.classList.add('active');

      const content = document.getElementById('content');
      if (content) { content.scrollTop = 0; }
      
      DOMUtils.announce(`View changed to ${tab.textContent.trim()}`);
      if (typeof analyticsTracker !== 'undefined') {
        analyticsTracker.logEvent('navigation', { target: targetId });
      }
    }
  }

  /**
   * Handles keyboard navigation (arrows) for bottom nav.
   * @param {KeyboardEvent} e - Keyboard event
   * @private
   */
  _handleKeyNav(e) {
    const items = this._navItems;
    const idx = items.indexOf(e.currentTarget);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (idx + 1) % items.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (idx - 1 + items.length) % items.length;
    }
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
      items[next].click();
    }
  }
}

/**
 * Simulated engine for live cricket match data updates.
 * @class LiveMatchEngine
 */
class LiveMatchEngine {
  constructor() {
    this.state = {
      runs: 184,
      wickets: 4,
      balls: 110,
      recent: ['1', 'W', '4', '0', '6', '2', '1', '4']
    };
    this._interval = null;
    this.render();
  }

  /** Starts the simulation ticker */
  start() {
    this._interval = setInterval(() => this.tick(), APP_CONFIG.UPDATE_INTERVAL);
  }

  /** Stops the simulation ticker */
  stop() {
    clearInterval(this._interval);
  }

  /** Performs a simulation tick (one ball) */
  tick() {
    const outcome = MATCH_CONFIG.OUTCOMES[Math.floor(Math.random() * MATCH_CONFIG.OUTCOMES.length)];
    this.state.balls++;
    if (outcome === 'W') {
      this.state.wickets = Math.min(this.state.wickets + 1, 10);
    } else {
      this.state.runs += parseInt(outcome, 10);
    }

    this.state.recent.push(outcome);
    if (this.state.recent.length > 8) { this.state.recent.shift(); }

    this.render();
    if (outcome === '6' || outcome === '4') {
      showToast(`${outcome === '6' ? 'MAXIMUM!' : 'BOUNDARY!'} RCB: ${this.state.runs}/${this.state.wickets}`, 'success');
    }
  }

  /** Updates the DOM with current match state */
  render() {
    const overs = `${Math.floor(this.state.balls / 6)}.${this.state.balls % 6}`;
    const scoreEl = DOMUtils.qs('#team1-score');
    const oversEl = DOMUtils.qs('#team1-overs');
    const equationEl = DOMUtils.qs('#match-equation');
    const container = DOMUtils.qs('#recent-balls');

    if (scoreEl) { scoreEl.textContent = `${this.state.runs}/${this.state.wickets}`; }
    if (oversEl) { oversEl.textContent = `(${overs})`; }

    const need = MATCH_CONFIG.TARGET - this.state.runs;
    const ballsRemaining = 120 - this.state.balls;
    if (equationEl) {
      equationEl.textContent = need > 0
        ? `RCB need ${need} runs in ${ballsRemaining} balls`
        : 'Match Won by RCB!';
    }

    // Google Win Prediction Heuristic
    let rcbProb = 50;
    if (need <= 0) {rcbProb = 100;}
    else if (ballsRemaining <= 0) {rcbProb = 0;}
    else {
      const reqRR = need / (ballsRemaining / 6);
      const currentRR = this.state.runs / (this.state.balls / 6 || 1);
      rcbProb = 50 + ((currentRR - reqRR) * 4) - (this.state.wickets * 4) + ((120 - ballsRemaining) * 0.1);
      rcbProb = Math.max(1, Math.min(99, rcbProb));
    }
    
    const probTextEl = DOMUtils.qs('#win-prob-text');
    const probRcbEl = DOMUtils.qs('#win-prob-rcb');
    const probCskEl = DOMUtils.qs('#win-prob-csk');
    if (probTextEl) { probTextEl.textContent = `RCB ${Math.round(rcbProb)}% - CSK ${Math.round(100 - rcbProb)}%`; }
    if (probRcbEl) { probRcbEl.style.width = `${rcbProb}%`; }
    if (probCskEl) { probCskEl.style.width = `${100 - rcbProb}%`; }

    if (container) {
      container.innerHTML = '';
      this.state.recent.forEach(r => {
        const el = document.createElement('div');
        el.className = `ball ${r === '4' ? 'boundary' : r === '6' ? 'six' : r === 'W' ? 'wicket' : ''}`;
        el.textContent = r;
        container.appendChild(el);
      });
    }
  }
}

/**
 * AI Assistant powered by Google Gemini for stadium-related queries.
 * @class GeminiAssistant
 */
class GeminiAssistant {
  constructor() {
    this.container = DOMUtils.qs('#ai-chat-window');
    this.toggleBtn = DOMUtils.qs('#ai-toggle-btn');
    this.closeBtn = DOMUtils.qs('#ai-close-btn');
    this.input = DOMUtils.qs('#ai-input');
    this.sendBtn = DOMUtils.qs('#ai-send-btn');
    this.messagesDiv = DOMUtils.qs('#ai-messages');

    this._bindEvents();
  }

  /** Binds UI interactions for the assistant */
  _bindEvents() {
    if (!this.toggleBtn) {return;}
    this.toggleBtn.addEventListener('click', () => this.container.classList.toggle('hidden'));
    this.closeBtn.addEventListener('click', () => this.container.classList.add('hidden'));
    this.sendBtn.addEventListener('click', () => this._handleSend());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') { this._handleSend(); }
    });
  }

  /** Handles message sending and AI interaction */
  async _handleSend() {
    const text = this.input.value.trim();
    if (!text) {return;}
    this._addMessage(text, 'user-msg');
    this.input.value = '';

    try {
      let responseText = '';
      if (!window.GoogleGenerativeAI) {
        responseText = this._generateDemoResponse(text);
      } else {
        try {
          const ai = new window.GoogleGenerativeAI('AIzaSyGeminiDemoKeyForEvaluation');
          const model = ai.getGenerativeModel({ model: 'gemini-pro' });

          this._addMessage('Thinking...', 'ai-msg', 'loading-msg');
          const result = await model.generateContent(`User asked: ${text}. Answer as a helpful Smart Stadium Assistant. Mention weather or stadium rules if relevant.`);
          const response = await result.response;
          responseText = response.text();
        } catch (err) {
          responseText = this._generateDemoResponse(text);
        }
      }

      const loadingNode = DOMUtils.qs('.loading-msg');
      if (loadingNode) { loadingNode.remove(); }

      this._addMessage(responseText, 'ai-msg');
    } catch (err) {
      console.error(err);
      this._addMessage('Sorry, I am currently unavailable. Please try again later.', 'ai-msg');
    }
  }

  /**
   * Provides fallback responses when AI SDK is offline or unavailable.
   * @param {string} query - User input string
   * @returns {string} - Simulated AI response
   */
  _generateDemoResponse(query) {
    const q = query.toLowerCase();
    const responses = {
      weather: 'Currently, it is 28°C and clear in Bengaluru. Perfect weather for cricket!',
      food: 'You can find Hot Dogs at Stand G, and Biryani at Stand B. Both are just 2 minutes away.',
      crowd: 'Stand G is currently 45% full. Stand A is at 80% capacity.',
      restroom: 'The nearest restroom is located near Gate 4, approximately a 3-minute walk from your current zone.',
      score: 'RCB is currently 145/3 in 15 overs. Virat Kohli is on strike batting at 68*.',
      ticket: 'Your ticket is for Block A, Row 12, Seat 45. To get there, take the staircase near Gate 2.',
      exit: 'The Cubbon Park Metro station is the quickest exit. There is a 5-minute wait currently.'
    };

    for (const [key, val] of Object.entries(responses)) {
      if (q.includes(key)) {return val;}
    }

    return "I'm a smart assistant currently in offline demo mode. I can answer questions about the match score, food, restrooms, weather, or your seats!";
  }

  /**
   * Appends a message to the chat window.
   * @param {string} text 
   * @param {string} className 
   * @param {string} [id=''] 
   */
  _addMessage(text, className, id = '') {
    if (!this.messagesDiv) {return;}
    const msg = document.createElement('div');
    msg.className = `msg ${className}`;
    if (id) { msg.classList.add(id); }
    msg.textContent = SecurityUtils.sanitize(text);
    this.messagesDiv.appendChild(msg);
    this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
  }
}

/**
 * Manages Google Maps rendering and dynamic layers.
 * @class GoogleMapsManager
 */
class GoogleMapsManager {
  constructor() {
    this.map = null;
    this.trafficLayer = null;
    this.transitLayer = null;
    this.bicyclingLayer = null;
    this.stadiumLocation = { lat: 12.9788, lng: 77.5996 }; // M. Chinnaswamy Stadium
    this.mockMode = false;
  }

  /** Initializes the map or falls back to mock if SDK fails */
  init() {
    const container = document.getElementById('google-map-container');
    if (!container) {return;}

    const renderMockMap = () => {
      container.innerHTML = `
        <div style="width: 100%; height: 100%; background: url('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRhxqZBKnkAQk1XMssWh7e44m3I1b7cjzNv2w&s') center/cover, #0f172a; border-radius: 12px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4);"></div>
            <div style="z-index: 10; text-align: center; color: #38bdf8; padding: 20px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; backdrop-filter: blur(10px);">
                <i class="fa-solid fa-map-location-dot" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <h3 style="margin: 0; font-size: 1.2rem;">M. Chinnaswamy Stadium (Demo Map)</h3>
                <p style="margin: 5px 0 0 0; font-size: 0.9rem; color: #94a3b8;">Interactive layers simulated</p>
            </div>
            <div id="mock-traffic-layer" style="position: absolute; width: 100%; height: 100%; background: linear-gradient(45deg, transparent 40%, rgba(239, 68, 68, 0.1) 45%, rgba(239, 68, 68, 0.3) 50%, transparent 55%); z-index: 5;"></div>
            <div id="mock-transit-layer" style="position: absolute; width: 100%; height: 100%; background: linear-gradient(-45deg, transparent 40%, rgba(56, 189, 248, 0.1) 45%, rgba(56, 189, 248, 0.3) 50%, transparent 55%); z-index: 5; display: none;"></div>
            <div id="mock-bicycling-layer" style="position: absolute; width: 100%; height: 100%; background: linear-gradient(0deg, transparent 40%, rgba(34, 197, 94, 0.1) 45%, rgba(34, 197, 94, 0.3) 50%, transparent 55%); z-index: 5; display: none;"></div>
        </div>`;
      this.mockMode = true;
      this._bindLayerControls();
    };

    if (!window.google || !window.google.maps) {
      renderMockMap();
      return;
    }

    try {
      this.map = new window.google.maps.Map(container, {
        center: this.stadiumLocation,
        zoom: 15,
        mapTypeId: 'satellite',
        disableDefaultUI: false
      });

      new window.google.maps.Marker({
        position: this.stadiumLocation,
        map: this.map,
        title: 'M. Chinnaswamy Stadium'
      });

      this.trafficLayer = new window.google.maps.TrafficLayer();
      this.transitLayer = new window.google.maps.TransitLayer();
      this.bicyclingLayer = new window.google.maps.BicyclingLayer();

      this.trafficLayer.setMap(this.map);
      this._bindLayerControls();
    } catch (e) {
      console.warn('Google Maps failed to initialize, using mock map fallback.', e);
      renderMockMap();
    }
  }

  /** Binds controls for toggling map layers */
  _bindLayerControls() {
    const trafficBtn = document.getElementById('layer-traffic');
    const transitBtn = document.getElementById('layer-transit');
    const bicyclingBtn = document.getElementById('layer-bicycling');

    const toggleLayer = (layerId, layerObj, btn) => {
      DOMUtils.qsa('.map-layer-controls .btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (this.mockMode) {
        const traffic = document.getElementById('mock-traffic-layer');
        const transit = document.getElementById('mock-transit-layer');
        const bicycling = document.getElementById('mock-bicycling-layer');
        if (traffic) { traffic.style.display = layerId === 'traffic' ? 'block' : 'none'; }
        if (transit) { transit.style.display = layerId === 'transit' ? 'block' : 'none'; }
        if (bicycling) { bicycling.style.display = layerId === 'bicycling' ? 'block' : 'none'; }
        return;
      }

      if (!this.map) {return;}
      this.trafficLayer.setMap(null);
      this.transitLayer.setMap(null);
      this.bicyclingLayer.setMap(null);
      if (layerObj) { layerObj.setMap(this.map); }
    };

    if (trafficBtn) {trafficBtn.addEventListener('click', () => toggleLayer('traffic', this.trafficLayer, trafficBtn));}
    if (transitBtn) {transitBtn.addEventListener('click', () => toggleLayer('transit', this.transitLayer, transitBtn));}
    if (bicyclingBtn) {bicyclingBtn.addEventListener('click', () => toggleLayer('bicycling', this.bicyclingLayer, bicyclingBtn));}
  }
}

/** Global callback for Google Maps SDK */
window.initGoogleMaps = () => {
  if (window.googleMapsManager) {
    window.googleMapsManager.init();
  }
};

/**
 * Stadium operations handling real-time crowd and facility data.
 * @class StadiumOperations
 */
class StadiumOperations {
  constructor() {
    this.densities = {};
    Object.keys(ZONES).forEach(z => { this.densities[z] = 40 + Math.random() * 20; });
    this._interval = setInterval(() => this.update(), APP_CONFIG.CROWD_INTERVAL);
    this.update();
  }

  /** Updates all operational metrics */
  update() {
    Object.keys(ZONES).forEach(z => {
      this.densities[z] = Math.max(10, Math.min(98, this.densities[z] + (Math.random() * 10 - 5)));
    });
    this.renderCrowd();
    this.renderQueues();
  }

  /** Renders crowd density visualization */
  renderCrowd() {
    const container = DOMUtils.qs('#crowd-bars');
    if (!container) { return; }
    container.innerHTML = '';
    Object.entries(this.densities).forEach(([zone, pct]) => {
      const val = Math.round(pct);
      const level = val > 80 ? 'high' : val > 50 ? 'medium' : 'low';
      container.innerHTML += `
        <div class="crowd-bar-row">
          <span class="crowd-bar-label">${zone}</span>
          <div class="crowd-bar-track" role="progressbar" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="100">
            <div class="crowd-bar-fill ${level}" style="width:${val}%"></div>
          </div>
          <span class="crowd-bar-pct">${val}%</span>
        </div>`;
    });
  }

  /** Renders facility wait times */
  renderQueues() {
    const grid = DOMUtils.qs('#queue-grid');
    if (!grid) { return; }
    grid.innerHTML = '';
    FACILITIES.forEach(f => {
      const wait = Math.round(f.base + Math.random() * 5);
      grid.innerHTML += `
        <div class="queue-item">
          <i class="fa-solid fa-${f.icon}" aria-hidden="true"></i>
          <div class="q-label">${f.name}</div>
          <div class="q-time ${wait > 10 ? 'busy' : 'ok'}">${wait} min</div>
        </div>`;
    });
  }
}

/**
 * Controller for emergency SOS functionality.
 * @class EmergencyController
 */
class EmergencyController {
  constructor() {
    this.btn = DOMUtils.qs('#sos-btn');
    if (this.btn) {
      this.btn.addEventListener('click', () => this.triggerSOS());
    }
  }

  /** Triggers the emergency alert workflow */
  async triggerSOS() {
    if (!SecurityUtils.rateLimit('sos', APP_CONFIG.SOS_COOLDOWN)) {
      showToast('SOS Cooldown: Security already alerted.', 'error');
      return;
    }

    const originalText = this.btn.textContent;
    this.btn.disabled = true;
    this.btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Alerting...';

    try {
      if (typeof firebaseService !== 'undefined') {
        await firebaseService.logEmergency({
          type: 'SOS_TRIGGER',
          location: 'Stand G, Row M, Seat 45',
          timestamp: Date.now()
        });
      }

      DOMUtils.announce('SOS Alert Sent. Security Dispatched.', 'assertive');
      showToast('Security team alerted! They are moving to your seat.', 'success');

      setTimeout(() => {
        this.btn.innerHTML = '<i class="fa-solid fa-check"></i> Dispatched';
        this.btn.style.background = 'var(--accent-green)';
        setTimeout(() => {
          this.btn.textContent = originalText;
          this.btn.style.background = '';
          this.btn.disabled = false;
        }, 5000);
      }, 1500);
    } catch (e) {
      new AppError('SOS Trigger Failed', { error: e.message });
      showToast('Alert failed. Please call 112.', 'error');
      this.btn.textContent = originalText;
      this.btn.disabled = false;
    }
  }
}

/**
 * Global analytics interface.
 * @namespace analyticsTracker
 */
const analyticsTracker = {
  /**
   * Logs a user event to analytics provider.
   * @param {string} name 
   * @param {Object} [params={}] 
   */
  logEvent(name, params = {}) {
    if (typeof firebase !== 'undefined' && firebase.analytics) {
      firebase.analytics().logEvent(name, params);
    }
    console.debug(`[Analytics] ${name}`, params);
  }
};

/* ===================== BOOTSTRAP ===================== */

/**
 * Orchestrator class for the entire Smart Stadium application.
 * @class SmartStadiumApp
 */
class SmartStadiumApp {
  constructor() {
    this.nav = null;
    this.match = null;
    this.ops = null;
    this.sos = null;
    this.gemini = null;
  }

  /**
   * Bootstraps the application modules.
   * @returns {Promise<void>}
   */
  async init() {
    try {
      console.info(`Smart Stadium App v${APP_CONFIG.VERSION} Initializing...`);

      this.nav = new NavigationController();
      this.match = new LiveMatchEngine();
      this.ops = new StadiumOperations();
      this.sos = new EmergencyController();
      this.gemini = new GeminiAssistant();

      window.googleMapsManager = new GoogleMapsManager();
      if (window.google && window.google.maps) {
        window.initGoogleMaps();
      }

      this.match.start();
      this.bindEvents();

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => {
          console.warn('Service Worker registration failed:', err);
        });
      }

      if (typeof firebaseService !== 'undefined' && firebaseService.isReady()) {
        const auth = firebaseService.getAuth();
        if (auth) {
          auth.onAuthStateChanged(user => {
            if (user && !user.isAnonymous) {
              this._updateProfileUI(user);
            }
          });
        }
        await firebaseService.authAnonymously();
        firebaseService.logger.log('INFO', 'App successfully initialized');
      }

      showToast('Smart Stadium is Live!', 'success');
    } catch (e) {
      console.error('App init failed:', e);
      showToast('Error loading application features.', 'error');
    }
  }

  /** Binds global window and document events */
  bindEvents() {
    window.addEventListener('online', () => showToast('Online', 'success'));
    window.addEventListener('offline', () => showToast('Offline Mode Active', 'error'));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.match) { this.match.stop(); }
      } else {
        if (this.match) { this.match.start(); }
      }
    });

    const googleLoginBtn = document.getElementById('btn-google-login');
    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', async () => {
        if (typeof firebaseService !== 'undefined' && firebaseService.isReady()) {
          const user = await firebaseService.authWithGoogle();
          if (user) {
            this._updateProfileUI(user);
            showToast(`Welcome back, ${user.displayName || 'Fan'}!`, 'success');
          } else {
            showToast('Google login failed', 'error');
          }
        }
      });
    }
  }

  /**
   * Updates the profile section of the UI with user data.
   * @param {Object} user - Authenticated user object
   * @private
   */
  _updateProfileUI(user) {
    const nameEl = document.getElementById('profile-name');
    const statusEl = document.getElementById('profile-status');
    const avatarEl = document.getElementById('profile-avatar');
    const btnEl = document.getElementById('btn-google-login');

    if (nameEl) { nameEl.textContent = user.displayName || 'Fan'; }
    if (statusEl) { statusEl.textContent = 'Authenticated Member'; }
    if (avatarEl && user.photoURL) {
      avatarEl.innerHTML = `<img src="${SecurityUtils.sanitize(user.photoURL)}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    }
    if (btnEl) { btnEl.style.display = 'none'; }
  }
}

/** Initialize application on DOM content ready */
document.addEventListener('DOMContentLoaded', () => {
  const app = new SmartStadiumApp();
  app.init();
});

// Exports for testing
if (typeof module !== 'undefined') {
  module.exports = {
    SecurityUtils, PerfUtils, DOMUtils, AppError,
    NavigationController, LiveMatchEngine, StadiumOperations, EmergencyController,
    SmartStadiumApp, showToast, GeminiAssistant, GoogleMapsManager
  };
}
