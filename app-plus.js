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
async function showHint() {
  if (gameEnded || isAiThinking || historyViewPly !== null || game.turn() !== playerColor) return;
  try {
    showToast('Thinking of a hint…');
    await ensureStockfish();
    const r = await sfAnalyze(game.fen(), 600);
    if (!r || !r.uci || r.uci === '(none)') return;
    const from = r.uci.slice(0, 2), to = r.uci.slice(2, 4);
    selectSquare(from);
    showToast(`Hint: try moving the piece on ${from.toUpperCase()} to ${to.toUpperCase()}.`);
  } catch (e) { showToast('Hints need Stockfish, which could not load.'); }
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
      sq += `<div class="pr-sq ${(FILES.indexOf(file) + rank) % 2 === 1 ? 'l' : 'd'} ${n === r.from || n === r.to ? 'hl' : ''}">${p ? pieceMarkup(p.type, p.color, 'auto') : ''}</div>`;
    }));
    const showBest = ['inaccuracy','mistake','miss','blunder'].includes(r.classification) && r.bestMove && r.bestMove.san !== r.move.san;
    const [bx, by] = squareCenterPercent(r.to);
    const arrows = (showBest ? proArrow(r.bestMove.from, r.bestMove.to, '#81b64c') : '') + proArrow(r.from, r.to, col);
    const wp = winPct(r.evalW), n = all.length;
    const pts = all.map((m, i) => `${n > 1 ? i / (n - 1) * 300 : 0},${60 - winPct(m.evalW) * .6}`).join(' ');
    const cx = n > 1 ? idx / (n - 1) * 300 : 0;
    const card = (name, b) => `<div class="pr-card"><div class="pr-name">${name}</div><div class="pr-acc">${b.accuracy.toFixed(1)}%</div><div class="pr-sub">Accuracy · est. rating ${b.rating}</div></div>`;
    const rows = keys.map(k => { const [i2, c2, nm] = proClass(k); return `<div class="pr-row"><b style="color:${c2}">${rv.player.counts[k] || 0}</b><span><i style="background:${c2}">${i2}</i>${nm}</span><b style="color:${c2}">${rv.ai.counts[k] || 0}</b></div>`; }).join('');
    const chips = all.map((m, i) => { const [i3, c3] = proClass(m.classification); return `<button class="pr-chip ${i === idx ? 'on' : ''}" data-i="${i}" style="--c:${c3}">${m.mover === 'w' ? Math.ceil(m.plyNumber / 2) + '.' : ''}${m.move.san}<em>${i3}</em></button>`; }).join('');
    el.innerHTML = `<div class="pr-head"><div><div class="eyebrow">GAME REVIEW</div><h2>Blurple’s Review</h2></div><button class="secondary-button" id="prClose">Close ✕</button></div>
      <div class="pr-cards">${card('You', rv.player)}${card(oppName, rv.ai)}</div>
      <div class="pr-main">
        <div class="pr-bar ${flip ? 'flip' : ''}"><div style="height:${wp}%"></div></div>
        <div class="pr-boardwrap"><div class="pr-board">${sq}<svg viewBox="0 0 100 100">${arrows}</svg><div class="pr-badge" style="left:${bx + 3.2}%;top:${by - 6.4}%;background:${col}">${ic}</div></div></div>
        <div class="pr-side">
          <div class="pr-coach"><div class="pr-ic" style="background:${col}">${ic}</div><div><b>${r.move.san} is ${phrase}</b><p>${plainCoachExplanation(r)}</p>${showBest ? `<p class="pr-best">Best was <b>${r.bestMove.san}</b></p>` : ''}</div></div>
          <div class="pr-table"><div class="pr-row pr-h"><b>You</b><span></span><b>${oppName}</b></div>${rows}</div>
        </div>
      </div>
      <svg class="pr-graph" id="prGraph" viewBox="0 0 300 60" preserveAspectRatio="none"><rect width="300" height="60" fill="#1b2233"/><polygon points="0,60 ${pts} 300,60" fill="#e9e9ee" opacity=".9"/><line x1="0" y1="30" x2="300" y2="30" stroke="#7c6cf0" stroke-width=".4"/><line x1="${cx}" y1="0" x2="${cx}" y2="60" stroke="${col}" stroke-width="1.2"/></svg>
      <div class="pr-nav"><button class="secondary-button" data-n="first">⏮</button><button class="secondary-button" data-n="prev">◀</button><span>${idx + 1} / ${n}</span><button class="primary-button" data-n="next">▶</button><button class="secondary-button" data-n="last">⏭</button></div>
      <div class="pr-chips">${chips}</div>`;
    el.querySelector('#prClose').onclick = close;
    el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => go({ first: 0, prev: idx - 1, next: idx + 1, last: n - 1 }[b.dataset.n]));
    el.querySelectorAll('.pr-chip').forEach(b => b.onclick = () => go(+b.dataset.i));
    el.querySelector('#prGraph').onclick = (e) => { const bb = e.currentTarget.getBoundingClientRect(); go(Math.round((e.clientX - bb.left) / bb.width * (n - 1))); };
    el.querySelector('.pr-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  draw();
}

