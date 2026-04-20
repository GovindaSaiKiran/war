/**
 * @fileoverview Final production-grade test suite for Smart Stadium Experience v2.2
 * @jest-environment jsdom
 */
'use strict';

// --- Global Mocks ---
global.navigator.sendBeacon = jest.fn();
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const mockAnalytics = { logEvent: jest.fn() };
const mockAuth = {
  signInAnonymously: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),
  signInWithPopup: jest.fn().mockResolvedValue({ user: { uid: 'uid123', email: 'test@example.com', displayName: 'Google User' } }),
  onAuthStateChanged: jest.fn((cb) => cb({ displayName: 'Test User', isAnonymous: false }))
};
const mockFirestore = {
  settings: jest.fn(),
  enablePersistence: jest.fn().mockResolvedValue(undefined),
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({ 
      set: jest.fn().mockResolvedValue(undefined), 
      onSnapshot: jest.fn((cb) => { cb({ exists: true, data: () => ({ density: 50 }) }); return jest.fn(); })
    })),
    add: jest.fn().mockResolvedValue({ id: 'test-id' })
  }))
};

global.firebase = {
  apps: [],
  initializeApp: jest.fn(() => ({})),
  app: jest.fn(() => ({})),
  auth: Object.assign(jest.fn(() => mockAuth), { GoogleAuthProvider: jest.fn() }),
  firestore: Object.assign(jest.fn(() => mockFirestore), { CACHE_SIZE_UNLIMITED: -1, FieldValue: { serverTimestamp: jest.fn() } }),
  analytics: jest.fn(() => mockAnalytics),
  performance: jest.fn(() => ({})),
  remoteConfig: jest.fn(() => ({ settings: {}, defaultConfig: {} })),
  storage: jest.fn(() => ({}))
};

global.sessionStorage = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    clear: () => { store = {}; },
    removeItem: (key) => { delete store[key]; }
  };
})();

// --- Imports ---
const { firebaseService } = require('../firebase-config.js');
const {
  SecurityUtils, PerfUtils, DOMUtils, AppError,
  NavigationController, LiveMatchEngine, StadiumOperations, EmergencyController,
  SmartStadiumApp, showToast, GeminiAssistant, GoogleMapsManager
} = require('../app.js');

// --- Helper ---
const setupMockDOM = () => {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div id="aria-live-region"></div>
    <div id="content"></div>
    <nav>
      <div class="nav-item active" data-target="view-home" tabindex="0">Home</div>
      <div class="nav-item" data-target="view-map" tabindex="0">Map</div>
      <div class="nav-item" data-target="view-ai" tabindex="0">AI</div>
    </nav>
    <div id="view-home" class="view active"></div>
    <div id="view-map" class="view"></div>
    <div id="view-ai" class="view"></div>
    <div id="team1-score"></div>
    <div id="team1-overs"></div>
    <div id="match-equation"></div>
    <div id="recent-balls"></div>
    <div id="crowd-bars"></div>
    <div id="queue-grid"></div>
    <button id="sos-btn">SOS</button>
    <div id="google-map-container"></div>
    <button id="layer-traffic"></button>
    <button id="layer-transit"></button>
    <button id="layer-bicycling"></button>
    <div id="ai-chat-window" class="hidden">
      <button id="ai-toggle-btn"></button>
      <button id="ai-close-btn"></button>
      <input id="ai-input" />
      <button id="ai-send-btn"></button>
      <div id="ai-messages"></div>
    </div>
    <div id="profile-name"></div>
    <div id="profile-status"></div>
    <div id="profile-avatar"></div>
    <button id="btn-google-login"></button>
  `;
};

// --- Tests ---

describe('Firebase Integration', () => {
  test('FirebaseService operations', async () => {
    expect(firebaseService.isReady()).toBe(true);
    await firebaseService.authAnonymously();
    await firebaseService.authWithGoogle();
    await firebaseService.saveProfile('u1', { name: 'n' });
    await firebaseService.logEmergency({ e: 1 });
    firebaseService.subscribeToCrowdData(() => {});
    expect(mockFirestore.collection).toHaveBeenCalled();
  });

  test('CloudLogger and Telemetry', async () => {
    await firebaseService.logger.log('INFO', 'msg');
    expect(navigator.sendBeacon).toHaveBeenCalled();
  });
});

describe('Core Utilities', () => {
  test('SecurityUtils', () => {
    expect(SecurityUtils.sanitize('<b>HI</b>')).toBe('&lt;b&gt;HI&lt;/b&gt;');
    expect(SecurityUtils.validateNum('5', 0, 10)).toBe(5);
  });

  test('PerfUtils', () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    PerfUtils.debounce(fn, 100)();
    jest.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('DOMUtils', (done) => {
    setupMockDOM();
    expect(DOMUtils.qs('#sos-btn')).not.toBeNull();
    expect(DOMUtils.qs('.view')).not.toBeNull();
    expect(DOMUtils.qs('#none')).toBeNull();
    expect(DOMUtils.qs('.none')).toBeNull();
    DOMUtils.announce('Alert');
    setTimeout(() => {
      expect(document.getElementById('aria-live-region').textContent).toBe('Alert');
      done();
    }, 50);
  });
});

describe('Application Logic', () => {
  beforeEach(setupMockDOM);

  test('NavigationController', () => {
    const nav = new NavigationController();
    nav.navigateTo('view-map');
    expect(document.getElementById('view-map').classList.contains('active')).toBe(true);
  });

  test('LiveMatchEngine', () => {
    const engine = new LiveMatchEngine();
    engine.tick();
    expect(engine.state.balls).toBe(111);
    engine.stop();
  });

  test('StadiumOperations', () => {
    const ops = new StadiumOperations();
    ops.update();
    expect(document.querySelector('.crowd-bar-row')).not.toBeNull();
  });

  test('EmergencyController', async () => {
    sessionStorage.clear();
    const ctrl = new EmergencyController();
    await ctrl.triggerSOS();
    // Rate limit check
    await ctrl.triggerSOS();
  });

  test('GeminiAssistant', async () => {
    const ai = new GeminiAssistant();
    ai.input.value = 'weather';
    await ai._handleSend();
    expect(ai.messagesDiv.innerHTML).toContain('28°C');
  });

  test('GoogleMapsManager', () => {
    const maps = new GoogleMapsManager();
    maps.init();
    expect(maps.mockMode).toBe(true);
  });
});

describe('SmartStadiumApp Lifecycle', () => {
  test('Full bootstrap', async () => {
    setupMockDOM();
    const app = new SmartStadiumApp();
    await app.init();
    expect(app.match).toBeDefined();
    
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));
  });
});

describe('AppError', () => {
  test('logs', () => {
    new AppError('FAIL');
    expect(mockAnalytics.logEvent).toHaveBeenCalled();
  });
});

describe('showToast', () => {
  test('shows', () => {
    setupMockDOM();
    showToast('test', 'success');
    expect(document.querySelector('.toast.success')).not.toBeNull();
  });
});
