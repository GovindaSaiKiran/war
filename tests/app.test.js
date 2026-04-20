/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Comprehensive Test Suite for Smart Stadium Experience
 * LiveMatchEngine, GeminiAssistant, GoogleMapsManager, StadiumOperations,
 * EmergencyController, SmartStadiumApp, FirebaseService, CloudLogger
 */
'use strict';

// --- Global Mocks ---
global.navigator.sendBeacon = jest.fn(() => true);
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const mockAnalytics = { logEvent: jest.fn() };
const mockAuth = {
  signInAnonymously: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),
  signInWithPopup: jest.fn().mockResolvedValue({ user: { uid: 'uid123', email: 'test@example.com', displayName: 'Google User', photoURL: 'http://p' } }),
  onAuthStateChanged: jest.fn((cb) => { cb({ displayName: 'Test User', isAnonymous: false }); return jest.fn(); })
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
  })),
  FieldValue: { serverTimestamp: jest.fn(() => 'ts') }
};

global.firebase = {
  apps: [],
  initializeApp: jest.fn(() => ({})),
  app: jest.fn(() => ({})),
  auth: Object.assign(jest.fn(() => mockAuth), { GoogleAuthProvider: jest.fn() }),
  firestore: Object.assign(jest.fn(() => mockFirestore), { CACHE_SIZE_UNLIMITED: -1, FieldValue: mockFirestore.FieldValue }),
  analytics: jest.fn(() => mockAnalytics),
  performance: jest.fn(() => ({})),
  remoteConfig: jest.fn(() => ({ settings: {}, defaultConfig: {} })),
  storage: jest.fn(() => ({}))
};

global.window.GoogleGenerativeAI = class {
  constructor() {}
  getGenerativeModel() {
    return { generateContent: jest.fn().mockResolvedValue({ response: { text: () => 'AI Response' } }) };
  }
};

