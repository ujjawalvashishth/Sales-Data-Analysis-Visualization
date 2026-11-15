(function(){
  "use strict";

  // ---------------- state ----------------
  let RAW = [];         // full parsed rows (array of objects)
  let COLUMNS = [];      // [{name, type, stats}]
  let FILE_NAME = "";
  const MAX_ANALYZE = 5000;

  // ---------------- dom refs ----------------
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const hero = document.getElementById('hero');
  const dashboard = document.getElementById('dashboard');
  const errorMsg = document.getElementById('error-msg');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const resetBtn = document.getElementById('reset-btn');

  // ---------------- tiny CSV parser (handles quoted fields, commas, newlines in quotes) ----------------
  function parseCSV(text){
    text = text.replace(/^\uFEFF/, ''); // strip BOM
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for(let i = 0; i < text.length; i++){
      const c = text[i], next = text[i+1];
      if(inQuotes){
        if(c === '"' && next === '"'){ field += '"'; i++; }
        else if(c === '"'){ inQuotes = false; }
        else { field += c; }
      } else {
        if(c === '"'){ inQuotes = true; }
        else if(c === ','){ row.push(field); field = ''; }
        else if(c === '\r'){ /* skip */ }
        else if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
        else { field += c; }
      }
    }
    if(field.length || row.length){ row.push(field); rows.push(row); }
    // drop trailing empty rows
    while(rows.length && rows[rows.length-1].length === 1 && rows[rows.length-1][0] === '') rows.pop();
    if(rows.length === 0) return [];
    const headers = rows[0].map(h => h.trim());
    const out = [];
    for(let r = 1; r < rows.length; r++){
      const cols = rows[r];
      if(cols.length === 1 && cols[0] === '') continue;
      const obj = {};
      headers.forEach((h, idx) => {
        let v = cols[idx] !== undefined ? cols[idx].trim() : '';
        if(v === ''){ obj[h] = ''; return; }
        const asNum = Number(v);
        obj[h] = (v !== '' && !isNaN(asNum) && /^-?[\d.]+$/.test(v)) ? asNum : v;
      });
      out.push(obj);
    }
    return out;
  }

  // ---------------- tiny canvas chart helpers (no external deps) ----------------
  function setupCanvas(canvas){
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawLineChart(canvas, labels, values, color, fillColor){
    const { ctx, w, h } = setupCanvas(canvas);
    if(!labels.length){ return; }
    const padL = 46, padR = 14, padT = 14, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxV = Math.max(...values, 0), minV = Math.min(...values, 0);
    const range = (maxV - minV) || 1;

    ctx.strokeStyle = '#B9CCB1'; ctx.lineWidth = 1; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = '#8A9C8E';
    const gridLines = 4;
    for(let i = 0; i <= gridLines; i++){
      const y = padT + (plotH * i / gridLines);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      const val = maxV - (range * i / gridLines);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtNum(val), padL - 8, y);
    }

    const stepX = labels.length > 1 ? plotW / (labels.length - 1) : 0;
    const pts = values.map((v, i) => ({
      x: padL + stepX * i,
      y: padT + plotH - ((v - minV) / range) * plotH
    }));

    // fill
    ctx.beginPath();
    ctx.moveTo(pts[0].x, padT + plotH);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length-1].x, padT + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // line
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // points
    ctx.fillStyle = color;
    pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI*2); ctx.fill(); });

    // x labels (sparse)
    ctx.fillStyle = '#8A9C8E'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const maxLabels = Math.min(labels.length, Math.floor(plotW / 60) || 1);
    const stride = Math.max(1, Math.ceil(labels.length / maxLabels));
    labels.forEach((lab, i) => {
      if(i % stride !== 0 && i !== labels.length-1) return;
      const short = String(lab).length > 9 ? String(lab).slice(0,9) : String(lab);
      ctx.fillText(short, padL + stepX * i, padT + plotH + 8);
    });
  }

  function drawDonutChart(canvas, labels, values, colors){
    const { ctx, w, h } = setupCanvas(canvas);
    const total = values.reduce((a,b)=>a+b,0);
    if(total <= 0) return;
    const legendH = 20 * Math.ceil(labels.length / 2) + 10;
    const cx = w/2, cy = (h - legendH)/2 + 6;
    const radius = Math.max(20, Math.min(cx, cy) - 8);
    const inner = radius * 0.6;
    let start = -Math.PI/2;

    labels.forEach((lab, i) => {
      const slice = (values[i] / total) * Math.PI * 2;
      const end = start + slice;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      start = end;
    });
    // inner cutout
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // legend
    const legendY = h - legendH + 12;
    const colW = w / 2;
    ctx.font = '11px Inter, sans-serif'; ctx.textBaseline = 'middle';
    labels.forEach((lab, i) => {
      const col = i % 2, r = Math.floor(i/2);
      const lx = 6 + col * colW, ly = legendY + r * 20;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(lx, ly - 4, 8, 8);
      ctx.fillStyle = '#8A9C8E'; ctx.textAlign = 'left';
      const label = String(lab).length > 14 ? String(lab).slice(0,13)+'…' : String(lab);
      ctx.fillText(label, lx + 12, ly);
    });
  }

  // ---------------- file handling ----------------
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fileInput.click(); } });
  ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if(f) handleFile(f); });
  fileInput.addEventListener('change', e => { const f = e.target.files[0]; if(f) handleFile(f); });
  resetBtn.addEventListener('click', () => {
    RAW = []; COLUMNS = []; FILE_NAME = "";
    fileInput.value = "";
    dashboard.style.display = 'none';
    hero.classList.remove('compact');
    resetBtn.style.display = 'none';
    statusDot.classList.remove('on');
    statusText.textContent = 'no file loaded';
    errorMsg.style.display = 'none';
  });

  function showError(msg){
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
  }

  function handleFile(file){
    errorMsg.style.display = 'none';
    if(!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv'){
      showError('That doesn\'t look like a CSV file. Please choose a .csv file.');
      return;
    }
    statusText.textContent = 'parsing…';
    const reader = new FileReader();
    reader.onload = function(e){
      try{
        const data = parseCSV(e.target.result);
        if(!data || data.length === 0){
          showError('No rows found in that file.');
          statusText.textContent = 'no file loaded';
          return;
        }
        FILE_NAME = file.name;
        RAW = data;
        analyze();
      } catch(err){
        showError('Could not parse this file: ' + err.message);
        statusText.textContent = 'no file loaded';
      }
    };
    reader.onerror = function(){
      showError('Could not read this file.');
      statusText.textContent = 'no file loaded';
    };
    reader.readAsText(file);
  }

  // ---------------- analysis ----------------
  function isDateLike(v){
    if(typeof v !== 'string') return false;
    if(/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) return true;
    if(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) return true;
    if(/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(v)) return true;
    const t = Date.parse(v);
    return !isNaN(t) && v.length >= 6;
  }

  function toDate(v){
    if(v instanceof Date) return v;
    const t = Date.parse(v);
    return isNaN(t) ? null : new Date(t);
  }

  function detectType(values){
    const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
    if(nonNull.length === 0) return 'empty';
    const numCount = nonNull.filter(v => typeof v === 'number' && isFinite(v)).length;
    if(numCount / nonNull.length > 0.85) return 'numeric';
    const dateCount = nonNull.filter(v => isDateLike(v)).length;
    if(dateCount / nonNull.length > 0.85) return 'date';
    return 'categorical';
  }

  function mean(arr){ return arr.reduce((a,b)=>a+b,0) / arr.length; }
  function median(arr){
    const s = [...arr].sort((a,b)=>a-b);
    const mid = Math.floor(s.length/2);
    return s.length % 2 ? s[mid] : (s[mid-1]+s[mid])/2;
  }
  function stddev(arr, m){
    if(arr.length < 2) return 0;
    const v = arr.reduce((a,b)=>a+(b-m)*(b-m),0) / (arr.length-1);
    return Math.sqrt(v);
  }

  function fmtNum(n){
    if(n === null || n === undefined || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if(abs >= 1e9) return (n/1e9).toFixed(2)+'B';
    if(abs >= 1e6) return (n/1e6).toFixed(2)+'M';
    if(abs >= 1e3) return (n/1e3).toFixed(2)+'K';
    if(Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
  }

  function analyze(){
    const sample = RAW.length > MAX_ANALYZE ? RAW.slice(0, MAX_ANALYZE) : RAW;
    document.getElementById('fb-truncated').style.display = RAW.length > MAX_ANALYZE ? 'inline' : 'none';

    const colNames = Object.keys(RAW[0] || {});
    COLUMNS = colNames.map(name => {
      const values = sample.map(r => r[name]);
      const type = detectType(values);
      const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
      const missing = values.length - nonNull.length;
      const missingPct = (missing / values.length) * 100;
      const col = { name, type, missing, missingPct, count: values.length };

      if(type === 'numeric'){
        const nums = nonNull.filter(v => typeof v === 'number');
        const m = mean(nums);
        col.stats = {
          mean: m, median: median(nums), min: Math.min(...nums), max: Math.max(...nums),
          std: stddev(nums, m), sum: nums.reduce((a,b)=>a+b,0)
        };
        col.unique = new Set(nums).size;
      } else if(type === 'date'){
        const dates = nonNull.map(toDate).filter(Boolean);
        col.stats = { min: new Date(Math.min(...dates)), max: new Date(Math.max(...dates)) };
        col.unique = new Set(nonNull).size;
      } else if(type === 'categorical'){
        const freq = {};
        nonNull.forEach(v => { freq[v] = (freq[v]||0)+1; });
        col.freq = freq;
        col.unique = Object.keys(freq).length;
      } else {
        col.unique = 0;
      }
      return col;
    });

    const seen = new Set();
    let dupes = 0;
    sample.forEach(r => {
      const key = JSON.stringify(r);
      if(seen.has(key)) dupes++; else seen.add(key);
    });

    renderFileBar();
    renderKPIs(dupes, sample.length);
    renderSummaryTable();
    setupControls();
    renderInsights(dupes, sample.length);
    renderPreview();

    hero.classList.add('compact');
    dashboard.style.display = 'block';
    resetBtn.style.display = 'inline-block';
    statusDot.classList.add('on');
    statusText.textContent = 'file loaded';

    requestAnimationFrame(renderCharts);
  }

  function renderFileBar(){
    document.getElementById('fb-name').textContent = FILE_NAME;
    document.getElementById('fb-rows').textContent = RAW.length.toLocaleString();
    document.getElementById('fb-cols').textContent = COLUMNS.length;
  }

  function renderKPIs(dupes, sampleSize){
    const numericCols = COLUMNS.filter(c => c.type === 'numeric');
    const totalMissing = COLUMNS.reduce((a,c) => a + c.missing, 0);
    const totalCells = COLUMNS.reduce((a,c) => a + c.count, 0);
    const completeness = totalCells ? (100 - (totalMissing/totalCells)*100) : 100;

    const cards = [
      { tag:'CH.01', value: RAW.length.toLocaleString(), label:'rows', cls:'' },
      { tag:'CH.02', value: COLUMNS.length, label:'columns', cls:'teal' },
      { tag:'CH.03', value: completeness.toFixed(1)+'%', label:'data completeness', cls:'' },
      { tag:'CH.04', value: dupes.toLocaleString(), label:'duplicate rows (sampled)', cls:'teal' },
    ];
    if(numericCols.length){
      cards[3] = { tag:'CH.04', value: fmtNum(numericCols[0].stats.sum), label:'sum of ' + numericCols[0].name, cls:'' };
    }

    const grid = document.getElementById('kpi-grid');
    grid.innerHTML = cards.map(c => `
      <div class="card">
        <div class="ch-corner tl"></div><div class="ch-corner br"></div>
        <span class="ch-tag">${c.tag}</span>
        <div class="kpi-value ${c.cls}">${c.value}</div>
        <div class="kpi-label">${c.label}</div>
      </div>
    `).join('');
  }

  function renderSummaryTable(){
    const tbody = document.getElementById('summary-tbody');
    tbody.innerHTML = COLUMNS.map(c => {
      const s = c.stats || {};
      const row = c.type === 'numeric' ? {
        mean: fmtNum(s.mean), median: fmtNum(s.median), min: fmtNum(s.min), max: fmtNum(s.max), std: fmtNum(s.std)
      } : c.type === 'date' ? {
        mean:'—', median:'—', min: s.min ? s.min.toISOString().slice(0,10) : '—', max: s.max ? s.max.toISOString().slice(0,10) : '—', std:'—'
      } : { mean:'—', median:'—', min:'—', max:'—', std:'—' };

      return `<tr>
        <td class="name-cell">${c.name}</td>
        <td><span class="type-badge ${c.type}">${c.type}</span></td>
        <td>${c.missingPct.toFixed(1)}%</td>
        <td>${c.unique ?? '—'}</td>
        <td>${row.mean}</td>
        <td>${row.median}</td>
        <td>${row.min}</td>
        <td>${row.max}</td>
        <td>${row.std}</td>
      </tr>`;
    }).join('');
  }

  function setupControls(){
    const numericCols = COLUMNS.filter(c => c.type === 'numeric');
    const dateCols = COLUMNS.filter(c => c.type === 'date');
    const catCols = COLUMNS.filter(c => c.type === 'categorical' && c.unique >= 2 && c.unique <= 20);

    const selTrend = document.getElementById('sel-trend');
    const selGroup = document.getElementById('sel-group');
    const selCat = document.getElementById('sel-cat');

    selTrend.innerHTML = numericCols.map(c => `<option value="${c.name}">${c.name}</option>`).join('') || '<option>—</option>';
    selGroup.innerHTML = (dateCols.length ? dateCols : catCols).map(c => `<option value="${c.name}">${c.name}</option>`).join('') || '<option>—</option>';
    selCat.innerHTML = catCols.map(c => `<option value="${c.name}">${c.name}</option>`).join('') || '<option>—</option>';

    selTrend.onchange = renderCharts;
    selGroup.onchange = renderCharts;
    selCat.onchange = renderCharts;

    document.querySelector('label[for="sel-trend"]').parentElement.style.display = numericCols.length ? '' : 'none';
    document.querySelector('label[for="sel-group"]').parentElement.style.display = (dateCols.length || catCols.length) ? '' : 'none';
    document.querySelector('label[for="sel-cat"]').parentElement.style.display = catCols.length ? '' : 'none';
  }

  function groupKey(val, isDate){
    if(isDate){
      const d = toDate(val);
      if(!d) return null;
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    }
    return val;
  }

  function renderCharts(){
    const numericCols = COLUMNS.filter(c => c.type === 'numeric');
    const dateCols = COLUMNS.filter(c => c.type === 'date');
    const catCols = COLUMNS.filter(c => c.type === 'categorical' && c.unique >= 2 && c.unique <= 20);

    const trendMetric = document.getElementById('sel-trend').value;
    const groupCol = document.getElementById('sel-group').value;
    const catCol = document.getElementById('sel-cat').value;
    const isDateGroup = dateCols.some(c => c.name === groupCol);

    document.getElementById('trend-title').textContent = trendMetric ? (trendMetric + ' by ' + (groupCol || '—')) : 'Trend over time';
    document.getElementById('cat-title').textContent = catCol ? ('Composition by ' + catCol) : 'Composition';

    const trendCanvas = document.getElementById('trend-chart');
    if(trendMetric && groupCol){
      const buckets = {};
      RAW.forEach(r => {
        const k = groupKey(r[groupCol], isDateGroup);
        const v = r[trendMetric];
        if(k === null || k === undefined || k === '' || typeof v !== 'number') return;
        if(!buckets[k]) buckets[k] = [];
        buckets[k].push(v);
      });
      let keys = Object.keys(buckets);
      keys.sort();
      if(!isDateGroup){
        keys = keys.sort((a,b) => buckets[b].reduce((x,y)=>x+y,0) - buckets[a].reduce((x,y)=>x+y,0)).slice(0,12);
      }
      const dataPts = keys.map(k => buckets[k].reduce((a,b)=>a+b,0));
      drawLineChart(trendCanvas, keys, dataPts, '#93691F', 'rgba(147,105,31,0.12)');
    } else {
      setupCanvas(trendCanvas);
    }

    const catCanvas = document.getElementById('cat-chart');
    if(catCol){
      const col = COLUMNS.find(c => c.name === catCol);
      const entries = Object.entries(col.freq).sort((a,b) => b[1]-a[1]);
      const top = entries.slice(0,7);
      const rest = entries.slice(7).reduce((a,[,v]) => a+v, 0);
      const labels = top.map(e => String(e[0]));
      const values = top.map(e => e[1]);
      if(rest > 0){ labels.push('Other'); values.push(rest); }
      const palette = ['#93691F','#2C6A4E','#A23A2C','#8A9C8E','#C99A3F','#4C8A6C','#B96654','#51665A'];
      drawDonutChart(catCanvas, labels, values, palette);
    } else {
      setupCanvas(catCanvas);
    }
  }

  window.addEventListener('resize', () => {
    if(dashboard.style.display === 'block') renderCharts();
  });

  function renderInsights(dupes, sampleSize){
    const panel = document.getElementById('insights-panel');
    const items = [];

    const worstMissing = [...COLUMNS].filter(c=>c.missing>0).sort((a,b)=>b.missingPct-a.missingPct)[0];
    if(worstMissing){
      items.push({ tick:'rose', html: `<b>${worstMissing.name}</b> has the most gaps — ${worstMissing.missingPct.toFixed(1)}% of values are missing.` });
    } else {
      items.push({ tick:'teal', html: `No missing values detected across ${COLUMNS.length} columns — the dataset is fully populated.` });
    }

    if(dupes > 0){
      items.push({ tick:'rose', html: `Found <b>${dupes.toLocaleString()}</b> duplicate row${dupes===1?'':'s'} in the ${sampleSize.toLocaleString()} rows checked.` });
    }

    const dateCols = COLUMNS.filter(c => c.type === 'date');
    const numericCols = COLUMNS.filter(c => c.type === 'numeric');
    if(dateCols.length && numericCols.length){
      const dCol = dateCols[0].name, nCol = numericCols[0].name;
      const points = RAW.map(r => ({ d: toDate(r[dCol]), v: r[nCol] }))
        .filter(p => p.d && typeof p.v === 'number')
        .sort((a,b) => a.d - b.d);
      if(points.length >= 4){
        const half = Math.floor(points.length/2);
        const firstAvg = mean(points.slice(0,half).map(p=>p.v));
        const secondAvg = mean(points.slice(half).map(p=>p.v));
        const change = firstAvg !== 0 ? ((secondAvg-firstAvg)/Math.abs(firstAvg))*100 : 0;
        const dir = change >= 0 ? 'risen' : 'fallen';
        items.push({ tick: change>=0?'amber':'rose', html: `<b>${nCol}</b> has ${dir} ${Math.abs(change).toFixed(1)}% comparing the first half of the timeline to the second half.` });
      }
    }

    const catCols = COLUMNS.filter(c => c.type === 'categorical' && c.unique >= 2 && c.unique <= 20);
    if(catCols.length){
      const col = catCols[0];
      const entries = Object.entries(col.freq).sort((a,b)=>b[1]-a[1]);
      const [topVal, topCount] = entries[0];
      const pct = (topCount / Object.values(col.freq).reduce((a,b)=>a+b,0)) * 100;
      items.push({ tick:'teal', html: `<b>${topVal}</b> is the most common value in <b>${col.name}</b>, covering ${pct.toFixed(1)}% of rows.` });
    }

    if(numericCols.length){
      const c = numericCols[0];
      const { mean:m, std } = c.stats;
      if(std > 0){
        const outliers = RAW.filter(r => typeof r[c.name] === 'number' && Math.abs(r[c.name]-m) > 2*std).length;
        if(outliers > 0){
          items.push({ tick:'amber', html: `${outliers} row${outliers===1?'':'s'} fall more than 2 standard deviations from the mean in <b>${c.name}</b> — worth a closer look.` });
        }
      }
    }

    if(items.length === 0){
      items.push({ tick:'teal', html: 'Dataset loaded. Add more numeric or date columns to unlock trend insights.' });
    }

    panel.innerHTML = items.map(it => `
      <div class="insight-row">
        <div class="insight-tick ${it.tick}"></div>
        <div class="insight-text">${it.html}</div>
      </div>
    `).join('');
  }

  function renderPreview(){
    const cols = COLUMNS.map(c => c.name);
    const thead = document.getElementById('preview-thead');
    thead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';

    function draw(filterText){
      let rows = RAW;
      if(filterText){
        const ft = filterText.toLowerCase();
        rows = RAW.filter(r => cols.some(c => String(r[c] ?? '').toLowerCase().includes(ft)));
      }
      const shown = rows.slice(0, 20);
      document.getElementById('preview-tbody').innerHTML = shown.map(r =>
        '<tr>' + cols.map(c => `<td>${r[c] === null || r[c] === undefined ? '' : r[c]}</td>`).join('') + '</tr>'
      ).join('');
      document.getElementById('preview-note').textContent = `showing ${shown.length} of ${rows.length.toLocaleString()} matching rows`;
    }
    draw('');
    document.getElementById('preview-search').oninput = e => draw(e.target.value);
  }

})();