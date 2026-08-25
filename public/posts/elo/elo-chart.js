// Shared chart engine for the ELO coaching-era posts.
// Each post loads a per-club config file first, defining
// window.ELO_CONFIG = { theme, coaches, data }.
const { data: D, coaches } = window.ELO_CONFIG;

// ─── Theme ───
const T = Object.assign({
  ink: '#14161A',
  muted: '#8A8A82',
  faint: '#B0B0A8',
  grid: '#ECECE6',
  axis: '#C9C9C2'
}, window.ELO_CONFIG.theme);

// ─── Setup ───
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const ttEl = document.getElementById('tt');

const PAD = { top: 40, right: 20, bottom: 42, left: 56 };
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let V = D, vals = D.map(d => d[1]);
let yLo = 950, yHi = 2100, yStep = 200;
let dpr, W, H, pL, pR, pT, pB;
let hoverIdx = -1;
let prog = 1;
let anim = null;

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pL = PAD.left; pR = W - PAD.right;
  pT = PAD.top; pB = H - PAD.bottom;
}

function xOf(i) { return pL + (i / (V.length - 1)) * (pR - pL); }
function yOf(v) { return pB - ((v - yLo) / (yHi - yLo)) * (pB - pT); }
function coachOf(date) { return coaches.find(c => date >= c.start && date <= c.end); }

function setDomain() {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 + 20;
  yLo = Math.floor((lo - pad) / 50) * 50;
  yHi = Math.ceil((hi + pad) / 50) * 50;
  const span = yHi - yLo;
  yStep = span > 700 ? 200 : span > 300 ? 100 : 50;
}

// ─── Range picker ───
function cutoffFor(key) {
  const last = D[D.length - 1][0];
  const y = parseInt(last.substring(0, 4));
  if (key === 'all') return '0000';
  if (key === 'season') return y + '-01-01';
  const n = { '10y': 10, '5y': 5, '3y': 3 }[key];
  return (y - n) + last.substring(4);
}

function setRange(key) {
  const cut = cutoffFor(key);
  let i0 = D.findIndex(d => d[0] >= cut);
  if (i0 < 0) i0 = 0;
  V = D.slice(i0);
  vals = V.map(d => d[1]);
  hoverIdx = -1;
  ttEl.classList.remove('show');
  setDomain();
  document.querySelectorAll('.picker button').forEach(b => {
    const on = b.dataset.range === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  reveal(key === 'all' ? 1100 : 450);
}

function reveal(dur) {
  if (anim) cancelAnimationFrame(anim);
  if (REDUCED) { prog = 1; draw(); return; }
  prog = 0;
  const t0 = performance.now();
  (function tick(t) {
    const u = Math.min(1, (t - t0) / dur);
    prog = 1 - Math.pow(1 - u, 3);
    draw();
    if (u < 1) anim = requestAnimationFrame(tick);
  })(t0);
}

document.querySelectorAll('.picker button').forEach(b =>
  b.addEventListener('click', () => setRange(b.dataset.range)));

// ─── Draw ───
function draw() {
  ctx.clearRect(0, 0, W, H);

  // Coaching era bands + labels
  coaches.forEach((c, ci) => {
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < V.length; i++) {
      if (V[i][0] >= c.start && V[i][0] <= c.end) {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
      }
    }
    if (firstIdx === -1) return;
    const x1 = firstIdx > 0 ? (xOf(firstIdx) + xOf(firstIdx - 1)) / 2 : pL;
    const x2 = lastIdx < V.length - 1 ? (xOf(lastIdx) + xOf(lastIdx + 1)) / 2 : pR;
    const bandW = x2 - x1;

    ctx.fillStyle = ci % 2 ? T.bandB : T.bandA;
    ctx.fillRect(x1, pT, bandW, pB - pT);

    if (ci > 0 && firstIdx > 0) {
      ctx.strokeStyle = T.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, pT);
      ctx.lineTo(x1, pB);
      ctx.stroke();
    }

    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    let nameW = ctx.measureText(c.name).width;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = T.muted;
    if (bandW > nameW + 8) {
      ctx.fillText(c.name, x1 + 5, pT + 6);
    } else {
      ctx.font = "500 8px 'IBM Plex Mono', monospace";
      nameW = ctx.measureText(c.name).width;
      if (bandW > nameW + 4) ctx.fillText(c.name, x1 + 3, pT + 6);
    }
  });

  // Y grid + labels
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(yLo / yStep) * yStep; v <= yHi; v += yStep) {
    const y = yOf(v);
    ctx.strokeStyle = T.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pL, y);
    ctx.lineTo(pR, y);
    ctx.stroke();
    if (v === 1500) continue;
    ctx.fillStyle = T.muted;
    ctx.fillText(v.toString(), pL - 8, y);
  }
  if (yLo < 1500 && 1500 < yHi) {
    const avgY = yOf(1500);
    ctx.fillStyle = T.ink;
    ctx.font = "600 10px 'IBM Plex Mono', monospace";
    ctx.fillText('1500', pL - 8, avgY);
    ctx.font = "400 8px 'IBM Plex Mono', monospace";
    ctx.fillStyle = T.muted;
    ctx.fillText('avg', pL - 8, avgY + 11);
  }

  // X axis
  ctx.strokeStyle = T.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pL, pB);
  ctx.lineTo(pR, pB);
  ctx.stroke();

  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.fillStyle = T.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const spanYears = parseInt(V[V.length - 1][0].substring(0, 4)) - parseInt(V[0][0].substring(0, 4));
  const tick = (x, label) => {
    ctx.strokeStyle = T.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pB);
    ctx.lineTo(x, pB + 4);
    ctx.stroke();
    ctx.fillText(label, x, pB + 7);
  };
  if (spanYears >= 2) {
    const every = spanYears > 20 ? 5 : spanYears > 6 ? 2 : 1;
    let lastYr = '';
    for (let i = 0; i < V.length; i++) {
      const yr = V[i][0].substring(0, 4);
      if (yr !== lastYr) {
        lastYr = yr;
        if (parseInt(yr) % every === 0) tick(xOf(i), yr);
      }
    }
  } else {
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let lastKey = '';
    for (let i = 0; i < V.length; i++) {
      const key = V[i][0].substring(0, 7);
      if (key !== lastKey) {
        lastKey = key;
        tick(xOf(i), MON[parseInt(key.substring(5)) - 1]);
      }
    }
  }

  // 1500 baseline
  if (yLo < 1500 && 1500 < yHi) {
    const bY = yOf(1500);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = T.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pL, bY);
    ctx.lineTo(pR, bY);
    ctx.stroke();
    ctx.restore();
  }

  // Progressive reveal cutoff
  const lastF = prog * (V.length - 1);
  const lastI = Math.floor(lastF);
  const frac = lastF - lastI;
  const pointAt = i => [xOf(i), yOf(vals[i])];
  const tip = () => {
    if (lastI >= V.length - 1) return pointAt(V.length - 1);
    const [x1, y1] = pointAt(lastI), [x2, y2] = pointAt(lastI + 1);
    return [x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac];
  };

  // Area fill
  const grad = ctx.createLinearGradient(0, pT, 0, pB);
  grad.addColorStop(0, T.line + '1F');
  grad.addColorStop(0.65, T.line + '08');
  grad.addColorStop(1, T.line + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(xOf(0), pB);
  for (let i = 0; i <= lastI; i++) ctx.lineTo(...pointAt(i));
  const [tx, ty] = tip();
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx, pB);
  ctx.closePath();
  ctx.fill();

  // Main line
  ctx.strokeStyle = T.line;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= lastI; i++) {
    const [x, y] = pointAt(i);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.lineTo(tx, ty);
  ctx.stroke();

  if (prog < 1) return;

  // Annotations: peak + trough
  const peakIdx = vals.indexOf(Math.max(...vals));
  const troughIdx = vals.indexOf(Math.min(...vals));
  annotate(peakIdx, Math.round(vals[peakIdx]).toLocaleString(), 'above');
  if (troughIdx !== peakIdx) {
    annotate(troughIdx, Math.round(vals[troughIdx]).toLocaleString(), xOf(troughIdx) - pL < 90 ? 'right' : 'left');
  }

  // Hover
  if (hoverIdx >= 0) {
    const hx = xOf(hoverIdx), hy = yOf(vals[hoverIdx]);
    ctx.strokeStyle = T.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, pT);
    ctx.lineTo(hx, pB);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = T.line;
    ctx.stroke();
  }
}

