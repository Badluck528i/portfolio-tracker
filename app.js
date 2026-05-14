
(function(){
  const el = sel => document.querySelector(sel);
  const els = sel => Array.from(document.querySelectorAll(sel));
  const formatUSD = n => (isFinite(n) ? n : 0).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const formatPct = n => `${(isFinite(n)?n:0).toFixed(2)}%`;

  const STORAGE_KEY = 'pwa_portfolio_v1';
  let positions = load();

  // PWA install prompt handling
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    el('#installBtn').hidden = false;
  });
  el('#installBtn').addEventListener('click', async () => {
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice; // ignore result
    el('#installBtn').hidden = true;
    deferredPrompt = null;
  });

  // Service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(console.error);
    });
  }

  // Elements
  const form = el('#addForm');
  const list = el('#positions');
  const empty = el('#emptyState');
  const totalValueEl = el('#totalValue');
  const totalPLEl = el('#totalPL');
  const totalReturnEl = el('#totalReturn');
  const statusEl = el('#status');

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  }
  function load(){
    try{
      const v = localStorage.getItem(STORAGE_KEY);
      return v ? JSON.parse(v) : [];
    }catch(e){
      console.warn('Failed to load storage', e);
      return [];
    }
  }

  function addPosition(ticker, shares, price){
    ticker = (ticker||'').trim().toUpperCase();
    if(!ticker || !(shares>0) || !(price>0)) throw new Error('Invalid inputs');
    const existing = positions.find(p=>p.ticker===ticker);
    if(existing){
      // average in
      const totalShares = existing.shares + shares;
      const totalCost = existing.shares*existing.price + shares*price;
      existing.shares = totalShares;
      existing.price = totalCost/totalShares;
    }else{
      positions.push({ticker, shares, price});
    }
    save();
    render();
  }

  function removePosition(ticker){
    positions = positions.filter(p=>p.ticker!==ticker);
    save();
    render();
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = new FormData(form);
    try{
      addPosition(
        data.get('ticker'),
        parseFloat(data.get('shares')),
        parseFloat(data.get('price'))
      );
      form.reset();
    }catch(err){
      toast(err.message||'Could not add');
    }
  });

  function toast(msg){
    statusEl.textContent = msg;
    statusEl.style.color = 'var(--muted)';
    setTimeout(()=>statusEl.textContent='', 3000);
  }

  function badgeClass(val){
    return val>0 ? 'badge gain' : val<0 ? 'badge loss' : 'badge neutral';
  }

  function render(){
    list.innerHTML = '';
    empty.style.display = positions.length? 'none':'block';

    let totalValue = 0, totalCost = 0;

    positions.forEach(p=>{
      const li = document.createElement('li');
      li.className = 'list-item';

      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'actions';

      left.innerHTML = `
        <div class="ticker">${p.ticker}</div>
        <div class="meta small">${p.shares} @ ${formatUSD(p.price)} cost ${formatUSD(p.shares*p.price)}</div>
        <div class="meta small current" data-ticker="${p.ticker}">Live: —</div>
      `;

      const rm = document.createElement('button');
      rm.className = 'icon-btn danger';
      rm.textContent = 'Remove';
      rm.addEventListener('click', ()=>removePosition(p.ticker));

      right.appendChild(rm);

      li.appendChild(left);
      li.appendChild(right);

      list.appendChild(li);

      totalCost += p.shares*p.price;
    });

    totalValueEl.textContent = formatUSD(totalValue);
    totalPLEl.textContent = formatUSD(0);
    totalPLEl.className = 'neutral';
    totalReturnEl.textContent = formatPct(0);
    totalReturnEl.className = 'neutral';
  }

  async function fetchQuotes(tickers){
    if(!tickers.length) return {};
    // Use RapidAPI proxy or direct Yahoo query2.finance if CORS allows; we'll use a public endpoint that often works
    // Fallback JSONP is not ideal; we try query1.finance.yahoo.com v7 quote.
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('Price fetch failed');
    const data = await resp.json();
    const out = {};
    (data.quoteResponse?.result||[]).forEach(r=>{
      if(r.symbol) out[r.symbol.toUpperCase()] = r.regularMarketPrice ?? r.postMarketPrice ?? r.preMarketPrice ?? null;
    });
    return out;
  }

  async function refresh(){
    try{
      statusEl.textContent = 'Updating prices…';
      const tickers = positions.map(p=>p.ticker);
      const quotes = await fetchQuotes(tickers);

      let totalValue = 0, totalCost = 0;
      positions.forEach(p=>{
        const price = quotes[p.ticker];
        const curEl = document.querySelector(`.current[data-ticker="${p.ticker}"]`);
        if(price!=null){
          curEl.textContent = `Live: ${formatUSD(price)}`;
          const value = price * p.shares;
          totalValue += value;
          totalCost += p.shares*p.price;

          // show per-position P/L badge
          let badge = curEl.nextElementSibling;
          if(!badge || !badge.classList.contains('badge')){
            badge = document.createElement('span');
            curEl.parentElement.appendChild(badge);
          }
          const pl = value - (p.shares*p.price);
          badge.className = badgeClass(pl);
          badge.textContent = `${pl>=0?'+':''}${formatUSD(pl)} (${formatPct((pl/(p.shares*p.price))*100)})`;
        } else {
          curEl.textContent = 'Live: —';
        }
      });

      const totalPL = totalValue - totalCost;
      totalValueEl.textContent = formatUSD(totalValue||0);
      totalPLEl.textContent = `${totalPL>=0?'+':''}${formatUSD(totalPL||0)}`;
      totalPLEl.className = totalPL>0? 'gain' : totalPL<0? 'loss' : 'neutral';
      const ret = totalCost>0 ? (totalPL/totalCost)*100 : 0;
      totalReturnEl.textContent = formatPct(ret);
      totalReturnEl.className = ret>0? 'gain' : ret<0? 'loss' : 'neutral';

      statusEl.textContent = 'Prices updated';
      setTimeout(()=>statusEl.textContent='', 2500);
    }catch(err){
      console.error(err);
      statusEl.textContent = 'Could not update prices (network/CORS)';
      statusEl.style.color = 'var(--warning)';
    }
  }

  el('#refreshBtn').addEventListener('click', refresh);

  // Initial render
  render();
})();
