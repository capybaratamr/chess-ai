// Chess AI - Build 9 add-on.
// Loads your existing app.js, adds the new features to it, then runs it.
// New: Stockfish-powered Blurple review, win-chance accuracy, Hint button, Copy PGN button.
// If anything goes wrong, it falls back to the plain original app.js.

const BASE = './app.js?v=8';

/* ---- New functions (injected into app.js, so they can use its variables) ---- */
function sfDrain() {
  return new Promise((resolve) => {
    const w = stockfish.worker, prev = w.onmessage;
    const t = setTimeout(() => { w.onmessage = prev; resolve(); }, 1500);
    w.onmessage = (ev) => { if (String(ev.data) === 'readyok') { clearTimeout(t); w.onmessage = prev; resolve(); } };
    w.postMessage('stop');
    w.postMessage('isready');
  });
}
async function sfAnalyze(fen, ms = 150) {
  await sfDrain();
  return new Promise((resolve) => {
    const w = stockfish.worker, prev = w.onmessage;
    let cp = 0, mate = null;
    const t = setTimeout(() => { w.onmessage = prev; w.postMessage('stop'); resolve(null); }, ms + 3000);
    w.onmessage = (ev) => {
      const line = String(ev.data);
      if (line.startsWith('info ')) {
        const c = line.match(/score cp (-?\d+)/), m = line.match(/score mate (-?\d+)/);
        if (c) { cp = +c[1]; mate = null; } else if (m) mate = +m[1];
      }
      if (line.startsWith('bestmove')) {
        clearTimeout(t); w.onmessage = prev;
        resolve({ uci: line.split(' ')[1], cp: mate !== null ? (mate > 0 ? 10000 - mate : -10000 - mate) : cp });
      }
    };
    w.postMessage('setoption name MultiPV value 1');
    w.postMessage('position fen ' + fen);
    w.postMessage('go movetime ' + ms);
  });
}
async function runStockfishReview(history) {
  await ensureStockfish();
  const c = new Chess(), out = [];
  for (let i = 0; i <= history.length; i++) {
    out.push(c.isGameOver() ? null : await sfAnalyze(c.fen(), 120));
    if (i < history.length) c.move(toMoveInput(history[i]));
  }
  return out;
}
function playedFromSf(chess, next, mover) {
  if (chess.isCheckmate()) return 10000;
  if (chess.isDraw()) return 0;
  return next ? -next.cp : evaluatePosition(chess, mover);
}
function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(-1500, 1500, cp))) - 1);
}
function copyPgn() {
  const pgn = game.pgn();
  if (!pgn) { showToast('Make a move first.'); return; }
  navigator.clipboard.writeText(pgn).then(
    () => showToast('Game copied as PGN.'),
    () => showToast('Could not copy automatically.')
  );
}