function annotate(idx, label, placement) {
  const x = xOf(idx), y = yOf(vals[idx]);
  const yr = V[idx][0].substring(0, 4);
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = T.accent;
  ctx.fill();
  ctx.save();
  ctx.font = "600 11px 'IBM Plex Mono', monospace";
  ctx.fillStyle = T.ink;
  if (placement === 'above') {
    ctx.textAlign = x > pR - 40 ? 'right' : x < pL + 40 ? 'left' : 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x, y - 10);
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = T.muted;
    ctx.fillText(yr, x, y - 23);
  } else if (placement === 'left') {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x - 10, y);
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = T.muted;
    ctx.fillText(yr, x - 10, y + 13);
  } else {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 10, y);
    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = T.muted;
    ctx.fillText(yr, x + 10, y + 13);
  }
  ctx.restore();
}

// ─── Hover interaction ───
function handlePointer(clientX) {
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < V.length; i++) {
    const d = Math.abs(xOf(i) - mx);
    if (d < bestD) { bestD = d; best = i; }
  }
  const idx = bestD < 25 ? best : -1;
  if (idx === hoverIdx) return;
  hoverIdx = idx;
  draw();

  if (idx >= 0) {
    const date = new Date(V[idx][0]);
    document.getElementById('td').textContent = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('te').textContent = Math.round(vals[idx]);
    const coach = coachOf(V[idx][0]);
    document.getElementById('tc').textContent = coach ? coach.name.replace('*', '') : '';
    const diff = Math.round(vals[idx] - 1500);
    document.getElementById('tv').textContent = (diff >= 0 ? '+' : '') + diff + ' vs baseline';

    const px = xOf(idx), py = yOf(vals[idx]);
    let left = px + 18, top = py - 30;
    if (left + 170 > W) left = px - 185;
    if (top < 10) top = py + 18;
    ttEl.style.left = left + 'px';
    ttEl.style.top = top + 'px';
    ttEl.classList.add('show');
  } else {
    ttEl.classList.remove('show');
  }
}

canvas.addEventListener('mousemove', e => { if (prog === 1) handlePointer(e.clientX); });
canvas.addEventListener('mouseleave', () => {
  hoverIdx = -1;
  ttEl.classList.remove('show');
  draw();
});
canvas.addEventListener('touchmove', e => {
  if (prog < 1) return;
  e.preventDefault();
  handlePointer(e.touches[0].clientX);
}, { passive: false });
canvas.addEventListener('touchend', () => {
  hoverIdx = -1;
  ttEl.classList.remove('show');
  draw();
});

// ─── Init ───
resize();
setRange('all');
window.addEventListener('resize', () => { resize(); draw(); });
