import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm';

// Build 11 worker: fixes the search scoring (the old one used the wrong sign on odd depths),
// aborts cleanly on timeout, and is faster (no per-node FEN strings).
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = ['a','b','c','d','e','f','g','h'];
const OPENING_BOOK = {
  '': [['e2e4', 28], ['d2d4', 24], ['g1f3', 16], ['c2c4', 14], ['b1c3', 6]],
  'e2e4': [['e7e5', 20], ['c7c5', 24], ['e7e6', 10], ['c7c6', 10], ['d7d5', 9], ['g8f6', 9]],
  'd2d4': [['d7d5', 22], ['g8f6', 20], ['e7e6', 14], ['f7f5', 4]],
  'g1f3': [['d7d5', 14], ['g8f6', 16], ['c7c5', 12], ['d7d6', 8]],
  'c2c4': [['e7e5', 16], ['g8f6', 18], ['e7e6', 14], ['c7c5', 10]],
  'e2e4 e7e5': [['g1f3', 24], ['f1c4', 18], ['b1c3', 13], ['d2d4', 11]],
  'e2e4 c7c5': [['g1f3', 24], ['b1c3', 16], ['c2c3', 7], ['d2d4', 14]],
  'e2e4 e7e6': [['d2d4', 22], ['g1f3', 9]],
  'e2e4 c7c6': [['d2d4', 18], ['b1c3', 10]],
  'd2d4 d7d5': [['c2c4', 24], ['g1f3', 14], ['e2e3', 8]],
  'd2d4 g8f6': [['c2c4', 18], ['g1f3', 16], ['c1g5', 8]],
  'g1f3 d7d5': [['d2d4', 16], ['c2c4', 14], ['g2g3', 10]],
  'c2c4 e7e5': [['b1c3', 16], ['g2g3', 12], ['g1f3', 10]],
  'e2e4 e7e5 g1f3': [['b8c6', 22], ['d7d6', 10], ['g8f6', 16]],
  'e2e4 c7c5 g1f3': [['d7d6', 20], ['b8c6', 18], ['e7e6', 11]],
  'd2d4 d7d5 c2c4': [['e7e6', 16], ['c7c6', 12], ['d5c4', 8]],
};
class Timeout extends Error {}

self.onmessage = (event) => {
  const { id, fen, level, plyCount = 0 } = event.data || {};
  if (!id || !fen) return;
  try {
    const game = new Chess(fen);
    const moves = game.moves({ verbose: true });
    if (!moves.length) return self.postMessage({ id, move: null });
    const opening = chooseOpeningMove(game, moves, level, plyCount);
    if (opening) return self.postMessage({ id, move: toMoveInput(opening), stats: { nodes: 0, depth: 0, score: 0 } });
    const config = level === 'medium' ? { depth: 2, timeMs: 700, noise: 60 }
      : level === 'hard' ? { depth: 5, timeMs: 2200, noise: 6 }
      : { depth: 6, timeMs: 3600, noise: 0 };
    const r = searchBestMove(game, config.depth, config.timeMs, config.noise);
    self.postMessage({ id, move: r.move, stats: { nodes: r.nodes, depth: r.depth, score: r.score } });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};

function chooseOpeningMove(game, moves, level, plyCount) {
  if (plyCount > 9) return null;
  const key = game.history({ verbose: true }).map(m => `${m.from}${m.to}${m.promotion || ''}`).join(' ');
  const options = OPENING_BOOK[key];
  if (!options) return null;
  const legal = options.map(([uci, weight]) => ({ weight, move: moves.find(m => `${m.from}${m.to}${m.promotion || ''}` === uci) })).filter(x => x.move);
  if (!legal.length || Math.random() > (level === 'medium' ? .9 : .96)) return null;
  let r = Math.random() * legal.reduce((s, x) => s + x.weight, 0);
  for (const x of legal) { r -= x.weight; if (r <= 0) return x.move; }
  return legal[legal.length - 1].move;
}

function searchBestMove(game, maxDepth, timeMs, noise) {
  const deadline = performance.now() + timeMs;
  let nodes = 0;
  const check = () => { if ((++nodes & 127) === 0 && performance.now() > deadline) throw new Timeout(); };
  let rootMoves = orderedMoves(game.moves({ verbose: true }));
  let best = toMoveInput(rootMoves[0]), bestScore = 0, reached = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let iterBest = null, iterScore = -Infinity;
      const scored = [];
      for (const m of rootMoves) {
        game.move(toMoveInput(m));
        const floor = noise ? -Infinity : iterScore;      // exact scores only needed when adding noise
        let s = -negamax(game, depth - 1, -Infinity, -floor, 1, check);
        game.undo();
        s += randomNormalish() * noise;
        scored.push([s, m]);
        if (s > iterScore) { iterScore = s; iterBest = m; }
      }
      best = toMoveInput(iterBest); bestScore = iterScore; reached = depth;
      rootMoves = scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
      if (Math.abs(bestScore) > 90000) break;               // forced mate found
    } catch (e) { if (e instanceof Timeout) break; throw e; }
  }
  return { move: best, score: bestScore, nodes, depth: reached };
}