function proClass(k) {
  return ({ brilliant:['!!','#1baca6','Brilliant','a brilliant move'], great:['!','#5c8bb0','Great','a great move'], best:['★','#81b64c','Best','the best move'],
    excellent:['✓','#96bc4b','Excellent','an excellent move'], good:['✓','#97af8b','Good','a good move'], book:['♞','#a88865','Book','a book move'],
    inaccuracy:['?!','#f7c631','Inaccuracy','an inaccuracy'], mistake:['?','#ffa459','Mistake','a mistake'], miss:['✗','#ff7769','Miss','a miss'], blunder:['??','#fa412d','Blunder','a blunder'] })[k] || ['•','#999','Move','a move'];
}
function proArrow(from, to, color) {
  const [x1, y1] = squareCenterPercent(from), [x2, y2] = squareCenterPercent(to);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const ex = x2 - ux * 4, ey = y2 - uy * 4, px = -uy, py = ux;
  return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" opacity=".85"/><polygon points="${x2 - ux * .8},${y2 - uy * .8} ${ex + px * 2.4},${ey + py * 2.4} ${ex - px * 2.4},${ey - py * 2.4}" fill="${color}" opacity=".9"/>`;
}
async function openProReview() {
  closeModal('resultModal');
  showToast('Blurple is analyzing your game…');
  try { if (!currentReview) currentReview = await analyzeCompletedGame(); } catch (e) { console.error(e); showToast('Review unavailable.'); return; }
  const rv = currentReview, all = rv.all || [];
  if (!all.length) { showToast('Nothing to review yet.'); return; }
  document.getElementById('proReview')?.remove();
  const el = document.createElement('div'); el.id = 'proReview'; el.className = 'pr';
  document.body.appendChild(el);
  let idx = 0;
  const oppName = OPPONENTS[difficulty].name, flip = playerColor === 'b';
  const keys = ['brilliant','great','best','excellent','good','book','inaccuracy','mistake','miss','blunder'];
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const go = (i) => { idx = clamp(0, all.length - 1, i); draw(); };
  function onKey(e) {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); go(idx + (e.key === 'ArrowLeft' ? -1 : 1)); }
  }
  document.addEventListener('keydown', onKey, true);
  function draw() {
    const r = all[idx], [ic, col, , phrase] = proClass(r.classification);
    const chess = new Chess();
    for (let i = 0; i <= idx; i++) chess.move(toMoveInput(all[i].move));
    const ranks = flip ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1], files = flip ? [...FILES].reverse() : FILES;
    let sq = '';
    ranks.forEach(rank => files.forEach(file => {
      const n = file + rank, p = chess.get(n);
      sq += `<div class="pr-sq ${(FILES.indexOf(file) + rank) % 2 === 1 ? 'd' : 'l'} ${n === r.from || n === r.to ? 'hl' : ''}">${p ? pieceMarkup(p.type, p.color, 'auto') : ''}</div>`;
    }));
    const showBest = ['inaccuracy','mistake','miss','blunder'].includes(r.classification) && r.bestMove && r.bestMove.san !== r.move.san;
    const mood = { brilliant: 'laugh', great: 'happy', best: 'happy', excellent: 'smile', good: 'smile', book: 'smile', inaccuracy: 'idle', mistake: 'sad', miss: 'sad', blunder: 'scared' }[r.classification] || 'smile';
    const op = openingFor(all.slice(0, idx + 1).map(m => m.move.san));
    const [bx, by] = squareCenterPercent(r.to);
    const arrows = (showBest ? proArrow(r.bestMove.from, r.bestMove.to, '#81b64c') : '') + proArrow(r.from, r.to, col);
    const wp = winPct(r.evalW), n = all.length;
    const pts = all.map((m, i) => `${n > 1 ? i / (n - 1) * 300 : 0},${60 - winPct(m.evalW) * .6}`).join(' ');
    const cx = n > 1 ? idx / (n - 1) * 300 : 0;
    const card = (name, b) => `<div class="pr-card"><div class="pr-name">${name}</div><div class="pr-acc">${b.accuracy.toFixed(1)}%</div><div class="pr-sub">Accuracy · est. rating ${b.rating}</div></div>`;
    const rows = keys.map(k => { const [i2, c2, nm] = proClass(k); return `<div class="pr-row"><b style="color:${c2}">${rv.player.counts[k] || 0}</b><span><i style="background:${c2}">${i2}</i>${nm}</span><b style="color:${c2}">${rv.ai.counts[k] || 0}</b></div>`; }).join('');
    const chips = all.map((m, i) => { const [i3, c3] = proClass(m.classification); return `<button class="pr-chip ${i === idx ? 'on' : ''}" data-i="${i}" style="--c:${c3}">${m.mover === 'w' ? Math.ceil(m.plyNumber / 2) + '.' : ''}${m.move.san}<em>${i3}</em></button>`; }).join('');
    el.innerHTML = `<div class="pr-head"><div><div class="eyebrow">GAME REVIEW</div><h2>Blurple’s Review</h2></div><div class="pr-head-btns"><button class="secondary-button" id="prPgn">Copy PGN</button><button class="secondary-button" id="prClose">Close ✕</button></div></div>
      <div class="pr-cards">${card('You', rv.player)}${card(oppName, rv.ai)}</div>
      <div class="pr-main">
        <div class="pr-bar ${flip ? 'flip' : ''}"><div style="height:${wp}%"></div></div>
        <div class="pr-boardwrap"><div class="pr-board">${sq}<svg viewBox="0 0 100 100">${arrows}</svg><div class="pr-badge" style="left:${bx + 3.2}%;top:${by - 6.4}%;background:${col}">${ic}</div></div></div>
        <div class="pr-side">
          <div class="pr-coach"><div class="avatar blob-avatar coach-avatar pr-face">${blobMarkup('blurple', mood)}</div><div><b><span class="pr-ic-s" style="background:${col}">${ic}</span>${r.move.san} is ${phrase}</b><p>${plainCoachExplanation(r)}</p>${showBest ? `<p class="pr-best">Best was <b>${r.bestMove.san}</b></p>` : ''}${op ? `<p class="pr-open">Opening: <b>${op}</b></p>` : ''}</div></div>
          <div class="pr-table"><div class="pr-row pr-h"><b>You</b><span></span><b>${oppName}</b></div>${rows}</div>
        </div>
      </div>
      <svg class="pr-graph" id="prGraph" viewBox="0 0 300 60" preserveAspectRatio="none"><rect width="300" height="60" fill="#1b2233"/><polygon points="0,60 ${pts} 300,60" fill="#e9e9ee" opacity=".9"/><line x1="0" y1="30" x2="300" y2="30" stroke="#7c6cf0" stroke-width=".4"/><line x1="${cx}" y1="0" x2="${cx}" y2="60" stroke="${col}" stroke-width="1.2"/></svg>
      <div class="pr-nav"><button class="secondary-button" data-n="first">⏮</button><button class="secondary-button" data-n="prev">◀</button><span>${idx + 1} / ${n}</span><button class="primary-button" data-n="next">▶</button><button class="secondary-button" data-n="last">⏭</button></div>
      <div class="pr-chips">${chips}</div>`;
    el.querySelector('#prClose').onclick = close;
    el.querySelector('#prPgn').onclick = copyPgn;
    el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => go({ first: 0, prev: idx - 1, next: idx + 1, last: n - 1 }[b.dataset.n]));
    el.querySelectorAll('.pr-chip').forEach(b => b.onclick = () => go(+b.dataset.i));
    el.querySelector('#prGraph').onclick = (e) => { const bb = e.currentTarget.getBoundingClientRect(); go(Math.round((e.clientX - bb.left) / bb.width * (n - 1))); };
    el.querySelector('.pr-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  draw();
}

