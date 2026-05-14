/* Portfolio Tracker PWA - Multi-Currency, EU/UK/CH support */
(() => {
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const STORAGE = {
    TX: 'pt.transactions',
    PRICES: 'pt.prices',
    FX: 'pt.fx'
  };

  const state = {
    txs: loadJSON(STORAGE.TX, []),
    prices: loadJSON(STORAGE.PRICES, {}),
    fx: loadJSON(STORAGE.FX, {}),
    baseDisplay: 'EUR'
  };

  function save() {
    localStorage.setItem(STORAGE.TX, JSON.stringify(state.txs));
    localStorage.setItem(STORAGE.PRICES, JSON.stringify(state.prices));
    localStorage.setItem(STORAGE.FX, JSON.stringify(state.fx));
  }

  function loadJSON(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
  }

  function fmtCurrency(v, ccy) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: ccy }).format(v); }
    catch { return `${v.toFixed(2)} ${ccy}`; }
  }

  function todayStr() { return new Date().toISOString().slice(0,10); }

  // FX handling
  async function getFxRate(from, to, date = todayStr()) {
    if (from === to) return 1;
    const key = `${date}|${from}->${to}`;
    if (state.fx[key]) return state.fx[key];
    // Try ECB (EUR base) via exchangerate.host timeseries
    try {
      let rate;
      if (from === 'EUR' || to === 'EUR') {
        const base = 'EUR';
        const target = from === 'EUR' ? to : from;
        const url = `https://api.exchangerate.host/${date}?base=${base}&symbols=${target}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const r = data.rates?.[target];
          if (r) rate = (from === 'EUR') ? r : 1/r;
        }
      } else {
        // Cross via EUR
        const [a, b] = await Promise.all([
          getFxRate(from, 'EUR', date),
          getFxRate('EUR', to, date)
        ]);
        if (a && b) rate = a * b;
      }
      if (rate) {
        state.fx[key] = rate;
        save();
        return rate;
      }
    } catch (e) {
      console.warn('FX fetch error', e);
    }
    return null;
  }

  // Simple price fetchers
  async function fetchPrice(symbol, market = 'US') {
    const cacheKey = `${symbol}|${market}`;
    if (state.prices[cacheKey] && Date.now() - state.prices[cacheKey].ts < 6*60*60*1000) {
      return state.prices[cacheKey].price;
    }
    let price = null;

    // Crypto via CoinGecko (symbol as id lower, basic heuristic)
    if (/^(BTC|ETH|SOL|ADA|XRP)$/i.test(symbol)) {
      const idMap = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano', XRP: 'ripple' };
      const id = idMap[symbol.toUpperCase()];
      try {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
        if (r.ok) {
          const d = await r.json();
          price = d[id]?.usd ?? null;
        }
      } catch {}
      market = 'US';
    } else {
      // Stooq supports many tickers incl. EU; try US or EU suffixes
      const suffix = market === 'EU' ? '.eu' : market === 'UK' ? '.uk' : market === 'CH' ? '.ch' : '';
      try {
        const r = await fetch(`https://stooq.com/q/l/?s=${symbol}${suffix}&f=sd2t2ohlcv&h&e=csv`);
        if (r.ok) {
          const txt = await r.text();
          const lines = txt.trim().split(/\n/);
          if (lines.length > 1) {
            const cols = lines[1].split(',');
            const closeIdx = 6; // Close column
            const p = parseFloat(cols[closeIdx]);
            if (!isNaN(p)) price = p;
          }
        }
      } catch {}
    }

    if (price != null) {
      state.prices[cacheKey] = { price, ts: Date.now() };
      save();
    }
    return price;
  }

  // Portfolio calculations
  function computeHoldings(displayCcy) {
    const holdings = {};
    for (const t of state.txs) {
      const key = t.asset.toUpperCase();
      holdings[key] ||= { asset: key, qty: 0, costBase: 0, assetCcy: t.assetCurrency };
      if (t.action === 'BUY') {
        holdings[key].qty += t.quantity;
        holdings[key].costBase += t.quantity * t.price;
      } else if (t.action === 'SELL') {
        const proportion = t.quantity / Math.max(holdings[key].qty, 1);
        holdings[key].qty -= t.quantity;
        holdings[key].costBase -= holdings[key].costBase * proportion;
      } else if (t.action === 'DIV') {
        // dividends don't change qty or costBase; could track income
      }
    }
    return holdings;
  }

  async function enrichHoldingsForDisplay(holdings, displayCcy) {
    const out = [];
    for (const h of Object.values(holdings)) {
      const market = inferMarket(h.asset);
      const px = await fetchPrice(h.asset, market);
      const fx = await getFxRate(h.assetCcy, displayCcy) || 1;
      const qty = h.qty;
      const avgCost = qty ? h.costBase / qty : 0;
      const value = (px ?? avgCost) * qty * fx;
      const costInDisp = h.costBase * fx;
      out.push({ ...h, market, price: px, avgCost, value, pl: value - costInDisp, displayCcy });
    }
    return out;
  }

  function inferMarket(symbol) {
    if (/\.(EU|UK|CH)$/i.test(symbol)) return symbol.split('.').pop().toUpperCase();
    return 'US';
  }

  // UI logic
  function render() {
    const disp = qs('#displayCurrency').value;
    state.baseDisplay = disp;
    const holdings = computeHoldings(disp);
    enrichHoldingsForDisplay(holdings, disp).then(rows => {
      const tbody = qs('#holdingsTable tbody');
      tbody.innerHTML = '';
      let total = 0;
      for (const r of rows) {
        total += r.value;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.asset}</td>
          <td>${r.qty.toFixed(4)}</td>
          <td>${fmtCurrency(r.avgCost, r.assetCcy)}</td>
          <td>${r.price ? fmtCurrency(r.price, r.assetCcy) : '—'}</td>
          <td>${fmtCurrency(r.pl, r.displayCcy)}</td>
          <td>${fmtCurrency(r.value, r.displayCcy)}</td>
          <td><button data-asset="${r.asset}" class="link small" title="Remove all transactions for asset">✖</button></td>
        `;
        tbody.appendChild(tr);
      }
      qs('#portfolioSummary').textContent = `Total: ${fmtCurrency(total, disp)}`;
    });

    const tBody = qs('#txTable tbody');
    tBody.innerHTML = '';
    state.txs.forEach((t, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.date || ''}</td>
        <td>${t.asset}</td>
        <td>${t.action}</td>
        <td>${t.quantity}</td>
        <td>${t.price}</td>
        <td>${t.assetCurrency}</td>
        <td>${t.fee || 0}</td>
        <td>${t.feeCurrency}</td>
        <td>${t.fxRate || ''}</td>
        <td>${t.accountCurrency}</td>
        <td>${t.notes || ''}</td>
        <td><button class="link small" data-del="${i}">Delete</button></td>
      `;
      tBody.appendChild(tr);
    });
  }

  function bind() {
    // form
    const form = qs('#txForm');
    qs('#date').value = todayStr();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = {
        asset: qs('#asset').value.trim(),
        market: qs('#market').value,
        action: qs('#action').value,
        quantity: parseFloat(qs('#quantity').value),
        price: parseFloat(qs('#price').value),
        assetCurrency: qs('#assetCurrency').value,
        accountCurrency: qs('#accountCurrency').value,
        fee: parseFloat(qs('#fee').value || '0'),
        feeCurrency: (qs('#feeCurrency').value === 'MATCH') ? qs('#accountCurrency').value : qs('#feeCurrency').value,
        fxRate: parseFloat(qs('#fxRate').value || 'NaN'),
        fxFeePct: parseFloat(qs('#fxFeePct').value || '0'),
        date: qs('#date').value,
        notes: qs('#notes').value.trim()
      };

      if (!t.asset || !isFinite(t.quantity) || !isFinite(t.price)) return;

      // Determine FX if not provided
      if (!isFinite(t.fxRate)) {
        const r = await getFxRate(t.assetCurrency, t.accountCurrency, t.date || todayStr());
        t.fxRate = r || 1;
      }
      // Apply FX fee percent (e.g., broker adds 0.25%)
      if (t.fxFeePct) {
        t.fxRate *= (1 - t.fxFeePct / 100);
      }

      // Normalize cost to asset currency for average cost calculations
      // We'll store raw transaction values; holdings calc uses asset currency cost basis
      state.txs.push(t);
      save();
      render();
      form.reset();
      qs('#date').value = todayStr();
    });

    qs('#resetBtn').addEventListener('click', () => {
      if (confirm('Clear all data?')) {
        state.txs = [];
        save();
        render();
      }
    });

    qs('#displayCurrency').addEventListener('change', render);

    qs('#txTable').addEventListener('click', (e) => {
      const i = e.target?.dataset?.del;
      if (i != null) {
        state.txs.splice(parseInt(i), 1);
        save();
        render();
      }
    });

    qs('#holdingsTable').addEventListener('click', (e) => {
      const a = e.target?.dataset?.asset;
      if (a) {
        if (confirm(`Remove all transactions for ${a}?`)) {
          state.txs = state.txs.filter(t => t.asset.toUpperCase() !== a);
          save();
          render();
        }
      }
    });

    // import/export
    qs('#exportBtn').addEventListener('click', () => {
      const data = { txs: state.txs, prices: state.prices, fx: state.fx };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'portfolio-backup.json'; a.click();
      URL.revokeObjectURL(url);
    });

    const importFile = qs('#importFile');
    qs('#importBtn').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const f = importFile.files[0]; if (!f) return;
      const txt = await f.text();
      try {
        const d = JSON.parse(txt);
        if (Array.isArray(d.txs)) state.txs = d.txs;
        if (d.prices && typeof d.prices === 'object') state.prices = d.prices;
        if (d.fx && typeof d.fx === 'object') state.fx = d.fx;
        save();
        render();
      } catch (e) {
        alert('Invalid JSON');
      }
    });

    // PWA install prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      qs('#installBtn').hidden = false;
    });
    qs('#installBtn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      qs('#installBtn').hidden = true;
      deferredPrompt = null;
    });

    // register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }

    render();
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
