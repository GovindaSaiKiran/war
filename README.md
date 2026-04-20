# Smart Stadium Experience 🏟️⚡

> Real-time crowd management, live match tracking, digital ticketing, transit coordination, and emergency assistance for IPL attendees at M. Chinnaswamy Stadium — powered by Google Cloud Platform.

## Problem Statement

**Challenge:** Stadium attendees face long queues, poor crowd visibility, lack of real-time match context, and no centralized digital experience — leading to frustration, safety risks, and missed moments.

**Solution:** A mobile-first Progressive Web App that unifies live match data, crowd analytics, digital ticketing, transit routing, and emergency services into a single, accessible interface.

## Feature → Problem Statement Mapping

| Problem Statement Requirement | Feature Implemented | Module |
|---|---|---|
| Real-time crowd density monitoring | Live crowd density bars per zone with color-coded thresholds | `StadiumOperations` in `app.js` |
| Reduce wait times at facilities | Estimated wait times for food courts, restrooms, merch shops | `StadiumOperations.renderQueues()` |
| Live match information access | Ball-by-ball score simulation, win prediction, CRR display | `LiveMatchEngine` in `app.js` |
| Digital ticketing & entry | QR-based digital pass with gate, stand, seat info | Tickets section in `index.html` |
| Transit coordination to stadium | Google Maps links for airport, railway, bus routes with ETAs | Transit section in `index.html` |
| Emergency / safety response | SOS button with rate limiting, security dispatch, emergency contacts | `EmergencyController` in `app.js` |
| AI-powered stadium assistance | Gemini-powered chatbot for weather, food, crowd, seat queries | `GeminiAssistant` in `app.js` |
| Stadium map & navigation | Interactive stadium map with seat location and nearby facilities | Map section + `GoogleMapsManager` |
| Offline reliability | Service Worker with network-first + cache fallback strategy | `sw.js` |
| Accessibility (WCAG 2.1 AA) | Skip nav, ARIA labels, live regions, keyboard nav, reduced motion | Throughout `index.html` + `style.css` |
| Security hardening | CSP headers, XSS sanitization, rate limiting, input validation | `SecurityUtils` + `nginx.conf` |
| Fan engagement & profile | Google Auth, match history, loyalty points, fan profile | Profile section + `FirebaseService` |

## Tech Stack

- **Frontend:** Vanilla HTML5, CSS3 (Glassmorphism design system), ES6+ JavaScript
- **Backend Services:** Firebase Auth, Firestore, Analytics, Performance Monitoring, Remote Config
- **AI:** Google Gemini API (generative AI assistant)
- **Maps:** Google Maps JavaScript API (traffic, transit, bicycling layers)
- **Deployment:** Docker + Nginx (Cloud Run), GitHub Pages, GitHub Actions CI/CD
- **Testing:** Jest + jsdom (unit tests with coverage)
- **Security:** Helmet-equivalent headers via Nginx, CSP, XSS sanitization, rate limiting

## Getting Started

```bash
npm install
npm test          # Run tests with coverage
npm start         # Serve locally on :8080
```

## Project Structure

```
├── index.html          # Main SPA shell with ARIA-compliant markup
├── app.js              # Application logic (nav, match, crowd, AI, SOS)
├── firebase-config.js  # Firebase + GCP service integrations
├── style.css           # Design system (tokens, glass cards, responsive)
├── sw.js               # Service Worker for offline support
├── nginx.conf          # Production security headers & caching
├── Dockerfile          # Container build for Cloud Run
├── tests/app.test.js   # Jest test suite (50+ tests)
├── .github/workflows/  # CI/CD: test.yml + deploy.yml
└── .env.example        # Environment variable template
```

## Deployment

- **GitHub Pages:** Auto-deploys on push to `main` via `deploy.yml`
- **Cloud Run:** `docker build -t smart-stadium . && docker run -p 8080:8080 smart-stadium`

## License

MIT