function openingTable() {
  return { 'e4':'King’s Pawn Game','e4 e5':'Open Game','e4 e5 Nf3':'King’s Knight Opening','e4 e5 Nf3 Nc6':'King’s Knight Opening','e4 e5 Nf3 Nc6 Bc4':'Italian Game','e4 e5 Nf3 Nc6 Bc4 Bc5':'Giuoco Piano','e4 e5 Nf3 Nc6 Bc4 Nf6':'Two Knights Defense','e4 e5 Nf3 Nc6 Bb5':'Ruy Lopez','e4 e5 Nf3 Nc6 d4':'Scotch Game','e4 e5 Nf3 Nf6':'Petrov’s Defense','e4 e5 f4':'King’s Gambit','e4 e5 Nc3':'Vienna Game','e4 e5 Bc4':'Bishop’s Opening','e4 c5':'Sicilian Defense','e4 c5 c3':'Sicilian: Alapin Variation','e4 e6':'French Defense','e4 c6':'Caro-Kann Defense','e4 d5':'Scandinavian Defense','e4 d6':'Pirc Defense','e4 g6':'Modern Defense','e4 Nf6':'Alekhine’s Defense','d4':'Queen’s Pawn Game','d4 d5':'Closed Game','d4 d5 c4':'Queen’s Gambit','d4 d5 c4 e6':'Queen’s Gambit Declined','d4 d5 c4 dxc4':'Queen’s Gambit Accepted','d4 d5 c4 c6':'Slav Defense','d4 Nf6':'Indian Defense','d4 Nf6 c4 g6':'King’s Indian Defense','d4 Nf6 Bg5':'Trompowsky Attack','d4 f5':'Dutch Defense','Nf3':'Réti Opening','c4':'English Opening','c4 e5':'English: Reversed Sicilian','g3':'King’s Fianchetto Opening','b3':'Nimzo-Larsen Attack','f4':'Bird’s Opening','b4':'Polish Opening','Nc3':'Dunst Opening' };
}
function openingFor(sans) {
  const t = openingFor._t || (openingFor._t = openingTable());
  for (let k = Math.min(sans.length, 6); k >= 1; k--) { const n = t[sans.slice(0, k).join(' ')]; if (n) return n; }
  return '';
}
function updateOpeningName() {
  const el = document.getElementById('openingName'); if (!el) return;
  const sans = getDisplayGame().history();
  el.textContent = sans.length ? (openingFor(sans) || 'Out of book') : 'Starting position';
}
// Brilliant = the engine's top move, a real sacrifice, not already winning, and accepting it still leaves you clearly better.
async function verifyBrilliant(chess, move, mover, bestScore, playedScore, sf) {
  try {
    if (!sf || (move.from + move.to + (move.promotion || '')) !== sf.uci) return false;
    if (bestScore > 350 || playedScore < -30) return false;
    const caps = chess.moves({ verbose: true }).filter(r => r.captured && PIECE_VALUE[r.captured] - PIECE_VALUE[r.piece] >= 2)
      .sort((a, b) => (PIECE_VALUE[b.captured] - PIECE_VALUE[b.piece]) - (PIECE_VALUE[a.captured] - PIECE_VALUE[a.piece])).slice(0, 2);
    if (!caps.length) return false;
    for (const cap of caps) {
      const c2 = new Chess(chess.fen()); c2.move(toMoveInput(cap));
      const r = await sfAnalyze(c2.fen(), 220);
      if (!r || r.cp < 80) return false;
    }
    return true;
  } catch (e) { return false; }
}
// Impossible: among near-equal top Stockfish lines, prefer a sacrifice that still wins.
function brilliantPreference(uci) {
  try {
    const m = stockfish && stockfish.mpv; if (!m) return uci;
    const list = Object.keys(m).sort().map(k => m[k]), best = list[0];
    if (!best || !Number.isFinite(best.cp) || best.cp > 500) return uci;
    for (const c of list) {
      if (!Number.isFinite(c.cp) || c.cp < best.cp - 30 || c.cp < 80) continue;
      const mv = game.moves({ verbose: true }).find(x => (x.from + x.to + (x.promotion || '')) === c.uci);
      if (!mv || mv.captured) continue;
      const g2 = new Chess(game.fen()); g2.move(toMoveInput(mv));
      if (g2.moves({ verbose: true }).some(r => r.captured && PIECE_VALUE[r.captured] - PIECE_VALUE[r.piece] >= 2)) return c.uci;
    }
  } catch (e) {}
  return uci;
}

