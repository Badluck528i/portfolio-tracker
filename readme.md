
# Portfolio Tracker PWA

A mobile-first Progressive Web App to track your stock portfolio with live prices from Yahoo Finance. Works offline after first load and can be installed on Android home screen.

## Features
- Add/remove positions, persisted with localStorage
- Live price updates via Yahoo Finance quote API (subject to CORS/network availability)
- Total value, P/L, and returns
- PWA: installable, offline cache via service worker

## Quick Start
1. Serve the folder over HTTPS (required for service workers) or localhost for testing.
   - Python: `python3 -m http.server 8080`
2. Visit `http://localhost:8080` on your phone/desktop.
3. Tap "Update Live Prices" to fetch quotes.
4. Use the browser menu to "Add to Home screen" or tap the in-app Install button when shown.

## Android Install
- Open the site in Chrome on Android.
- If prompted, tap Install; or use the browser menu > Add to Home screen.
- The app opens full-screen (standalone) with its own icon.

## Notes
- Price data may be delayed and subject to CORS restrictions depending on your hosting. If live updates fail, prices will simply not refresh; offline usage still works for stored data.
- This app stores data only on your device using localStorage. Clearing site data will remove positions.

## Files
- index.html: UI
- styles.css: Mobile-first styling
- app.js: App logic and live pricing
- manifest.json: PWA configuration
- service-worker.js: Offline caching
- icon-192.png, icon-512.png: App icons

## Deploy
Host the files on any static hosting with HTTPS (e.g., GitHub Pages, Netlify, Vercel). Ensure all files are at the site root or update service-worker cache paths accordingly.
