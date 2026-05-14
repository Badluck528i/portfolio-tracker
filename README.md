# Portfolio Tracker PWA (Multi‑Currency, EU/UK/CH Support)

This is a mobile‑first progressive web app for tracking a multi‑currency investment portfolio. It supports European markets (EU/UK/CH), fees, FX rates, offline mode, install prompt, and import/export to JSON.

## Features
- Add BUY/SELL/DIV transactions with asset currency, account currency, FX rate and FX fee percent
- Market selection (US/EU/UK/CH) to help with price formatting and conventions
- Per‑transaction fees with independent fee currency
- Automatic FX via cached quotes with manual override
- Live-ish price fetching with graceful offline fallback
- Holdings aggregation, average cost, P/L, and totals in chosen display currency
- Works fully offline (service worker + localStorage)
- Installable PWA with app icon, theme color, and offline cache
- Import/Export JSON backup

## Files
- index.html — UI and form
- app.js — Core logic (storage, FX, pricing, portfolio calculation, PWA hooks)
- styles.css — Mobile‑first responsive styles
- manifest.json — PWA manifest
- service-worker.js — Offline caching
- README.md — This documentation

## Getting started
1. Serve the folder with any static server (or open index.html directly):
   - Python: `python3 -m http.server 8080`
   - Node: `npx http-server -p 8080`
2. Visit http://localhost:8080
3. Add a transaction and experiment with different currencies.
4. Use the Install button (Chrome/Edge) to add to your device.

## Data model
Transactions are stored in localStorage key `pt.transactions`. Price cache in `pt.prices` and FX rates in `pt.fx`.

## FX & prices
- FX: Tries ECB (EUR base), fallback to exchangerate.host, cached with date key. Manual FX overrides any fetched rate.
- Prices: For stocks/ETFs, a simple demo fetcher hits Stooq (EU/US tickers) when online. For crypto, uses CoinGecko (no key). Offline uses last cached.

## Privacy
All data stays locally in your browser. No accounts, no analytics.

## License
MIT