function fxOn() { return document.body.classList.contains('fx-on'); }
function plusStartMs() { return (+(document.getElementById('timeSelect')?.value || 10)) * 60000; }
function plusIncMs() { return (+(document.getElementById('incSelect')?.value || 0)) * 1000; }
function aiStress() {
  if (!settings.clock) return 0;
  const lim = plusStartMs() * 0.25, left = clocks[aiColor];
  return left >= lim ? 0 : clamp(0, 1, 1 - left / lim);
}
function aiThinkMs(base) {
  if (!settings.clock) return base;
  const t = clamp(150, base, clocks[aiColor] / 28 + plusIncMs() * 500);
  return Math.round(t * (1 - 0.6 * aiStress()));
}
function stressPick(uci) {
  try {
    const s = aiStress(); if (s <= 0.05 || Math.random() > s * 0.4) return uci;
    const m = stockfish && stockfish.mpv; if (!m) return uci;
    const list = Object.keys(m).sort().map(k => m[k]), best = list[0];
    const alt = list.slice(1).find(c => Number.isFinite(c.cp) && c.cp >= best.cp - 150);
    return alt ? alt.uci : uci;
  } catch (e) { return uci; }
}
function fxSound(name) {
  if (!fxOn()) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const S = {
      move: [[520, .05, 'triangle', .05]], capture: [[180, .09, 'square', .05, 90], [340, .05, 'triangle', .04, 0, .02]],
      bigcapture: [[110, .25, 'sawtooth', .08, 40], [220, .15, 'square', .05, 90, .03]],
      castle: [[300, .06, 'triangle', .05, 450], [450, .06, 'triangle', .05, 300, .08]],
      check: [[880, .12, 'square', .04], [660, .14, 'square', .04, 0, .12]],
      promote: [[523, .1, 'sine', .06], [659, .1, 'sine', .06, 0, .09], [784, .1, 'sine', .06, 0, .18], [1047, .25, 'sine', .07, 0, .27]],
      start: [[392, .1, 'sine', .05], [523, .16, 'sine', .05, 0, .1]],
      win: [[523, .14, 'triangle', .07], [659, .14, 'triangle', .07, 0, .14], [784, .14, 'triangle', .07, 0, .28], [1047, .45, 'triangle', .08, 0, .42], [90, .3, 'sine', .14, 40, .75]],
      lose: [[330, .3, 'sawtooth', .05, 180], [247, .3, 'sawtooth', .05, 140, .28], [165, .6, 'sawtooth', .06, 70, .56], [80, .35, 'sine', .15, 35, 1.1]],
      draw: [[392, .2, 'sine', .05], [392, .3, 'sine', .05, 330, .22]],
    }[name] || [];
    const t0 = audioContext.currentTime;
    for (const [f, d, type, v, to, delay = 0] of S) {
      const o = audioContext.createOscillator(), g = audioContext.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0 + delay);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + delay + d);
      g.gain.setValueAtTime(v, t0 + delay); g.gain.exponentialRampToValueAtTime(.001, t0 + delay + d);
      o.connect(g); g.connect(audioContext.destination); o.start(t0 + delay); o.stop(t0 + delay + d + .02);
    }
  } catch (e) {}
}
function fxBurst(sq, colors, n) {
  const el = document.querySelector('[data-square="' + sq + '"]'); if (!el) return;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i'), a = Math.random() * 6.283, d = 30 + Math.random() * 60;
    p.className = 'fx-p';
    p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;background:' + colors[i % colors.length] + ';--dx:' + Math.cos(a) * d + 'px;--dy:' + Math.sin(a) * d + 'px';
    document.body.appendChild(p); setTimeout(() => p.remove(), 800);
  }
}
function fxConfetti() {
  const cols = ['#ffd65c', '#46cdbd', '#a99cff', '#ff7a90', '#fff'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'fx-c';
    c.style.cssText = 'left:' + Math.random() * 100 + 'vw;background:' + cols[i % 5] + ';animation-delay:' + Math.random() * 1.2 + 's';
    document.body.appendChild(c); setTimeout(() => c.remove(), 4500);
  }
}
function fxAfterMove(move) {
  if (!fxOn()) return;
  const big = move.captured === 'q' || move.captured === 'r';
  if (move.promotion) { fxSound('promote'); fxBurst(move.to, ['#ffd65c', '#fff', '#8fe3ff'], 22); }
  else if (move.san.startsWith('O-O')) fxSound('castle');
  else if (move.captured) { fxSound(big ? 'bigcapture' : 'capture'); fxBurst(move.to, ['#ffb74d', '#ff7043'], big ? 24 : 10); }
  else fxSound('move');
  if (big) { document.body.classList.add('fx-shake'); setTimeout(() => document.body.classList.remove('fx-shake'), 450); }
  if (game.isCheck() && !game.isCheckmate()) setTimeout(() => fxSound('check'), 120);
}
function fxCheckmate(winner) {
  if (!fxOn()) return;
  const won = winner === playerColor, ks = findKingSquare(game, game.turn());
  $('board').classList.add('fx-mate');
  setTimeout(() => { document.querySelector('[data-square="' + ks + '"] .piece')?.classList.add('fx-fall'); }, 350);
  setTimeout(() => fxSound(won ? 'win' : 'lose'), 300);
  if (won) setTimeout(fxConfetti, 700);
  else { document.body.classList.add('fx-dim'); setTimeout(() => document.body.classList.remove('fx-dim'), 3200); }
}
function fxDraw() { fxSound('draw'); }
async function sfTop(fen, ms, n) {
  await sfDrain();
  return new Promise((resolve) => {
    const w = stockfish.worker, prev = w.onmessage, m = {};
    const done = () => { w.onmessage = prev; w.postMessage('setoption name MultiPV value 1'); resolve(Object.keys(m).sort().map(k => m[k])); };
    const t = setTimeout(() => { w.postMessage('stop'); done(); }, ms + 3000);
    w.onmessage = (ev) => {
      const line = String(ev.data);
      if (line.startsWith('info ')) {
        const k = line.match(/ multipv (\d+)/), p = line.match(/ pv (\S+)/), c = line.match(/score cp (-?\d+)/), a = line.match(/score mate (-?\d+)/);
        if (k && p && (c || a)) m[k[1]] = { uci: p[1], cp: a ? (+a[1] > 0 ? 10000 : -10000) : +c[1] };
      }
      if (line.startsWith('bestmove')) { clearTimeout(t); done(); }
    };
    w.postMessage('setoption name MultiPV value ' + n);
    w.postMessage('position fen ' + fen);
    w.postMessage('go movetime ' + ms);
  });
}
async function showHint() {
  if (gameEnded || isAiThinking || historyViewPly !== null || game.turn() !== playerColor) return;
  try {
    showToast('Thinking of a hint…');
    await ensureStockfish();
    const lines = await sfTop(game.fen(), 700, 3);
    if (!lines.length) return;
    const picks = [lines[0], lines.slice(1).find(l => l.cp >= lines[0].cp - 100) || lines[1]].filter(Boolean);
    if (Math.random() < .5) picks.reverse();
    document.querySelectorAll('.hint-a,.hint-b').forEach(e => e.classList.remove('hint-a', 'hint-b'));
    const names = [];
    picks.forEach((p, i) => {
      const f = p.uci.slice(0, 2), t = p.uci.slice(2, 4);
      document.querySelector('[data-square="' + f + '"]')?.classList.add(i ? 'hint-b' : 'hint-a');
      document.querySelector('[data-square="' + t + '"]')?.classList.add(i ? 'hint-b' : 'hint-a');
      names.push(f.toUpperCase() + ' → ' + t.toUpperCase());
    });
    showToast('Two ideas to consider: ' + names.join('  or  ') + '.');
  } catch (e) { showToast('Hints need Stockfish, which could not load.'); }
}

/* ---- Loader ---- */
function psafe(src, find, replacement) {
  try { return patch(src, find, replacement); } catch (e) { console.warn('Optional patch skipped:', e.message); return src; }
}
function patch(src, find, replacement) {
  const found = find instanceof RegExp ? find.test(src) : src.includes(find);
  if (!found) throw new Error('Patch anchor not found: ' + String(find).slice(0, 60));
  return src.replace(find, () => replacement);
}