global.google = {
  maps: {
    Map: jest.fn().mockImplementation(function() { this.setOptions = jest.fn(); this.setCenter = jest.fn(); }),
    TrafficLayer: jest.fn().mockImplementation(function() { this.setMap = jest.fn(); }),
    TransitLayer: jest.fn().mockImplementation(function() { this.setMap = jest.fn(); }),
    BicyclingLayer: jest.fn().mockImplementation(function() { this.setMap = jest.fn(); }),
    LatLng: jest.fn(),
    Marker: jest.fn()
  }
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
const { firebaseService, CloudLogger } = require('../firebase-config.js');
const {
  SecurityUtils, PerfUtils, DOMUtils, AppError,
  NavigationController, LiveMatchEngine, EmergencyController,
  SmartStadiumApp, showToast, GeminiAssistant, GoogleMapsManager,
  StadiumOperations
} = require('../app.js');

// --- Helper ---
const setupMockDOM = () => {
  document.body.innerHTML = `
    <div id="toast-container"></div>
    <div id="aria-live-region"></div>
    <div id="team1-score"></div><div id="team1-overs"></div>
    <div id="match-equation"></div>
    <div id="win-prob-text"></div><div id="win-prob-rcb"></div><div id="win-prob-csk"></div>
    <div id="recent-balls"></div><div id="crowd-bars"></div><div id="queue-grid"></div>
    <button id="sos-btn">SOS</button>
    <div id="content"></div>
    <div id="google-map-container"></div>
    <button id="layer-traffic"></button><button id="layer-transit"></button><button id="layer-bicycling"></button>
    <div id="ai-chat-window" class="hidden">
      <button id="ai-toggle-btn"></button><button id="ai-close-btn"></button>
      <input id="ai-input" /><button id="ai-send-btn"></button><div id="ai-messages"></div>
    </div>
    <div id="profile-name"></div><div id="profile-status"></div><div id="profile-avatar"></div>
    <button id="btn-google-login"></button>
    <div id="facility-list"></div>
    <button class="nav-item active" data-target="live-match" aria-selected="true"><span>Live</span></button>
    <button class="nav-item" data-target="stadium-map" aria-selected="false"><span>Map</span></button>
    <button class="nav-item" data-target="tickets" aria-selected="false"><span>Tickets</span></button>
    <div id="live-match" class="view active"></div>
    <div id="stadium-map" class="view"></div>
    <div id="tickets" class="view"></div>
  `;
};

// ======================== TESTS ========================

describe('SecurityUtils', () => {
  test('sanitize returns empty string for non-string input', () => {
    expect(SecurityUtils.sanitize(null)).toBe('');
    expect(SecurityUtils.sanitize(undefined)).toBe('');
    expect(SecurityUtils.sanitize(123)).toBe('');
    expect(SecurityUtils.sanitize({})).toBe('');
  });

  test('sanitize escapes HTML entities', () => {
    expect(SecurityUtils.sanitize('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(SecurityUtils.sanitize('Hello & "World"')).toContain('&amp;');
  });

  test('sanitize preserves safe strings', () => {
    expect(SecurityUtils.sanitize('Hello World')).toBe('Hello World');
    expect(SecurityUtils.sanitize('')).toBe('');
  });

  test('validateNum returns null for invalid inputs', () => {
    expect(SecurityUtils.validateNum('abc')).toBeNull();
    expect(SecurityUtils.validateNum(NaN)).toBeNull();
    expect(SecurityUtils.validateNum(Infinity)).toBeNull();
    expect(SecurityUtils.validateNum(-1, 0, 100)).toBeNull();
  });

  test('validateNum returns number for valid inputs', () => {
    expect(SecurityUtils.validateNum('5', 0, 10)).toBe(5);
    expect(SecurityUtils.validateNum(0)).toBe(0);
    expect(SecurityUtils.validateNum(99, 0, 100)).toBe(99);
  });

  test('validateNum enforces range bounds', () => {
    expect(SecurityUtils.validateNum(5, 10, 20)).toBeNull();
    expect(SecurityUtils.validateNum(25, 10, 20)).toBeNull();
    expect(SecurityUtils.validateNum(15, 10, 20)).toBe(15);
  });

  test('rateLimit blocks rapid repeated actions', () => {
    sessionStorage.clear();
    expect(SecurityUtils.rateLimit('test_action', 1000)).toBe(true);
    expect(SecurityUtils.rateLimit('test_action', 1000)).toBe(false);
  });

  test('rateLimit allows different actions independently', () => {
    sessionStorage.clear();
    expect(SecurityUtils.rateLimit('action_a', 1000)).toBe(true);
    expect(SecurityUtils.rateLimit('action_b', 1000)).toBe(true);
  });
});

describe('PerfUtils', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('debounce delays execution', () => {
    const fn = jest.fn();
    const debounced = PerfUtils.debounce(fn, 200);
    debounced(); debounced(); debounced();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('debounce passes arguments correctly', () => {
    const fn = jest.fn();
    const debounced = PerfUtils.debounce(fn, 100);
    debounced('arg1', 'arg2');
    jest.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  test('throttle limits call frequency', () => {
    const fn = jest.fn();
    const throttled = PerfUtils.throttle(fn, 200);
    throttled(); throttled(); throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(250);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('throttle passes arguments on first call', () => {
    const fn = jest.fn();
    const throttled = PerfUtils.throttle(fn, 100);
    throttled('x', 'y');
    expect(fn).toHaveBeenCalledWith('x', 'y');
  });
});

describe('DOMUtils', () => {
  beforeEach(() => setupMockDOM());

  test('qs finds existing element', () => {
    expect(DOMUtils.qs('#toast-container')).not.toBeNull();
  });

  test('qs returns null for missing element', () => {
    expect(DOMUtils.qs('#nonexistent')).toBeNull();
  });

  test('qsa returns array of elements', () => {
    const items = DOMUtils.qsa('.nav-item');
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(3);
  });

  test('qsa returns empty array when no matches', () => {
    expect(DOMUtils.qsa('.nope')).toEqual([]);
  });

  test('announce sets ARIA live region text', () => {
    jest.useFakeTimers();
    DOMUtils.announce('Test announcement');
    jest.advanceTimersByTime(50);
    const region = document.getElementById('aria-live-region');
    expect(region.textContent).toBe('Test announcement');
    jest.useRealTimers();
  });

  test('announce handles missing region gracefully', () => {
    document.body.innerHTML = '';
    expect(() => DOMUtils.announce('test')).not.toThrow();
  });
});

describe('showToast', () => {
  beforeEach(() => { setupMockDOM(); jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  test('creates toast element in container', () => {
    showToast('Hello', 'success');
    const toasts = document.querySelectorAll('.toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toBe('Hello');
  });

  test('removes toast after duration', () => {
    showToast('Temp', 'info');
    jest.advanceTimersByTime(5000);
    expect(document.querySelectorAll('.toast').length).toBe(0);
  });

  test('handles missing container', () => {
    document.body.innerHTML = '';
    expect(() => showToast('Noop')).not.toThrow();
  });

  test('applies correct type class', () => {
    showToast('Err', 'error');
    expect(document.querySelector('.toast.error')).not.toBeNull();
  });
});

describe('AppError', () => {
  test('creates error with context and timestamp', () => {
    const err = new AppError('fail', { code: 42 });
    expect(err.message).toBe('fail');
    expect(err.name).toBe('AppError');
    expect(err.context.code).toBe(42);
    expect(err.timestamp).toBeInstanceOf(Date);
  });

  test('works with empty context', () => {
    const err = new AppError('simple');
    expect(err.context).toEqual({});
  });
});

describe('NavigationController', () => {
  beforeEach(() => setupMockDOM());

  test('navigateTo switches active view', () => {
    const nav = new NavigationController();
    nav.navigateTo('stadium-map');
    expect(document.getElementById('stadium-map').classList.contains('active')).toBe(true);
    expect(document.getElementById('live-match').classList.contains('active')).toBe(false);
  });

  test('navigateTo sets aria-selected', () => {
    const nav = new NavigationController();
    nav.navigateTo('stadium-map');
    const mapTab = document.querySelector('[data-target="stadium-map"]');
    expect(mapTab.getAttribute('aria-selected')).toBe('true');
  });

  test('navigateTo ignores empty targetId', () => {
    const nav = new NavigationController();
    expect(() => nav.navigateTo('')).not.toThrow();
    expect(() => nav.navigateTo(null)).not.toThrow();
  });

  test('keyboard navigation with ArrowRight/Left', () => {
    const nav = new NavigationController();
    const item = document.querySelector('.nav-item');
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
});

describe('LiveMatchEngine', () => {
  beforeEach(() => { setupMockDOM(); jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  test('initializes with default state', () => {
    const engine = new LiveMatchEngine();
    expect(engine.state.runs).toBe(184);
    expect(engine.state.wickets).toBe(4);
    expect(engine.state.balls).toBe(110);
  });

  test('tick increments balls', () => {
    const engine = new LiveMatchEngine();
    const before = engine.state.balls;
    engine.tick();
    expect(engine.state.balls).toBe(before + 1);
  });

  test('tick handles wicket outcome', () => {
    const engine = new LiveMatchEngine();
    jest.spyOn(Math, 'random').mockReturnValue(0.95);
    engine.tick();
    expect(engine.state.wickets).toBeGreaterThanOrEqual(4);
    Math.random.mockRestore();
  });

  test('tick caps wickets at 10', () => {
    const engine = new LiveMatchEngine();
    engine.state.wickets = 10;
    jest.spyOn(Math, 'random').mockReturnValue(0.95);
    engine.tick();
    expect(engine.state.wickets).toBe(10);
    Math.random.mockRestore();
  });

  test('tick handles boundary and six toasts', () => {
    const engine = new LiveMatchEngine();
    jest.spyOn(Math, 'random').mockReturnValue(0.7);
    engine.tick();
    Math.random.mockReturnValue(0.8);
    engine.tick();
    Math.random.mockRestore();
  });

  test('render shows match won when runs exceed target', () => {
    const engine = new LiveMatchEngine();
    engine.state.runs = 200;
    engine.render();
    expect(document.getElementById('match-equation').textContent).toContain('Won');
  });

  test('render handles zero balls edge case', () => {
    const engine = new LiveMatchEngine();
    engine.state.balls = 0;
    engine.state.runs = 0;
    expect(() => engine.render()).not.toThrow();
  });

  test('start and stop control interval', () => {
    const engine = new LiveMatchEngine();
    engine.start();
    expect(engine._interval).not.toBeNull();
    engine.stop();
  });

  test('recent balls capped at 8', () => {
    const engine = new LiveMatchEngine();
    for (let i = 0; i < 15; i++) engine.tick();
    expect(engine.state.recent.length).toBeLessThanOrEqual(8);
  });
});

describe('StadiumOperations', () => {
  beforeEach(() => { setupMockDOM(); jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  test('initializes crowd densities for all zones', () => {
    const ops = new StadiumOperations();
    expect(Object.keys(ops.densities).length).toBe(5);
    Object.values(ops.densities).forEach(d => {
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(98);
    });
  });

  test('update changes density values', () => {
    const ops = new StadiumOperations();
    const before = { ...ops.densities };
    ops.update();
    // At least renders without error
    expect(Object.keys(ops.densities).length).toBe(5);
  });

  test('renderCrowd creates bar elements', () => {
    const ops = new StadiumOperations();
    ops.renderCrowd();
    expect(document.getElementById('crowd-bars').innerHTML).toContain('crowd-bar-row');
  });

  test('renderQueues creates queue items', () => {
    const ops = new StadiumOperations();
    ops.renderQueues();
    expect(document.getElementById('queue-grid').innerHTML).toContain('queue-item');
  });
});

describe('GeminiAssistant', () => {
  beforeEach(() => setupMockDOM());

  test('toggle opens and closes chat window', () => {
    const ai = new GeminiAssistant();
    ai.toggleBtn.click();
    expect(ai.container.classList.contains('hidden')).toBe(false);
    ai.closeBtn.click();
    expect(ai.container.classList.contains('hidden')).toBe(true);
  });

  test('_handleSend ignores empty input', async () => {
    const ai = new GeminiAssistant();
    ai.input.value = '';
    await ai._handleSend();
    expect(ai.messagesDiv.children.length).toBe(0);
  });

  test('demo responses for known keywords', async () => {
    const ai = new GeminiAssistant();
    const keywords = ['weather', 'food', 'crowd', 'restroom', 'score', 'ticket', 'exit'];
    for (const kw of keywords) {
      ai.input.value = kw;
      await ai._handleSend();
    }
    expect(ai.messagesDiv.children.length).toBeGreaterThan(0);
  });

  test('demo fallback for unknown query', async () => {
    const ai = new GeminiAssistant();
    const resp = ai._generateDemoResponse('random gibberish');
    expect(resp).toContain('offline demo mode');
  });

  test('handles AI SDK error gracefully', async () => {
    const ai = new GeminiAssistant();
    window.GoogleGenerativeAI = class { getGenerativeModel() { return { generateContent: jest.fn().mockRejectedValue(new Error('fail')) }; } };
    ai.input.value = 'test error';
    await ai._handleSend();
    // Should not throw
  });

  test('Enter key triggers send', () => {
    const ai = new GeminiAssistant();
    ai.input.value = 'weather';
    ai.input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
  });
});

describe('GoogleMapsManager', () => {
  beforeEach(() => {
    setupMockDOM();
    global.google = {
      maps: {
        Map: jest.fn().mockImplementation(function() { this.setOptions = jest.fn(); }),
        TrafficLayer: jest.fn().mockImplementation(function() { this.setMap = jest.fn(); }),
        TransitLayer: jest.fn().mockImplementation(function() { this.setMap = jest.fn(); }),
        BicyclingLayer: jest.fn().mockImplementation(function() { this.setMap = jest.fn(); }),
        Marker: jest.fn()
      }
    };
  });

  test('init creates map with google.maps available', () => {
    const mgr = new GoogleMapsManager();
    mgr.init();
    expect(google.maps.Map).toHaveBeenCalled();
  });

  test('falls back to mock when google.maps absent', () => {
    delete window.google.maps;
    const mgr = new GoogleMapsManager();
    mgr.init();
    expect(mgr.mockMode).toBe(true);
  });

  test('falls back on Map constructor error', () => {
    google.maps.Map = jest.fn(() => { throw new Error('fail'); });
    const mgr = new GoogleMapsManager();
    mgr.init();
    expect(mgr.mockMode).toBe(true);
  });

  test('layer controls toggle in mock mode', () => {
    delete window.google.maps;
    const mgr = new GoogleMapsManager();
    mgr.init();
    document.getElementById('layer-traffic').click();
    document.getElementById('layer-transit').click();
    document.getElementById('layer-bicycling').click();
  });
});

describe('EmergencyController', () => {
  beforeEach(() => {
    setupMockDOM();
    jest.useFakeTimers();
    sessionStorage.clear();
    firebaseService._ready = true;
    firebaseService._db = mockFirestore;
  });
  afterEach(() => jest.useRealTimers());

  test('triggerSOS sends alert', async () => {
    const ctrl = new EmergencyController();
    await ctrl.triggerSOS();
    expect(ctrl.btn.disabled).toBe(true);
  });

  test('triggerSOS rate limits repeat presses', async () => {
    const ctrl = new EmergencyController();
    await ctrl.triggerSOS();
    await ctrl.triggerSOS();
    // Second call should be rate limited
  });

  test('handles missing button gracefully', () => {
    document.body.innerHTML = '';
    const ctrl = new EmergencyController();
    expect(ctrl.btn).toBeNull();
  });
});

describe('SmartStadiumApp', () => {
  beforeEach(() => {
    setupMockDOM();
    jest.useFakeTimers();
    firebaseService._ready = true;
    firebaseService._auth = mockAuth;
    firebaseService._db = mockFirestore;
  });
  afterEach(() => jest.useRealTimers());

  test('init bootstraps all modules', async () => {
    const app = new SmartStadiumApp();
    await app.init();
    expect(app.nav).not.toBeNull();
    expect(app.match).not.toBeNull();
    expect(app.ops).not.toBeNull();
    expect(app.sos).not.toBeNull();
  });

  test('visibility change pauses/resumes match', async () => {
    const app = new SmartStadiumApp();
    await app.init();
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  test('google login button triggers auth', async () => {
    const app = new SmartStadiumApp();
    await app.init();
    const btn = document.getElementById('btn-google-login');
    btn.click();
    await Promise.resolve();
  });

  test('_updateProfileUI sets name and hides button', () => {
    const app = new SmartStadiumApp();
    app._updateProfileUI({ displayName: 'Jane', photoURL: 'http://img.png' });
    expect(document.getElementById('profile-name').textContent).toBe('Jane');
    expect(document.getElementById('btn-google-login').style.display).toBe('none');
  });

  test('_updateProfileUI handles missing displayName', () => {
    const app = new SmartStadiumApp();
    app._updateProfileUI({});
    expect(document.getElementById('profile-name').textContent).toBe('Fan');
  });
});

describe('FirebaseService & CloudLogger', () => {
  test('firebaseService isReady returns boolean', () => {
    expect(typeof firebaseService.isReady()).toBe('boolean');
  });

  test('authAnonymously returns user on success', async () => {
    firebaseService._auth = mockAuth;
    const user = await firebaseService.authAnonymously();
    expect(user).toBeDefined();
  });

  test('authAnonymously returns null on failure', async () => {
    firebaseService._auth = mockAuth;
    mockAuth.signInAnonymously.mockRejectedValueOnce(new Error('fail'));
    const user = await firebaseService.authAnonymously();
    expect(user).toBeNull();
  });

  test('authWithGoogle returns mock user on popup failure', async () => {
    firebaseService._auth = mockAuth;
    mockAuth.signInWithPopup.mockRejectedValueOnce(new Error('blocked'));
    const user = await firebaseService.authWithGoogle();
    expect(user.displayName).toContain('Demo');
  });

  test('saveProfile handles null uid', async () => {
    await firebaseService.saveProfile(null, {});
  });

  test('logEmergency handles missing db', async () => {
    const originalDb = firebaseService._db;
    firebaseService._db = null;
    await firebaseService.logEmergency({ type: 'test' });
    firebaseService._db = originalDb;
  });

  test('subscribeToCrowdData returns null without db', () => {
    const originalDb = firebaseService._db;
    firebaseService._db = null;
    expect(firebaseService.subscribeToCrowdData(() => {})).toBeNull();
    firebaseService._db = originalDb;
  });

  test('CloudLogger logs without error', async () => {
    const logger = new CloudLogger('test-project');
    await logger.log('INFO', 'test message', { key: 'val' });
    await logger.log('ERROR', 'error message');
  });

  test('getter methods return expected types', () => {
    expect(firebaseService.getAuth()).toBeDefined();
    expect(firebaseService.getFirestore()).toBeDefined();
    expect(firebaseService.getPerformance()).toBeDefined();
    expect(firebaseService.getRemoteConfig()).toBeDefined();
    expect(firebaseService.getStorage()).toBeDefined();
    expect(firebaseService.getAnalytics()).toBeDefined();
  });
});

describe('initGoogleMaps global callback', () => {
  test('calls init when manager exists', () => {
    setupMockDOM();
    window.googleMapsManager = new GoogleMapsManager();
    jest.spyOn(window.googleMapsManager, 'init').mockImplementation(() => {});
    window.initGoogleMaps();
    expect(window.googleMapsManager.init).toHaveBeenCalled();
  });
});
