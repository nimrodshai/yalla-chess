// A small chess move interpreter, enough to replay a PGN game: SAN parsing,
// legal-move resolution (disambiguation, pins, castling, en passant,
// promotion) and FEN output for the board renderer. No dependency, so it can
// be served under the site's script-src 'self' policy.
(function () {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Board: array of 64, index 0 = a8 ... 63 = h1 (FEN order).
  function sq(file, rank) { return (8 - rank) * 8 + file; } // file 0-7, rank 1-8
  function fileOf(index) { return index % 8; }
  function rankOf(index) { return 8 - Math.floor(index / 8); }
  function name(index) { return FILES[fileOf(index)] + rankOf(index); }
  function indexOf(square) { return sq(FILES.indexOf(square[0]), Number(square[1])); }

  function fromFen(fen) {
    const [placement, turn, castling, ep] = fen.trim().split(/\s+/);
    const board = new Array(64).fill('');
    let i = 0;
    for (const char of placement) {
      if (char === '/') continue;
      if (/\d/.test(char)) { i += Number(char); continue; }
      board[i] = char;
      i += 1;
    }
    return { board, turn: turn === 'b' ? 'b' : 'w', castling: castling && castling !== '-' ? castling : '', ep: ep && ep !== '-' ? ep : '', halfmove: 0, fullmove: 1 };
  }

  function toFen(state) {
    let out = '';
    for (let rank = 0; rank < 8; rank += 1) {
      let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const piece = state.board[rank * 8 + file];
        if (!piece) { empty += 1; continue; }
        if (empty) { out += empty; empty = 0; }
        out += piece;
      }
      if (empty) out += empty;
      if (rank < 7) out += '/';
    }
    return `${out} ${state.turn} ${state.castling || '-'} ${state.ep || '-'} ${state.halfmove} ${state.fullmove}`;
  }

  function colorOf(piece) { return piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : ''; }
  function clone(state) { return { ...state, board: state.board.slice() }; }

  const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function step(index, df, dr) {
    const file = fileOf(index) + df;
    const rank = rankOf(index) + dr;
    if (file < 0 || file > 7 || rank < 1 || rank > 8) return -1;
    return sq(file, rank);
  }

  // Squares a piece on `index` attacks (ignores whose turn it is).
  function attacksFrom(board, index) {
    const piece = board[index];
    const type = piece.toUpperCase();
    const color = colorOf(piece);
    const out = [];
    const slide = (dirs) => {
      for (const [df, dr] of dirs) {
        let target = step(index, df, dr);
        while (target !== -1) {
          out.push(target);
          if (board[target]) break;
          target = step(target, df, dr);
        }
      }
    };
    if (type === 'N') for (const [df, dr] of KNIGHT) { const t = step(index, df, dr); if (t !== -1) out.push(t); }
    else if (type === 'K') for (const [df, dr] of KING) { const t = step(index, df, dr); if (t !== -1) out.push(t); }
    else if (type === 'B') slide(BISHOP);
    else if (type === 'R') slide(ROOK);
    else if (type === 'Q') slide([...BISHOP, ...ROOK]);
    else if (type === 'P') {
      const dr = color === 'w' ? 1 : -1;
      for (const df of [-1, 1]) { const t = step(index, df, dr); if (t !== -1) out.push(t); }
    }
    return out;
  }

  function isAttacked(board, index, byColor) {
    for (let i = 0; i < 64; i += 1) {
      if (!board[i] || colorOf(board[i]) !== byColor) continue;
      if (attacksFrom(board, i).includes(index)) return true;
    }
    return false;
  }

  function kingIndex(board, color) {
    return board.indexOf(color === 'w' ? 'K' : 'k');
  }

  // Applies a move without validation; returns the new state.
  function applyMove(state, move) {
    const next = clone(state);
    const { from, to, promotion, castle, enPassant } = move;
    const piece = next.board[from];
    const color = colorOf(piece);
    next.board[from] = '';
    next.board[to] = promotion ? (color === 'w' ? promotion.toUpperCase() : promotion.toLowerCase()) : piece;
    if (enPassant) {
      const captured = step(to, 0, color === 'w' ? -1 : 1);
      next.board[captured] = '';
    }
    if (castle) {
      const rank = color === 'w' ? 1 : 8;
      if (castle === 'K') { next.board[sq(7, rank)] = ''; next.board[sq(5, rank)] = color === 'w' ? 'R' : 'r'; }
      else { next.board[sq(0, rank)] = ''; next.board[sq(3, rank)] = color === 'w' ? 'R' : 'r'; }
    }
    // Castling rights
    let castling = next.castling;
    if (piece.toUpperCase() === 'K') castling = castling.replace(color === 'w' ? /[KQ]/g : /[kq]/g, '');
    const rookSquares = { a1: 'Q', h1: 'K', a8: 'q', h8: 'k' };
    for (const index of [from, to]) {
      const letter = rookSquares[name(index)];
      if (letter) castling = castling.replace(letter, '');
    }
    next.castling = castling;
    // En passant square after a double pawn push
    next.ep = '';
    if (piece.toUpperCase() === 'P' && Math.abs(rankOf(to) - rankOf(from)) === 2) {
      next.ep = name(step(from, 0, color === 'w' ? 1 : -1));
    }
    next.turn = color === 'w' ? 'b' : 'w';
    if (color === 'b') next.fullmove += 1;
    return next;
  }

  function leavesKingSafe(state, move) {
    const next = applyMove(state, move);
    const color = colorOf(state.board[move.from]);
    const king = kingIndex(next.board, color);
    return king === -1 || !isAttacked(next.board, king, color === 'w' ? 'b' : 'w');
  }

  // Candidate source squares for a piece type that can reach `to`.
  function piecesReaching(state, type, to, color) {
    const out = [];
    for (let i = 0; i < 64; i += 1) {
      const piece = state.board[i];
      if (!piece || colorOf(piece) !== color || piece.toUpperCase() !== type) continue;
      if (!attacksFrom(state.board, i).includes(to)) continue;
      const target = state.board[to];
      if (target && colorOf(target) === color) continue;
      out.push(i);
    }
    return out;
  }

  function resolveSan(state, san) {
    const color = state.turn;
    let text = san.replace(/[+#!?]+$/g, '').replace(/^\d+\.+/, '').trim();
    if (!text) return null;
    const rank = color === 'w' ? 1 : 8;

    if (/^(O-O-O|0-0-0)$/.test(text)) {
      const from = sq(4, rank);
      const move = { from, to: sq(2, rank), castle: 'Q' };
      return state.board[from].toUpperCase() === 'K' ? move : null;
    }
    if (/^(O-O|0-0)$/.test(text)) {
      const from = sq(4, rank);
      const move = { from, to: sq(6, rank), castle: 'K' };
      return state.board[from].toUpperCase() === 'K' ? move : null;
    }

    const match = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=?([QRBN]))?$/.exec(text);
    if (!match) return null;
    const [, pieceLetter, fileHint, rankHint, capture, target, , promotion] = match;
    const to = indexOf(target);

    if (!pieceLetter) {
      // Pawn move
      const dir = color === 'w' ? 1 : -1;
      const candidates = [];
      if (!capture && !fileHint) {
        const one = step(to, 0, -dir);
        if (one !== -1 && state.board[one] && state.board[one].toUpperCase() === 'P' && colorOf(state.board[one]) === color && !state.board[to]) candidates.push({ from: one, to });
        else if (one !== -1 && !state.board[one] && !state.board[to]) {
          const two = step(to, 0, -2 * dir);
          if (two !== -1 && state.board[two] && state.board[two].toUpperCase() === 'P' && colorOf(state.board[two]) === color && rankOf(two) === (color === 'w' ? 2 : 7)) candidates.push({ from: two, to });
        }
      } else {
        const fromFile = FILES.indexOf(fileHint || target[0]);
        const from = sq(fromFile, rankOf(to) - dir);
        if (from !== -1 && state.board[from] && state.board[from].toUpperCase() === 'P' && colorOf(state.board[from]) === color) {
          const enPassant = !state.board[to] && state.ep === target;
          if (state.board[to] || enPassant) candidates.push({ from, to, enPassant });
        }
      }
      const legal = candidates.filter((move) => leavesKingSafe(state, move));
      if (!legal.length) return null;
      return { ...legal[0], promotion: promotion || (rankOf(to) === (color === 'w' ? 8 : 1) ? 'Q' : undefined) };
    }

    let candidates = piecesReaching(state, pieceLetter, to, color);
    if (fileHint) candidates = candidates.filter((i) => FILES[fileOf(i)] === fileHint);
    if (rankHint) candidates = candidates.filter((i) => rankOf(i) === Number(rankHint));
    const legal = candidates.filter((from) => leavesKingSafe(state, { from, to }));
    if (!legal.length) return null;
    return { from: legal[0], to };
  }

  // ----------------------------------------------------------------- PGN

  // Removes brace comments, rest-of-line comments and variations from PGN
  // movetext with one pass, so a ';' inside braces or a '{' inside a line
  // comment cannot derail the parse the way regex passes did.
  function stripMovetext(text) {
    let out = '';
    let mode = 'moves';
    let depth = 0;
    for (const char of String(text || '')) {
      if (mode === 'brace') { if (char === '}') mode = 'moves'; continue; }
      if (mode === 'line') { if (char === '\n') { mode = 'moves'; out += ' '; } continue; }
      if (char === '{') { mode = 'brace'; out += ' '; continue; }
      if (char === ';') { mode = 'line'; continue; }
      if (char === '(') { depth += 1; continue; }
      if (char === ')') { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0) out += char;
    }
    return out.replace(/\$\d+/g, ' ');
  }

  function parsePgn(text) {
    const headers = {};
    const moveLines = [];
    for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      const header = /^\s*\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
      if (header) headers[header[1]] = header[2].replace(/\\"/g, '"');
      else moveLines.push(line);
    }
    const tokens = stripMovetext(moveLines.join('\n')).split(/\s+/).filter(Boolean);
    const moves = [];
    for (const token of tokens) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) break;
      const cleaned = token.replace(/^\d+\.+/, '').replace(/e\.p\.?$/i, '');
      if (!cleaned || /^\.+$/.test(cleaned) || cleaned === '--' || cleaned === 'Z0') continue;
      moves.push(cleaned);
    }
    return { headers, moves };
  }

  // Replays SAN moves and returns one entry per position (index 0 = start).
  function replay(moves, startFen = START_FEN) {
    let state;
    try {
      state = fromFen(startFen || START_FEN);
      if (state.board.length !== 64 || state.board.indexOf('K') === -1 || state.board.indexOf('k') === -1) throw new Error('bad fen');
    } catch {
      state = fromFen(START_FEN);
    }
    const positions = [{ fen: toFen(state), san: '', from: null, to: null }];
    let error = '';
    for (let i = 0; i < moves.length; i += 1) {
      const move = resolveSan(state, moves[i]);
      if (!move) { error = `${state.fullmove}${state.turn === 'b' ? '...' : '.'} ${moves[i]}`; break; }
      state = applyMove(state, move);
      positions.push({ fen: toFen(state), san: moves[i], from: name(move.from), to: name(move.to), ply: i + 1 });
    }
    return { positions, error };
  }

  // Splits a PGN file with several games into separate texts.
  function splitPgn(text) {
    const games = [];
    let current = [];
    let sawMoves = false;
    for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      const isHeader = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
      if (isHeader && sawMoves) { games.push(current.join('\n')); current = []; sawMoves = false; }
      if (!isHeader && line.trim()) sawMoves = true;
      current.push(line);
    }
    if (current.some((line) => line.trim())) games.push(current.join('\n'));
    return games.filter((game) => game.trim());
  }

  window.CHESS = { parsePgn, replay, splitPgn, stripMovetext, START_FEN };
})();