function tidySettings() {
  const L = { modern: 'Classic', classic: 'Merida', minimal: 'Alpha', bold: 'Cardinal' };
  document.querySelectorAll('#pieceDesignSelect option').forEach(o => { if (L[o.value]) o.textContent = L[o.value]; });
  const g = document.querySelector('.engine-info-grid');
  if (g && !document.getElementById('openingName')) g.insertAdjacentHTML('beforeend', '<div style="grid-column:1/-1"><span class="label">Opening</span><strong id="openingName">—</strong></div>');
  const bv = document.querySelector('.build-version');
  if (bv && !document.getElementById('fxToggle')) {
    bv.insertAdjacentHTML('beforebegin', '<label class="setting-line"><span>Cool effects &amp; sounds</span><input id="fxToggle" type="checkbox"></label>');
    const t = document.getElementById('fxToggle'); t.checked = localStorage.getItem('chess-ai-fx') === '1';
    const ap = () => document.body.classList.toggle('fx-on', t.checked); ap();
    t.onchange = () => { localStorage.setItem('chess-ai-fx', t.checked ? '1' : '0'); ap(); };
  }
  const row = document.querySelector('.setup-row');
  if (row && !document.getElementById('timeSelect')) {
    row.insertAdjacentHTML('beforebegin', '<fieldset class="setup-group"><legend>Time</legend><div class="time-grid"><label>Starting time<select id="timeSelect">' + [1, 3, 5, 10, 15, 30, 60].map(m => '<option value="' + m + '">' + (m === 60 ? '1 hour' : m + ' min') + '</option>').join('') + '</select></label><label>Added per move<select id="incSelect">' + [0, 1, 2, 3, 5].map(x => '<option value="' + x + '">' + (x ? '+' + x + ' sec' : 'None') + '</option>').join('') + '</select></label></div></fieldset>');
    let sv = {}; try { sv = JSON.parse(localStorage.getItem('chess-ai-time') || '{}'); } catch (e) {}
    const ts = document.getElementById('timeSelect'), is = document.getElementById('incSelect');
    ts.value = sv.t || 10; is.value = sv.i || 0;
    const save = () => localStorage.setItem('chess-ai-time', JSON.stringify({ t: ts.value, i: is.value }));
    ts.onchange = save; is.onchange = save;
  }
  const f = document.getElementById('pieceStyleSelect'); if (f && f.closest('label')) f.closest('label').style.display = 'none';
}
function addButtons() {
  const grid = document.querySelector('.control-grid');
  if (!grid) return;
  [['hintButton', '💡 Hint'], ['pgnButton', 'Copy PGN']].forEach(([id, label]) => {
    if (document.getElementById(id)) return;
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.className = 'secondary-button'; b.textContent = label;
    grid.appendChild(b);
  });
}