/* ---- Loader ---- */
function patch(src, find, replacement) {
  const found = find instanceof RegExp ? find.test(src) : src.includes(find);
  if (!found) throw new Error('Patch anchor not found: ' + String(find).slice(0, 60));
  return src.replace(find, () => replacement);
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

const THEME_CSS = ":root{--bg:#0b0e14;--surface:#141926;--surface-2:#1b2233;--surface-3:#252e45;--text:#eef1f8;--muted:#98a2bc;--line:rgba(255,255,255,.07);--accent:#7c6cf0;--accent-strong:#a99cff;--shadow:0 20px 60px rgba(0,0,0,.45);--board-light:#eae6d8;--board-dark:#5d8a7b}\nbody{background:radial-gradient(1100px 560px at 12% -10%,rgba(124,108,240,.2),transparent 60%),radial-gradient(900px 480px at 100% 0,rgba(60,180,165,.13),transparent 55%),var(--bg);font-family:\"Inter\",\"SF Pro Display\",system-ui,sans-serif}\n.topbar{background:rgba(11,14,20,.65);border-bottom:1px solid var(--line)}\n.brand-mark{background:linear-gradient(135deg,#7c6cf0,#46cdbd);color:#fff;border-radius:14px;box-shadow:0 6px 18px rgba(124,108,240,.4)}\n.setup-card,.modal-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015)),var(--surface);border:1px solid var(--line);border-radius:26px}\n.side-panel{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01)),var(--surface);border-radius:20px}\n.setup-card h1{background:linear-gradient(90deg,#fff,#a99cff);-webkit-background-clip:text;background-clip:text;color:transparent}\n.eyebrow,.turn-status{color:var(--accent-strong)}\n.choice-button,.difficulty-card{border-radius:16px;background:var(--surface-2)}\n.choice-button.selected,.difficulty-card.selected{border-color:var(--accent-strong);background:rgba(124,108,240,.18);box-shadow:0 0 0 1px rgba(169,156,255,.25),0 10px 26px rgba(124,108,240,.22)}\n.difficulty-card.impossible.selected{border-color:#ff6b6b;background:rgba(255,80,80,.14);box-shadow:0 10px 26px rgba(255,80,80,.22)}\n.primary-button{background:linear-gradient(135deg,#7c6cf0,#5b7cfa);color:#fff;box-shadow:0 8px 22px rgba(124,108,240,.35)}\n.primary-button:hover{background:linear-gradient(135deg,#8c7dff,#6b8bff)}\n.switch input:checked+.slider{background:var(--accent)}\n.badge{background:rgba(124,108,240,.2);color:var(--accent-strong)}\n.move-cell.latest{background:rgba(124,108,240,.28);color:#fff}\n.clock.active{background:#fff;color:#10131c}\n.avatar{border-radius:14px}\n.board-wrap{border-radius:14px;box-shadow:0 0 0 7px rgba(255,255,255,.05),0 30px 80px rgba(0,0,0,.55)}\n.pr{position:fixed;inset:0;z-index:150;overflow:auto;padding:20px;background:radial-gradient(900px 500px at 10% -10%,rgba(124,108,240,.22),transparent 60%),var(--bg)}\n.pr-head{display:flex;justify-content:space-between;align-items:center;max-width:1100px;margin:0 auto 14px}\n.pr-cards,.pr-main,.pr-graph,.pr-nav,.pr-chips{max-width:1100px;margin-left:auto;margin-right:auto}\n.pr-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n.pr-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 16px}\n.pr-name{color:var(--muted);font-size:12px;font-weight:700}.pr-acc{font-size:30px;font-weight:900}.pr-sub{color:var(--muted);font-size:11px}\n.pr-main{display:grid;grid-template-columns:22px minmax(0,560px) 1fr;gap:14px;margin-top:14px;align-items:start}\n.pr-bar{height:min(560px,calc(100vw - 60px));background:#2a2f3d;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}\n.pr-bar.flip{justify-content:flex-start}.pr-bar>div{background:#f1f1f4;transition:height .25s}\n.pr-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);aspect-ratio:1;border-radius:10px;overflow:hidden}\n.pr-sq{position:relative;display:grid;place-items:center}.pr-sq.l{background:var(--board-light)}.pr-sq.d{background:var(--board-dark)}\n.pr-sq.hl::after{content:\"\";position:absolute;inset:0;background:rgba(246,221,88,.45)}\n.pr-sq .piece{width:88%;height:88%;cursor:default}\n.pr-board>svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6}\n.pr-badge{position:absolute;z-index:8;min-width:5.2%;height:5.2%;padding:0 3px;border-radius:50%;display:grid;place-items:center;font:900 clamp(8px,1.6vw,13px)/1 system-ui;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4)}\n.pr-coach{display:flex;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px}\n.pr-ic{flex:0 0 42px;height:42px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:17px;color:#fff}\n.pr-coach p{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.pr-best{color:#a9d97a!important}\n.pr-table{margin-top:12px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:8px 14px}\n.pr-row{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;padding:5px 0;font-size:13px}.pr-row b{text-align:center}\n.pr-row i{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;margin-right:8px;color:#fff;font:900 11px/1 system-ui;font-style:normal}\n.pr-h{color:var(--muted);font-size:11px}\n.pr-graph{display:block;width:100%;max-width:1100px;height:90px;margin-top:14px;border-radius:12px;cursor:pointer}\n.pr-nav{display:flex;gap:10px;justify-content:center;align-items:center;margin-top:12px;color:var(--muted)}\n.pr-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-bottom:30px}\n.pr-chip{border:1px solid var(--line);background:var(--surface-2);color:var(--text);border-radius:8px;padding:5px 8px;font-size:12px;font-weight:700;border-left:3px solid var(--c)}\n.pr-chip em{font-style:normal;color:var(--c);margin-left:4px}.pr-chip.on{background:var(--surface-3);outline:2px solid var(--c)}\n@media(max-width:860px){.pr-main{grid-template-columns:18px 1fr}.pr-side{grid-column:1/-1}.pr-bar{height:calc(100vw - 70px)}}\n";
async function run() {
  const st = document.createElement("style"); st.id = "plusTheme"; st.textContent = THEME_CSS; document.head.appendChild(st);
  const res = await fetch(BASE);
  if (!res.ok) throw new Error('Could not load app.js (' + res.status + ')');
  // Workers inside a blob module need an absolute URL.
  let workerFile = './ai-worker.js?v=8';
  try { const h = await fetch('./ai-worker-plus.js?v=11', { method: 'HEAD' }); if (h.ok) workerFile = './ai-worker-plus.js?v=11'; } catch (e) {}
  const original = (await res.text()).split("'./ai-worker.js?v=8'").join("new URL('" + workerFile + "', document.baseURI).href");
  let src = original, patched = false;
  try {
    const helpers = [sfDrain, sfAnalyze, runStockfishReview, playedFromSf, winPct, showHint, copyPgn, proClass, proArrow, openProReview].map(f => f.toString()).join('\n\n');
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
    src = patch(src, 'const moveTime = isMobile ? 1700 : 2800;', 'const moveTime = isMobile ? 4000 : 7000;');
    src = patch(src, "state.worker.postMessage('setoption name Hash value 96');", "state.worker.postMessage('setoption name Hash value 128'); state.worker.postMessage('setoption name Skill Level value 20'); state.worker.postMessage('setoption name UCI_LimitStrength value false'); state.worker.postMessage('setoption name Move Overhead value 100');");
    patched = true;
  } catch (err) {
    console.warn('Build 9 features skipped, running original app.js:', err);
    src = original;
  }
  if (patched) addButtons();
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  await import(url);
}

run().catch((err) => {
  console.error('Add-on loader failed, running original app.js:', err);
  import(BASE);
});
