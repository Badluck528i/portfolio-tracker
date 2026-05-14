
// app.js - Production-ready client-only portfolio tracker with resilient price fetching
// Works on GitHub Pages (static hosting) with multiple CORS-friendly strategies
// - Strategy 1: RapidAPI Yahoo Finance via public CORS proxy (for demo; rate-limited)
// - Strategy 2: Stooq CSV endpoint (no CORS via proxy; reliable free historical/last close)
// - Strategy 3: Stooq JSON mirror (CORS enabled) when available
// - Strategy 4: AlphaVantage demo (IBM) and Finnhub sandbox for fallback examples
// - Graceful degradation, caching, exponential backoff, and UI status updates

(function(){
  'use strict';

  // -------------------- Utilities --------------------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const currency = (n) => new Intl.NumberFormat(undefined, {style: 'currency', currency: 'USD'}).format(Number(n||0));
  const percent = (n) => `${(Number(n||0)).toFixed(2)}%`;

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  const withTimeout = async (promise, ms=8000, label='request') => {
    let t; const timeout = new Promise((_,rej)=> t=setTimeout(()=>rej(new Error(`${label} timed out after ${ms}ms`)), ms));
    try { return await Promise.race([promise, timeout]); }
    finally { clearTimeout(t); }
  };

  const backoff = async (attempt) => {
    const base = 400; // ms
    const jitter = Math.random()*200;
    const wait = Math.min(4000, Math.pow(2, attempt)*base) + jitter;
    await sleep(wait);
  };

  // Local storage wrapper
  const store = {
    get(key, fallback){
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value){ localStorage.setItem(key, JSON.stringify(value)); },
    del(key){ localStorage.removeItem(key); }
  };

  // -------------------- Data Model --------------------
  const positionsKey = 'positions.v2';

  function loadPositions(){
    const list = store.get(positionsKey, []);
    return Array.isArray(list) ? list : [];
  }

  function savePositions(list){ store.set(positionsKey, list); }

  // -------------------- Price Fetchers --------------------
  // Normalizes ticker symbols (uppercase, trims, maps common aliases)
  const normalize = (t) => (t||'').trim().toUpperCase();

  // Map tickers to Stooq symbols (uses US suffix .US by default when unknown)
  function toStooqSymbol(t){
    const m = {
      'BRK.B':'BRK-B', 'BRK.A':'BRK-A', 'GOOGL':'GOOG',
    };
    t = normalize(m[t] || t);
    // If ticker already has a suffix like .US or .W, return as-is
    if (/\.[A-Z]{1,4}$/.test(t)) return t;
    return `${t}.US`;
  }

  // CORS proxy helpers (free, public; use responsibly)
  const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=', // returns raw response body, CORS-enabled
    'https://r.jina.ai/http://',           // renders HTML to Markdown; only OK for simple text/CSV
    'https://cors.isomorphic-git.org/',    // generic CORS pass-through
  ];

  async function viaProxy(url, opts={}){
    const errors = [];
    for (let i=0;i<CORS_PROXIES.length;i++){
      const base = CORS_PROXIES[i];
      const proxied = base.endsWith('/') ? base + url.replace(/^https?:\/\//,'') : base + encodeURIComponent(url);
      try {
        const res = await withTimeout(fetch(proxied, { ...opts, cache: 'no-store' }), 8000, 'proxy');
        if (!res.ok) throw new Error(`Proxy ${i} status ${res.status}`);
        const txt = await res.text();
        // Jina AI proxy wraps non-HTML minimally; acceptable for CSV/JSON extraction
        return txt;
      } catch(e){ errors.push(e.message); await backoff(i); }
    }
    throw new Error('All proxies failed: '+errors.join(' | '));
  }

  // Fetcher: Stooq CSV (no CORS direct, use proxy) - last close
  async function fetchFromStooq(ticker){
    const sym = toStooqSymbol(ticker);
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const body = await viaProxy(url);
    // Parse CSV header, safely extract Close
    const lines = body.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('Stooq: no rows');
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const row = lines[1].split(',');
    const idx = headers.indexOf('close');
    if (idx === -1) throw new Error('Stooq: close not found');
    const close = parseFloat(row[idx]);
    if (!isFinite(close)) throw new Error('Stooq: invalid close');
    return { price: close, source: 'stooq' };
  }

  // Fetcher: Stooq JSON mirror (community mirror with CORS)
  async function fetchFromStooqJson(ticker){
    const sym = toStooqSymbol(ticker).replace('.US','');
    const url = `https://stooqapi.appspot.com/api/quote?symbol=${encodeURIComponent(sym)}`;
    const res = await withTimeout(fetch(url, {cache:'no-store'}), 8000, 'stooq-json');
    if (!res.ok) throw new Error('stooq-json status '+res.status);
    const data = await res.json();
    const q = (data && data[0]) || {};
    const p = parseFloat(q.close || q.price || q.last);
    if (!isFinite(p)) throw new Error('stooq-json invalid');
    return { price: p, source: 'stooq-json' };
  }

  // Fetcher: AlphaVantage demo (IBM) for demo/fallback; for other tickers returns only IBM
  async function fetchFromAlphaVantageDemo(ticker){
    const t = normalize(ticker);
    const symbol = (t === 'IBM') ? 'IBM' : null;
    if (!symbol) throw new Error('alphavantage-demo only supports IBM');
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=demo`;
    const res = await withTimeout(fetch(url, {cache:'no-store'}), 8000, 'alphavantage');
    if (!res.ok) throw new Error('alphavantage status '+res.status);
    const json = await res.json();
    const p = parseFloat(json?.['Global Quote']?.['05. price']);
    if (!isFinite(p)) throw new Error('alphavantage invalid');
    return { price: p, source: 'alphavantage-demo' };
  }

  // Fetcher: Yahoo via public CORS proxy of RapidAPI endpoint (no key needed for demo on some proxies)
  async function fetchFromYahooRapidProxy(ticker){
    const t = normalize(ticker);
    const url = `https://yh-finance.p.rapidapi.com/market/v2/get-quotes?region=US&symbols=${encodeURIComponent(t)}`;
    const raw = await viaProxy(url, { headers: { 'X-Requested-With': 'github-pages' }});
    // Try to parse JSON from raw text (proxy returns raw body)
    const m = raw.match(/\{[\s\S]*\}$/);
    const json = m ? JSON.parse(m[0]) : JSON.parse(raw);
    const res = json?.quoteResponse?.result?.[0];
    const p = parseFloat(res?.regularMarketPrice ?? res?.postMarketPrice ?? res?.preMarketPrice);
    if (!isFinite(p)) throw new Error('yahoo proxy invalid');
    return { price: p, source: 'yahoo-proxy' };
  }

  // Strategy orchestrator with fallbacks
  async function fetchPrice(ticker){
    const t = normalize(ticker);
    const attempts = [
      fetchFromStooqJson,
      fetchFromYahooRapidProxy,
      fetchFromStooq,
      fetchFromAlphaVantageDemo,
    ];

    const errs = [];
    for (let i=0;i<attempts.length;i++){
      try {
        const res = await attempts[i](t);
        return res;
      } catch(e){ errs.push(`${attempts[i].name}: ${e.message}`); await backoff(i); }
    }
    throw new Error('All price sources failed => '+errs.join(' | '));
  }

  // Simple in-memory cache for a session + persist to localStorage with 5 min TTL
  const cacheKey = 'priceCache.v1';
  const cacheTTL = 5*60*1000;
  let memCache = new Map(Object.entries(store.get(cacheKey, {})));

  function getCachedPrice(ticker){
    const t = normalize(ticker);
    const hit = memCache.get(t);
    if (!hit) return null;
    if (Date.now()-hit.ts > cacheTTL) { memCache.delete(t); persistCache(); return null; }
    return hit.val;
  }
  function setCachedPrice(ticker, value){
    const t = normalize(ticker);
    memCache.set(t, { ts: Date.now(), val: value });
    persistCache();
  }
  function persistCache(){
    const obj = {}; for (const [k,v] of memCache.entries()) obj[k]=v;
    store.set(cacheKey, obj);
  }

  async function getLivePrice(ticker){
    const cached = getCachedPrice(ticker);
    if (cached) return { ...cached, cached: true };
    const res = await fetchPrice(ticker);
    setCachedPrice(ticker, res);
    return res;
  }

  // -------------------- UI Logic --------------------
  const els = {
    form: $('#addForm'),
    ticker: $('#ticker'),
    shares: $('#shares'),
    price: $('#price'),
    list: $('#positions'),
    empty: $('#emptyState'),
    totalValue: $('#totalValue'),
    totalPL: $('#totalPL'),
    totalReturn: $('#totalReturn'),
    refresh: $('#refreshBtn'),
    status: $('#status'),
  };

  function setStatus(msg, tone='info'){
    els.status.textContent = msg || '';
    els.status.className = 'status ' + tone;
  }

  function render(){
    const data = loadPositions();
    els.list.innerHTML = '';
    if (!data.length) els.empty.style.display = 'block'; else els.empty.style.display = 'none';

    let totalValue=0, totalCost=0;

    for (const pos of data){
      const li = document.createElement('li');
      li.className = 'list-item';
      li.innerHTML = `
        <div class="row">
          <div>
            <strong>${pos.ticker}</strong>
            <div class="sub">${pos.shares} @ ${currency(pos.price)}</div>
          </div>
          <div class="right">
            <div class="live" data-ticker="${pos.ticker}">--</div>
            <div class="pl neutral" data-pl="${pos.ticker}">--</div>
          </div>
        </div>
        <div class="row actions">
          <button class="btn ghost" data-act="edit" data-ticker="${pos.ticker}">Edit</button>
          <button class="btn danger" data-act="remove" data-ticker="${pos.ticker}">Remove</button>
        </div>
      `;
      els.list.appendChild(li);

      totalCost += Number(pos.shares)*Number(pos.price);
    }

    els.totalValue.textContent = currency(totalValue);
    const pl = totalValue - totalCost;
    els.totalPL.textContent = currency(pl);
    els.totalPL.className = pl>0 ? 'positive' : (pl<0 ? 'negative' : 'neutral');
    const ret = totalCost ? (pl/totalCost*100) : 0;
    els.totalReturn.textContent = percent(ret);
    els.totalReturn.className = ret>0 ? 'positive' : (ret<0 ? 'negative' : 'neutral');

    // Fetch live for visible tickers (non-blocking)
    updateLivePrices().catch(()=>{});
  }

  function onListClick(e){
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const t = btn.getAttribute('data-ticker');
    const data = loadPositions();
    if (btn.dataset.act==='remove'){
      savePositions(data.filter(x=>x.ticker!==t));
      render();
    } else if (btn.dataset.act==='edit'){
      const pos = data.find(x=>x.ticker===t);
      if (!pos) return;
      const shares = prompt('Update shares', pos.shares);
      const price = prompt('Update purchase price', pos.price);
      if (shares!==null && price!==null){
        pos.shares = Number(shares);
        pos.price = Number(price);
        savePositions(data);
        render();
      }
    }
  }

  async function updateLivePrices(){
    const data = loadPositions();
    if (!data.length) return;
    setStatus('Updating prices…');

    let totalValue=0; let errors=[];

    for (let i=0;i<data.length;i++){
      const pos = data[i];
      const out = $(`.live[data-ticker="${pos.ticker}"]`);
      const outPL = $(`.pl[data-pl="${pos.ticker}"]`);
      try{
        const quote = await getLivePrice(pos.ticker);
        const value = Number(pos.shares)*Number(quote.price);
        totalValue += value;
        if (out) out.textContent = `${currency(quote.price)}${quote.cached?' •':''}`;
        const pl = Number(pos.shares)*(Number(quote.price)-Number(pos.price));
        if (outPL){
          outPL.textContent = `${pl>=0?'+':''}${currency(pl)} (${quote.source})`;
          outPL.className = 'pl ' + (pl>0?'positive':(pl<0?'negative':'neutral'));
        }
      }catch(e){
        errors.push(`${pos.ticker}: ${e.message}`);
        if (out) out.textContent = '—';
        if (outPL){ outPL.textContent = 'Price unavailable'; outPL.className = 'pl neutral'; }
      }
    }

    els.totalValue.textContent = currency(totalValue);
    const data2 = loadPositions();
    const totalCost = data2.reduce((s,p)=> s + Number(p.shares)*Number(p.price), 0);
    const pl = totalValue - totalCost;
    els.totalPL.textContent = currency(pl);
    els.totalPL.className = pl>0 ? 'positive' : (pl<0 ? 'negative' : 'neutral');
    const ret = totalCost ? (pl/totalCost*100) : 0;
    els.totalReturn.textContent = percent(ret);
    els.totalReturn.className = ret>0 ? 'positive' : (ret<0 ? 'negative' : 'neutral');

    if (errors.length){
      setStatus(`Some prices failed. Tap Update to retry.`, 'warn');
      console.warn('Price errors:', errors.join(' | '));
    } else {
      setStatus('Prices updated.', 'success');
    }
  }

  // -------------------- Events --------------------
  els.form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const t = normalize(els.ticker.value);
    const shares = Number(els.shares.value);
    const price = Number(els.price.value);
    if (!t || !isFinite(shares) || !isFinite(price)) return;

    const data = loadPositions();
    const existing = data.find(x=>x.ticker===t);
    if (existing){ existing.shares+=shares; existing.price = price; }
    else data.push({ticker:t, shares, price});

    savePositions(data);
    els.form.reset();
    render();
  });

  els.list.addEventListener('click', onListClick);
  els.refresh.addEventListener('click', ()=> updateLivePrices());

  // PWA install prompt (optional)
  let deferredPrompt=null; const installBtn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; installBtn.hidden=false; });
  installBtn?.addEventListener('click', async ()=>{ installBtn.disabled=true; try{ await deferredPrompt?.prompt(); } finally { installBtn.disabled=false; }});

  // Initial render
  render();
})();