const BLOB_CSS = ".blob-body{border-radius:50% 50% 48% 48%/62% 62% 38% 38%;box-shadow:inset 0 -7px 0 rgba(0,0,0,.12),inset 0 6px 8px rgba(255,255,255,.18),0 6px 14px rgba(0,0,0,.28);overflow:visible;transform-origin:50% 100%;animation:blobIdle 3.2s ease-in-out infinite}\n.blob-body::before{width:34%;height:22%;left:16%;top:10%;background:rgba(255,255,255,.35)}\n.blob-eye{width:15%;height:21%;top:36%;background:#1b1b24;border-radius:50%;animation:blobBlink 4.5s infinite}\n.blob-eye::after{content:\"\";position:absolute;width:38%;height:38%;left:48%;top:14%;background:#fff;border-radius:50%}\n.blob-eye.left{left:27%}.blob-eye.right{right:27%}\n.blob-cheek{width:14%;height:8%;top:56%;background:rgba(255,120,150,.55);opacity:1!important}\n.blob-cheek.left{left:14%}.blob-cheek.right{right:14%}\n.blob-mouth{top:58%;width:20%;height:9%;border-width:2.5px;border-color:#2a1f2d}\n.blob-body.mood-happy .blob-mouth,.blob-body.mood-smile .blob-mouth,.blob-body.mood-chuckle .blob-mouth{width:26%;height:13%;top:56%}\n.blob-body.mood-laugh .blob-mouth{width:30%;height:20%;top:53%;background:#7a2e44}\n@keyframes blobIdle{0%,100%{transform:scale(1,1)}50%{transform:scale(1.04,.96)}}\n@keyframes blobBlink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}\n@keyframes blobHop{0%,100%{transform:translateY(0) scale(1,1)}30%{transform:translateY(-14%) scale(.94,1.08)}60%{transform:translateY(0) scale(1.08,.92)}}\n@keyframes blobShake{0%,100%{transform:rotate(0)}25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}\n@keyframes blobWobble{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}\n@keyframes blobDroop{0%,100%{transform:scale(1.05,.9)}50%{transform:scale(1.08,.88)}}\n@keyframes blobTremble{0%,100%{transform:translateX(0)}25%{transform:translateX(-3%)}75%{transform:translateX(3%)}}\n.blob-body.mood-happy,.blob-body.mood-laugh{animation:blobHop .7s ease-in-out infinite}\n.blob-body.mood-laugh{animation-duration:.45s}\n.blob-body.mood-thinking{animation:blobWobble 1.2s ease-in-out infinite}\n.blob-body.mood-angry{animation:blobShake .25s linear infinite;filter:saturate(1.3)}\n.blob-body.mood-sad,.blob-body.mood-defeated{animation:blobDroop 2s ease-in-out infinite}\n.blob-body.mood-scared{animation:blobTremble .12s linear infinite}\n.pr-face{flex:0 0 58px}.pr-head-btns{display:flex;gap:8px}.pr-open{font-size:12px}\n.pr-ic-s{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;color:#fff;font:900 11px/1 system-ui;margin-right:6px}\n";
const FX_CSS = ".captured-row{background:rgba(255,255,255,.16);border-radius:999px;padding:2px 10px;width:fit-content;min-height:24px}.captured-row:empty{display:none}\n.captured-row .capture-score{font-size:14px!important;color:#ffd65c!important}.material-row strong{color:#ffd65c;font-size:14px}\n.time-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.time-grid label{display:grid;gap:6px;color:var(--muted);font-size:12px}\n.time-grid select{background:var(--surface-2);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:14px}\n.square.hint-a{box-shadow:inset 0 0 0 4px #46cdbd}.square.hint-b{box-shadow:inset 0 0 0 4px #a99cff}\n.fx-p{position:fixed;width:7px;height:7px;border-radius:50%;z-index:300;pointer-events:none;animation:fxP .75s ease-out forwards}\n@keyframes fxP{to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}\n.fx-c{position:fixed;top:-14px;width:9px;height:14px;z-index:300;pointer-events:none;animation:fxC 3s linear forwards}\n@keyframes fxC{to{transform:translateY(110vh) rotate(720deg)}}\n.fx-shake .board-wrap{animation:fxShake .4s}\n@keyframes fxShake{0%,100%{transform:translate(0)}20%{transform:translate(-6px,3px)}40%{transform:translate(6px,-3px)}60%{transform:translate(-4px,-2px)}80%{transform:translate(4px,2px)}}\n.fx-on .square.last-move .piece{animation:fxLand .28s ease-out}\n@keyframes fxLand{0%{transform:scale(1.25)}60%{transform:scale(.92)}100%{transform:scale(1)}}\n.fx-on .square.in-check::after{animation:fxPulse .9s ease-in-out infinite}.fx-on .clock.low{animation:fxPulse .8s ease-in-out infinite}\n@keyframes fxPulse{50%{opacity:.35}}\n.fx-mate .square{background:#c62828!important;animation:fxRed .5s ease-out}\n@keyframes fxRed{from{filter:brightness(2)}to{filter:none}}\n.piece.fx-fall{transform-origin:100% 100%;animation:fxFall .9s cubic-bezier(.5,0,.9,.6) forwards}\n@keyframes fxFall{to{transform:rotate(90deg) translateY(20%)}}\nbody.fx-dim::after{content:\"\";position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50;pointer-events:none}\n";
const THEME_CSS = ":root{--bg:#0b0e14;--surface:#141926;--surface-2:#1b2233;--surface-3:#252e45;--text:#eef1f8;--muted:#98a2bc;--line:rgba(255,255,255,.07);--accent:#7c6cf0;--accent-strong:#a99cff;--shadow:0 20px 60px rgba(0,0,0,.45);--board-light:#eae6d8;--board-dark:#5d8a7b}\nbody{background:radial-gradient(1100px 560px at 12% -10%,rgba(124,108,240,.2),transparent 60%),radial-gradient(900px 480px at 100% 0,rgba(60,180,165,.13),transparent 55%),var(--bg);font-family:\"Inter\",\"SF Pro Display\",system-ui,sans-serif}\n.topbar{background:rgba(11,14,20,.65);border-bottom:1px solid var(--line)}\n.brand-mark{background:linear-gradient(135deg,#7c6cf0,#46cdbd);color:#fff;border-radius:14px;box-shadow:0 6px 18px rgba(124,108,240,.4)}\n.setup-card,.modal-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015)),var(--surface);border:1px solid var(--line);border-radius:26px}\n.side-panel{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01)),var(--surface);border-radius:20px}\n.setup-card h1{background:linear-gradient(90deg,#fff,#a99cff);-webkit-background-clip:text;background-clip:text;color:transparent}\n.eyebrow,.turn-status{color:var(--accent-strong)}\n.choice-button,.difficulty-card{border-radius:16px;background:var(--surface-2)}\n.choice-button.selected,.difficulty-card.selected{border-color:var(--accent-strong);background:rgba(124,108,240,.18);box-shadow:0 0 0 1px rgba(169,156,255,.25),0 10px 26px rgba(124,108,240,.22)}\n.difficulty-card.impossible.selected{border-color:#ff6b6b;background:rgba(255,80,80,.14);box-shadow:0 10px 26px rgba(255,80,80,.22)}\n.primary-button{background:linear-gradient(135deg,#7c6cf0,#5b7cfa);color:#fff;box-shadow:0 8px 22px rgba(124,108,240,.35)}\n.primary-button:hover{background:linear-gradient(135deg,#8c7dff,#6b8bff)}\n.switch input:checked+.slider{background:var(--accent)}\n.badge{background:rgba(124,108,240,.2);color:var(--accent-strong)}\n.move-cell.latest{background:rgba(124,108,240,.28);color:#fff}\n.clock.active{background:#fff;color:#10131c}\n.avatar{border-radius:14px}\n.board-wrap{border-radius:14px;box-shadow:0 0 0 7px rgba(255,255,255,.05),0 30px 80px rgba(0,0,0,.55)}\n.pr{position:fixed;inset:0;z-index:150;overflow:auto;padding:20px;background:radial-gradient(900px 500px at 10% -10%,rgba(124,108,240,.22),transparent 60%),var(--bg)}\n.pr-head{display:flex;justify-content:space-between;align-items:center;max-width:1100px;margin:0 auto 14px}\n.pr-cards,.pr-main,.pr-graph,.pr-nav,.pr-chips{max-width:1100px;margin-left:auto;margin-right:auto}\n.pr-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n.pr-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 16px}\n.pr-name{color:var(--muted);font-size:12px;font-weight:700}.pr-acc{font-size:30px;font-weight:900}.pr-sub{color:var(--muted);font-size:11px}\n.pr-main{display:grid;grid-template-columns:22px minmax(0,560px) 1fr;gap:14px;margin-top:14px;align-items:start}\n.pr-bar{height:min(560px,calc(100vw - 60px));background:#2a2f3d;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}\n.pr-bar.flip{justify-content:flex-start}.pr-bar>div{background:#f1f1f4;transition:height .25s}\n.pr-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1;border-radius:10px;overflow:hidden}\n.pr-sq{position:relative;display:grid;place-items:center}.pr-sq.l{background:var(--board-light)}.pr-sq.d{background:var(--board-dark)}\n.pr-sq.hl::after{content:\"\";position:absolute;inset:0;background:rgba(246,221,88,.45)}\n.pr-sq .piece{width:88%;height:88%;cursor:default}\n.pr-board>svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6}\n.pr-badge{position:absolute;z-index:8;min-width:5.2%;height:5.2%;padding:0 3px;border-radius:50%;display:grid;place-items:center;font:900 clamp(8px,1.6vw,13px)/1 system-ui;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4)}\n.pr-coach{display:flex;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px}\n.pr-ic{flex:0 0 42px;height:42px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:17px;color:#fff}\n.pr-coach p{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.pr-best{color:#a9d97a!important}\n.pr-table{margin-top:12px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:8px 14px}\n.pr-row{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;padding:5px 0;font-size:13px}.pr-row b{text-align:center}\n.pr-row i{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;margin-right:8px;color:#fff;font:900 11px/1 system-ui;font-style:normal}\n.pr-h{color:var(--muted);font-size:11px}\n.pr-graph{display:block;width:100%;max-width:1100px;height:90px;margin-top:14px;border-radius:12px;cursor:pointer}\n.pr-nav{display:flex;gap:10px;justify-content:center;align-items:center;margin-top:12px;color:var(--muted)}\n.pr-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-bottom:30px}\n.pr-chip{border:1px solid var(--line);background:var(--surface-2);color:var(--text);border-radius:8px;padding:5px 8px;font-size:12px;font-weight:700;border-left:3px solid var(--c)}\n.pr-chip em{font-style:normal;color:var(--c);margin-left:4px}.pr-chip.on{background:var(--surface-3);outline:2px solid var(--c)}\n@media(max-width:860px){.pr-main{grid-template-columns:18px 1fr}.pr-side{grid-column:1/-1}.pr-bar{height:calc(100vw - 70px)}}\n";