// Scores are always from the side to move's point of view.
function negamax(game, depth, alpha, beta, ply, check) {
  check();
  const moves = game.moves({ verbose: true });
  if (!moves.length) return game.isCheck() ? -100000 + ply : 0;
  if (game.isInsufficientMaterial()) return 0;
  if (depth <= 0) return quiesce(game, alpha, beta, check, 0);
  let best = -Infinity;
  for (const m of orderedMoves(moves)) {
    game.move(toMoveInput(m));
    const s = -negamax(game, depth - 1, -beta, -alpha, ply + 1, check);
    game.undo();
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}
function quiesce(game, alpha, beta, check, qd) {
  check();
  const stand = evaluate(game);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qd >= 6) return alpha;
  for (const m of orderedMoves(game.moves({ verbose: true }).filter(x => x.captured || x.promotion))) {
    game.move(toMoveInput(m));
    const s = -quiesce(game, -beta, -alpha, check, qd + 1);
    game.undo();
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function evaluate(game) {
  const me = game.turn();
  let score = 0, wb = 0, bb = 0;
  for (const row of game.board()) for (const p of row) if (p) {
    const v = PIECE_VALUE[p.type] * 100 + positionalBonus(p);
    score += p.color === me ? v : -v;
    if (p.type === 'b') (p.color === 'w' ? wb++ : bb++);
  }
  const pair = (n) => (n >= 2 ? 30 : 0);
  score += me === 'w' ? pair(wb) - pair(bb) : pair(bb) - pair(wb);
  return score + 8;
}
function positionalBonus(p) {
  const f = FILES.indexOf(p.square[0]), r = Number(p.square[1]) - 1;
  const rr = p.color === 'w' ? r : 7 - r;
  const center = 3.5 - (Math.abs(f - 3.5) + Math.abs(r - 3.5)) / 2;
  if (p.type === 'p') return rr * 5 + center * 3;
  if (p.type === 'n') return center * 12;
  if (p.type === 'b') return center * 7;
  if (p.type === 'r') return rr === 6 ? 12 : 0;
  if (p.type === 'q') return center * 3;
  if (p.type === 'k') return rr < 2 ? -center * 3 : center * 1.5;
  return 0;
}
function orderedMoves(moves) { return [...moves].sort((a, b) => moveOrderingScore(b) - moveOrderingScore(a)); }
function moveOrderingScore(m) {
  let s = 0;
  if (m.captured) s += 100 + PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece];
  if (m.san.includes('#')) s += 10000;
  else if (m.san.includes('+')) s += 35;
  if (m.promotion) s += PIECE_VALUE[m.promotion] * 20;
  return s;
}
function toMoveInput(m) { return { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) }; }
function randomNormalish() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