const PIECE_SETS_CDN = { modern: 'cburnett', classic: 'merida', minimal: 'alpha', bold: 'cardinal' };
function pieceCss() {
  let css = '.pc{display:block;width:100%;height:100%;background-size:contain;background-repeat:no-repeat;background-position:center;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}'
    + '.square .piece,.pr-sq .piece,.review-square .piece{width:100%!important;height:100%!important}'
    + '.pr-board{grid-template-rows:repeat(8,1fr)}.pr-sq{min-height:0;overflow:hidden}';
  for (const [d, set] of Object.entries(PIECE_SETS_CDN)) for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
    css += 'body[data-piece-design="' + d + '"] .piece-' + (c === 'w' ? 'white' : 'black') + ' .pc-' + t
      + '{background-image:url(https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/' + set + '/' + c + t.toUpperCase() + '.svg)}';
  }
  return css;
}
async function run() {
  const st = document.createElement("style"); st.id = "plusTheme"; st.textContent = THEME_CSS + pieceCss() + BLOB_CSS + FX_CSS; document.head.appendChild(st);
  const res = await fetch(BASE);
  if (!res.ok) throw new Error('Could not load app.js (' + res.status + ')');
  // Workers inside a blob module need an absolute URL.
  let workerFile = './ai-worker.js?v=8';
  try { const h = await fetch('./ai-worker-plus.js?v=11', { method: 'HEAD' }); if (h.ok) workerFile = './ai-worker-plus.js?v=11'; } catch (e) {}
  const original = (await res.text()).split("'./ai-worker.js?v=8'").join("new URL('" + workerFile + "', document.baseURI).href");
  let src = original, patched = false;
  try {
    const helpers = [sfDrain, sfAnalyze, runStockfishReview, playedFromSf, winPct, showHint, copyPgn, proClass, proArrow, openProReview, fxOn, plusStartMs, plusIncMs, aiStress, aiThinkMs, stressPick, fxSound, fxBurst, fxConfetti, fxAfterMove, fxCheckmate, fxDraw, sfTop, openingTable, openingFor, updateOpeningName, verifyBrilliant, brilliantPreference].map(f => f.toString()).join('\n\n');
    src = patch(src, 'function normalizeScoreForWhite(score, perspective) {', helpers + '\n\nfunction normalizeScoreForWhite(score, perspective) {');
    src = patch(src, 'const stats = { w: createReviewBucket(), b: createReviewBucket(), keyMoments: [] };',
      'const stats = { w: createReviewBucket(), b: createReviewBucket(), keyMoments: [] };\n  let sfResults = null; let lastEvalW = 0;\n  try { sfResults = await runStockfishReview(history); } catch (e) { console.warn("Stockfish review unavailable", e); }');
    src = patch(src, 'const analysis = analyzePositionSync(analyzer, mover, depth);',
      'let analysis; const sf = sfResults && sfResults[idx];\n      if (sf) { const bm = analyzer.moves({ verbose: true }).find(m => (m.from + m.to + (m.promotion || "")) === sf.uci); analysis = { bestMove: bm, bestScore: sf.cp }; }\n      else analysis = analyzePositionSync(analyzer, mover, depth);');
    src = patch(src, 'playedScore = evaluatePosition(analyzer, mover);',
      'playedScore = sfResults ? playedFromSf(analyzer, sfResults[idx + 1], mover) : evaluatePosition(analyzer, mover);');
    src = patch(src, 'totalCpl: 0,', 'totalCpl: 0, totalWinLoss: 0,');
    src = patch(src, 'stats[mover].totalCpl += cpl;',
      'stats[mover].totalCpl += cpl;\n      stats[mover].totalWinLoss += Math.max(0, winPct(bestScore ?? 0) - winPct(playedScore ?? 0));');
    src = patch(src, /bucket\.accuracy = clamp\(35, 99,[^\n]*/,
      'const avgWin = bucket.reviewedMoves ? bucket.totalWinLoss / bucket.reviewedMoves : 0;\n  bucket.accuracy = clamp(35, 99, Math.round((103.1668 * Math.exp(-0.04354 * avgWin) - 3.1669) * 10) / 10);');
    src = patch(src, "$('settingsButton').addEventListener('click', () => openModal('settingsModal'));",
      "$('settingsButton').addEventListener('click', () => openModal('settingsModal'));\n  $('hintButton').addEventListener('click', showHint);\n  $('pgnButton').addEventListener('click', copyPgn);");
    src = patch(src, 'await openReviewModal();', 'await openProReview();');
    src = patch(src, 'if (mover === playerColor) stats[mover].moves.push(record);',
      'const pe = playedScore ?? (mover === "w" ? lastEvalW : -lastEvalW); record.evalW = mover === "w" ? pe : -pe; lastEvalW = record.evalW; (stats.all = stats.all || []).push(record);\n    if (mover === playerColor) stats[mover].moves.push(record);');
    src = patch(src, 'criticalMoves, coach };', 'criticalMoves, coach, all: stats.all || [] };');
    // Impossible: no opening book, full-strength Stockfish, much longer thinking time
    src = patch(src, "const opening = chooseOpeningMove(game, game.moves({ verbose: true }), 'impossible');", 'const opening = null;');
    src = patch(src, 'const moveTime = isMobile ? 1700 : 2800;', 'const moveTime = aiThinkMs(isMobile ? 4000 : 7000);');
    src = patch(src, "state.worker.postMessage('setoption name Hash value 96');", "state.worker.postMessage('setoption name Hash value 128'); state.worker.postMessage('setoption name Skill Level value 20'); state.worker.postMessage('setoption name UCI_LimitStrength value false'); state.worker.postMessage('setoption name Move Overhead value 100');");
    src = patch(src, 'function pieceSvg(type, design = settings.pieceDesign) {', 'function pieceSvg(type, design = settings.pieceDesign) {\n  return \'<span class="pc pc-\' + type + \'"></span>\';');
    src = patch(src, 'function splitPawnMarkup() {', 'function splitPawnMarkup() {\n  return \'<div class="piece piece-split" aria-hidden="true" style="position:relative"><span class="piece-white" style="position:absolute;inset:0;clip-path:inset(0 50% 0 0)"><span class="pc pc-p"></span></span><span class="piece-black" style="position:absolute;inset:0;clip-path:inset(0 0 0 50%)"><span class="pc pc-p"></span></span></div>\';');
    src = patch(src, 'sacrifice = looksLikeSacrifice(analyzer, move, mover, bestScore, playedScore);', 'sacrifice = await verifyBrilliant(analyzer, move, mover, bestScore, playedScore, sf);');
    src = patch(src, "stockfish.worker.postMessage('ucinewgame');", "stockfish.worker.postMessage('ucinewgame');\n    stockfish.mpv = {}; stockfish.worker.postMessage('setoption name MultiPV value 3');");
    src = patch(src, 'const mate = line.match(/\\bscore mate (-?\\d+)/)?.[1];', 'const mate = line.match(/\\bscore mate (-?\\d+)/)?.[1];\n    const mpvN = line.match(/ multipv (\\d+)/)?.[1], mpvMove = line.match(/ pv (\\S+)/)?.[1];\n    if (mpvN && mpvMove && stockfish.mpv) stockfish.mpv[mpvN] = { uci: mpvMove, cp: mate ? (Number(mate) > 0 ? 10000 : -10000) : Number(cp) };');
    src = patch(src, 'const from = uci.slice(0,2), to = uci.slice(2,4), promotion = uci[4];', 'const pick = stressPick(brilliantPreference(uci)); const from = pick.slice(0,2), to = pick.slice(2,4), promotion = pick[4];');
    src = patch(src, 'function updateMoveList() {', 'function updateMoveList() {\n  try { updateOpeningName(); } catch (e) {}');
    src = src.split("% 2 === 1 ? 'light' : 'dark'").join("% 2 === 1 ? 'dark' : 'light'");
    src = psafe(src, '  clocks = { w: 600000, b: 600000 };', '  clocks = { w: plusStartMs(), b: plusStartMs() };');
    src = psafe(src, 'Math.min(600000, clocks[playerColor] + 5000)', 'Math.min(plusStartMs(), clocks[playerColor] + 5000)');
    src = psafe(src, '  lastMove = move; selectedSquare = null; legalMoves = [];', '  lastMove = move; selectedSquare = null; legalMoves = [];\n  if (settings.clock) clocks[mover] += plusIncMs();');
    src = psafe(src, "if (move.captured) playSound('capture'); else playSound('move');", "if (move.captured) playSound('capture'); else playSound('move');\n  try { fxAfterMove(move); } catch (e) {}");
    src = psafe(src, "playSound('checkmate');", "playSound('checkmate'); try { fxCheckmate(winner); } catch (e) {}");
    src = psafe(src, "let detail = 'The game is drawn.';", "try { fxDraw(); } catch (e) {}\n    let detail = 'The game is drawn.';");
    src = psafe(src, "setTimeout(() => openModal('resultModal'), 220);", "setTimeout(() => openModal('resultModal'), fxOn() ? 2200 : 220);");
    src = psafe(src, 'if (!settings.sound) return;', 'if (!settings.sound || fxOn()) return;');
    src = psafe(src, 'function renderBoard() {', "function renderBoard() {\n  if (!game.isCheckmate()) $('board').classList.remove('fx-mate');");
    src = psafe(src, "playSound('start'); startClock();", "playSound('start'); fxSound('start'); startClock();");
    src = psafe(src, 'const result = await getWorkerAiMove(level);', 'if (Math.random() < aiStress() * 0.35) { const sc = moves.map(m => ({ m, s: scoreMoveOnePly(game, m, aiColor) + randomNormalish() * 150 })).sort((a, b) => b.s - a.s); return { move: toMoveInput(sc[Math.floor(Math.random() * Math.min(3, sc.length))].m), stats: { depth: 1, score: 0 } }; }\n  const result = await getWorkerAiMove(level);');
    patched = true;
  } catch (err) {
    console.warn('Build 9 features skipped, running original app.js:', err);
    src = original;
  }
  if (patched) { addButtons(); tidySettings(); }
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  await import(url);
}

run().catch((err) => {
  console.error('Add-on loader failed, running original app.js:', err);
  import(BASE);
});
