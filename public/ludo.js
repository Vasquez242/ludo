/* ================= LUDO ROYAL — moteur de jeu complet ================= */
'use strict';

/* ---------- Constantes du plateau ---------- */
// Chemin principal : 52 cases, coordonnées [ligne, colonne] sur une grille 15x15
const PATH = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],[8,14],
  [8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],[6,0],
];

const COLORS = ['red', 'green', 'yellow', 'blue'];
const COLOR_NAMES = { red: 'Rouge', green: 'Vert', yellow: 'Jaune', blue: 'Bleu' };
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const HOME_PATHS = {
  red:    [[7,1],[7,2],[7,3],[7,4],[7,5]],
  green:  [[1,7],[2,7],[3,7],[4,7],[5,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9]],
  blue:   [[13,7],[12,7],[11,7],[10,7],[9,7]],
};

// Position des pions dans la base (coordonnées de cellule fractionnaires)
const BASE_SLOTS = {
  red:    [[1.7,1.7],[1.7,3.5],[3.5,1.7],[3.5,3.5]],
  green:  [[1.7,10.7],[1.7,12.5],[3.5,10.7],[3.5,12.5]],
  yellow: [[10.7,10.7],[10.7,12.5],[12.5,10.7],[12.5,12.5]],
  blue:   [[10.7,1.7],[10.7,3.5],[12.5,1.7],[12.5,3.5]],
};

// Décalages pour empiler plusieurs pions sur une même case
const STACK_OFFSETS = [[0,0],[-0.16,-0.16],[0.16,-0.16],[-0.16,0.16],[0.16,0.16]];

const FINISH_POS = 56; // 0..50 chemin principal, 51..55 colonne d'arrivée, 56 = arrivé
const CENTER = [7, 7];

/* ---------- Sons (WebAudio, sans fichiers) ---------- */
let soundOn = true;
let audioCtx = null;
function beep(freq, dur = 0.08, type = 'sine', vol = 0.15, when = 0) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime + when;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (_) { /* audio non disponible */ }
}
const sfx = {
  dice: () => { beep(220, 0.05, 'square', 0.08); beep(330, 0.05, 'square', 0.08, 0.07); beep(440, 0.06, 'square', 0.08, 0.14); },
  step: () => beep(520, 0.05, 'triangle', 0.1),
  capture: () => { beep(180, 0.15, 'sawtooth', 0.14); beep(120, 0.2, 'sawtooth', 0.12, 0.1); },
  finish: () => { beep(660, 0.1, 'sine', 0.14); beep(880, 0.12, 'sine', 0.14, 0.1); beep(1100, 0.16, 'sine', 0.14, 0.22); },
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.18, 'sine', 0.15, i * 0.12)); },
  out: () => { beep(392, 0.08, 'triangle', 0.13); beep(523, 0.1, 'triangle', 0.13, 0.09); },
  skip: () => beep(200, 0.12, 'sine', 0.08),
};

/* ---------- État du jeu ---------- */
const state = {
  players: [],       // { color, name, isAI, tokens: [pos x4], finishedRank }
  current: 0,
  dice: 0,
  rolled: false,
  sixCount: 0,
  busy: false,
  gameOver: false,
  ranking: [],
};

/* ---------- État Multijoueur ---------- */
const mp = {
  active: false,
  role: 'local', // 'local' | 'host' | 'client'
  peer: null,
  conn: {}, // PeerID -> connection (Host) ou RoomCode -> connection (Client)
  roomCode: null,
  myColor: 'red', // Hôte est Rouge par défaut
  players: [], // Liste des joueurs du salon : { peerId, name, color, isAI, connected }
};

let setupCount = 4;
let setupTypes = { red: 'human', green: 'ai', yellow: 'ai', blue: 'ai' };

const COLOR_SETS = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: COLORS };

/* ---------- Éléments DOM ---------- */
const $ = (s) => document.querySelector(s);
const setupScreen = $('#setup-screen');
const gameScreen = $('#game-screen');
const boardEl = $('#board');
const diceBtn = $('#dice');
const diceFace = $('#dice-face');
const turnLabel = $('#turn-label');
const hintEl = $('#hint');
const logEl = $('#log');
const playersListEl = $('#players-list');
const victoryModal = $('#victory-modal');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== ÉCRAN DE CONFIGURATION ==================== */
function renderSetup() {
  const cfg = $('#player-config');
  cfg.innerHTML = '';
  COLOR_SETS[setupCount].forEach((color) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <span class="dot ${color}" style="background: var(--${color})"></span>
      <span class="pname">${COLOR_NAMES[color]}</span>
      <div class="type-toggle" role="radiogroup" aria-label="Type de joueur ${COLOR_NAMES[color]}">
        <button data-t="human" class="${setupTypes[color] === 'human' ? 'active' : ''}">Humain</button>
        <button data-t="ai" class="${setupTypes[color] === 'ai' ? 'active' : ''}">IA</button>
      </div>`;
    row.querySelectorAll('.type-toggle button').forEach((b) => {
      b.addEventListener('click', () => {
        setupTypes[color] = b.dataset.t;
        renderSetup();
      });
    });
    cfg.appendChild(row);
  });
}

document.querySelectorAll('.count-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.count-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    setupCount = Number(b.dataset.count);
    renderSetup();
  });
});

$('#start-btn').addEventListener('click', () => {
  requestShakePermission();
  startGame();
});
$('#restart-btn').addEventListener('click', () => {
  victoryModal.classList.remove('show');
  gameScreen.classList.remove('active');
  setupScreen.classList.add('active');
});
$('#new-game-btn').addEventListener('click', () => {
  victoryModal.classList.remove('show');
  gameScreen.classList.remove('active');
  setupScreen.classList.add('active');
});
$('#continue-btn').addEventListener('click', () => {
  victoryModal.classList.remove('show');
  if (!state.gameOver) nextTurn(false);
});
$('#sound-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  $('#sound-on-icon').style.display = soundOn ? '' : 'none';
  $('#sound-off-icon').style.display = soundOn ? 'none' : '';
});

// --- Gestion des onglets de configuration ---
$('#btn-mode-local').addEventListener('click', () => {
  $('#btn-mode-local').classList.add('active');
  $('#btn-mode-online').classList.remove('active');
  $('#local-setup').style.display = 'block';
  $('#online-setup').style.display = 'none';
  $('#start-btn').style.display = 'block';
  mp.active = false;
  if (mp.peer) {
    mp.peer.destroy();
    mp.peer = null;
  }
});

$('#btn-mode-online').addEventListener('click', () => {
  $('#btn-mode-local').classList.remove('active');
  $('#btn-mode-online').classList.add('active');
  $('#local-setup').style.display = 'none';
  $('#online-setup').style.display = 'block';
  // Par défaut en ligne, on montre le panneau Hôte
  $('#btn-choose-host').classList.add('active');
  $('#btn-choose-join').classList.remove('active');
  $('#online-host-pane').style.display = 'flex';
  $('#online-join-pane').style.display = 'none';
  $('#start-btn').style.display = 'block'; // L'hôte peut lancer
  initHost();
});

$('#btn-choose-host').addEventListener('click', () => {
  $('#btn-choose-host').classList.add('active');
  $('#btn-choose-join').classList.remove('active');
  $('#online-host-pane').style.display = 'flex';
  $('#online-join-pane').style.display = 'none';
  $('#start-btn').style.display = 'block';
  initHost();
});

$('#btn-choose-join').addEventListener('click', () => {
  $('#btn-choose-host').classList.remove('active');
  $('#btn-choose-join').classList.add('active');
  $('#online-host-pane').style.display = 'none';
  $('#online-join-pane').style.display = 'flex';
  $('#start-btn').style.display = 'none'; // Les clients ne lancent pas
  if (mp.peer && mp.role === 'host') {
    mp.peer.destroy();
    mp.peer = null;
  }
});

$('#btn-copy-code').addEventListener('click', () => {
  const code = $('#room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const orig = $('#btn-copy-code').textContent;
    $('#btn-copy-code').textContent = 'Copié !';
    setTimeout(() => $('#btn-copy-code').textContent = orig, 1500);
  }).catch(console.error);
});

$('#btn-share-whatsapp').addEventListener('click', () => {
  const code = $('#room-code-display').textContent;
  const shareUrl = `${window.location.origin}/ludo.html?join=${code}`;
  const text = `Rejoins ma partie de Ludo Royal ! 👑\nCode du salon : ${code}\nClique ici pour jouer : ${shareUrl}`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
});

$('#share-result-btn').addEventListener('click', () => {
  let myRank = 1;
  if (mp.active) {
    const selfPlayer = state.players.find(p => p.color === mp.myColor);
    if (selfPlayer) {
      myRank = selfPlayer.finishedRank || (state.ranking.includes(selfPlayer) ? state.ranking.indexOf(selfPlayer) + 1 : state.players.length);
    }
  } else {
    // Mode local, prend le classement de la couleur rouge
    const redPlayer = state.players.find(p => p.color === 'red');
    if (redPlayer) {
      myRank = redPlayer.finishedRank || (state.ranking.includes(redPlayer) ? state.ranking.indexOf(redPlayer) + 1 : state.players.length);
    }
  }

  const rankText = myRank === 1 ? '1er 🏆' : `${myRank}e`;
  const text = `J'ai terminé ${rankText} à Ludo Royal ! 👑 Rejoins-moi pour une partie : ${window.location.origin}/ludo.html`;

  if (navigator.share) {
    navigator.share({
      title: 'Ludo Royal — Mon Score',
      text: text,
      url: `${window.location.origin}/ludo.html`
    }).catch(console.error);
  } else {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  }
});

$('#join-btn').addEventListener('click', () => {
  requestShakePermission();
  const code = $('#room-code-input').value.trim();
  const name = $('#player-name-input').value.trim();
  if (!code) {
    alert('Veuillez entrer un code de salon.');
    return;
  }
  if (!name) {
    alert('Veuillez entrer votre pseudo.');
    return;
  }
  initClient(code, name);
});

/* ==================== CONSTRUCTION DU PLATEAU ==================== */
const STAR_SVG = `<svg viewBox="0 0 24 24" fill="#8a8371"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>`;
const ARROW_SVGS = {
  red: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 11h12l-4-4 1.5-1.5L21 12l-7.5 6.5L12 17l4-4H4z"/></svg>`,
  green: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M13 4v12l4-4 1.5 1.5L12 21l-6.5-7.5L7 12l4 4V4z"/></svg>`,
  yellow: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M20 13H8l4 4-1.5 1.5L3 12l7.5-6.5L12 7l-4 4h12z"/></svg>`,
  blue: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M11 20V8l-4 4-1.5-1.5L12 3l6.5 7.5L17 12l-4-4v12z"/></svg>`,
};

function buildBoard() {
  boardEl.innerHTML = '';

  // Bases (4 coins)
  COLORS.forEach((color) => {
    const base = document.createElement('div');
    base.className = `base ${color}`;
    base.id = `base-${color}`;
    base.innerHTML = `<div class="base-inner">${'<div class="base-slot"></div>'.repeat(4)}</div>`;
    boardEl.appendChild(base);
  });

  // Cases du chemin principal
  PATH.forEach(([r, c], i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.top = `${(r / 15) * 100}%`;
    cell.style.left = `${(c / 15) * 100}%`;
    // cases de départ colorées avec flèche
    const startColor = Object.keys(START_INDEX).find((k) => START_INDEX[k] === i);
    if (startColor) {
      cell.classList.add(`c-${startColor}`);
      cell.innerHTML = ARROW_SVGS[startColor];
    } else if (SAFE_CELLS.has(i)) {
      cell.innerHTML = STAR_SVG;
    }
    boardEl.appendChild(cell);
  });

  // Colonnes d'arrivée colorées
  COLORS.forEach((color) => {
    HOME_PATHS[color].forEach(([r, c]) => {
      const cell = document.createElement('div');
      cell.className = `cell c-${color}`;
      cell.style.top = `${(r / 15) * 100}%`;
      cell.style.left = `${(c / 15) * 100}%`;
      boardEl.appendChild(cell);
    });
  });

  // Centre (maison finale)
  const center = document.createElement('div');
  center.className = 'center-home';
  center.innerHTML = `<div class="tri red"></div><div class="tri green"></div><div class="tri yellow"></div><div class="tri blue"></div>`;
  boardEl.appendChild(center);

  // Dé : 9 points
  diceFace.innerHTML = '<div class="pip-dot"></div>'.repeat(9);
  diceFace.dataset.v = '6';
}

/* ==================== POSITIONS & RENDU DES PIONS ==================== */
function coordFor(color, pos, tokenIdx) {
  if (pos === -1) return BASE_SLOTS[color][tokenIdx];
  if (pos <= 50) return PATH[(START_INDEX[color] + pos) % 52];
  if (pos <= 55) return HOME_PATHS[color][pos - 51];
  return CENTER;
}

function tokenId(pIdx, tIdx) { return `token-${pIdx}-${tIdx}`; }

function createTokens() {
  document.querySelectorAll('.token').forEach((t) => t.remove());
  state.players.forEach((p, pIdx) => {
    p.tokens.forEach((_, tIdx) => {
      const el = document.createElement('button');
      el.className = `token ${p.color}`;
      el.id = tokenId(pIdx, tIdx);
      el.setAttribute('aria-label', `Pion ${COLOR_NAMES[p.color]} ${tIdx + 1}`);
      el.addEventListener('click', () => onTokenClick(pIdx, tIdx));
      boardEl.appendChild(el);
    });
  });
  renderTokens();
}

function renderTokens() {
  if (document.querySelectorAll('.token').length === 0 && state.players.length > 0) {
    createTokens();
    return;
  }

  // regrouper par case pour gérer l'empilement
  const groups = {};
  state.players.forEach((p, pIdx) => {
    p.tokens.forEach((pos, tIdx) => {
      const [r, c] = coordFor(p.color, pos, tIdx);
      const key = pos === -1 ? `base-${pIdx}-${tIdx}` : `${r},${c}`;
      (groups[key] = groups[key] || []).push({ pIdx, tIdx, r, c, pos });
    });
  });

  Object.values(groups).forEach((items) => {
    items.forEach(({ pIdx, tIdx, r, c, pos }, i) => {
      const el = document.getElementById(tokenId(pIdx, tIdx));
      if (!el) return;
      const [or, oc] = items.length > 1 ? STACK_OFFSETS[Math.min(i, 4)] : [0, 0];
      // centrer le pion dans la case (pion = 0.78 case)
      el.style.top = `${((r + 0.11 + or) / 15) * 100}%`;
      el.style.left = `${((c + 0.11 + oc) / 15) * 100}%`;
      el.classList.toggle('finished', pos === FINISH_POS);
    });
  });
}

/* ==================== PANNEAU LATÉRAL ==================== */
function renderPlayers() {
  playersListEl.innerHTML = '';
  state.players.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'player-card';
    if (i === state.current && !state.gameOver && p.finishedRank === 0) card.classList.add('active');
    if (p.finishedRank > 0) card.classList.add('done-player');
    const pips = p.tokens.map((t) => `<span class="pip ${t === FINISH_POS ? 'done' : ''}"></span>`).join('');
    const medal = p.finishedRank > 0 ? `<span class="medal">${p.finishedRank}ᵉ</span>` : '';
    card.innerHTML = `
      <span class="dot ${p.color}"></span>
      <div class="info">
        <div class="name">${p.name} <span class="tag">${p.isAI ? 'IA' : 'Humain'}</span> ${medal}</div>
        <div class="progress">${pips}</div>
      </div>`;
    playersListEl.appendChild(card);
  });

  // surbrillance de la base active
  COLORS.forEach((c) => {
    const b = document.getElementById(`base-${c}`);
    if (b) b.classList.toggle('active-base', !state.gameOver && state.players[state.current]?.color === c);
  });
}

function log(msg, gold = false) {
  const p = document.createElement('p');
  p.innerHTML = msg;
  if (gold) p.classList.add('gold');
  logEl.prepend(p);
  while (logEl.children.length > 40) logEl.lastChild.remove();
}

function setHint(t) { hintEl.textContent = t; }

/* ==================== DÉMARRAGE ==================== */
function startGame() {
  if (mp.active && mp.role === 'host') {
    if (!mp.peer || !mp.peer.open) {
      alert('Le salon n\'est pas encore prêt. Patientez une seconde puis réessayez.');
      return;
    }
    if (!mp.players || mp.players.length === 0) {
      mp.players = [{ peerId: mp.peer.id, name: 'Hôte (Rouge)', color: 'red', isAI: false, connected: true }];
      fillLobbySlotsWithAI();
    }

    Object.values(mp.conn).forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'START_GAME' });
      }
    });

    state.players = mp.players.map(p => ({
      color: p.color,
      name: p.name,
      isAI: p.isAI,
      tokens: [-1, -1, -1, -1],
      finishedRank: 0
    }));
  } else {
    state.players = COLOR_SETS[setupCount].map((color) => ({
      color,
      name: COLOR_NAMES[color],
      isAI: setupTypes[color] === 'ai',
      tokens: [-1, -1, -1, -1],
      finishedRank: 0,
    }));
  }
  state.current = 0;
  state.dice = 0;
  state.rolled = false;
  state.sixCount = 0;
  state.busy = false;
  state.gameOver = false;
  state.ranking = [];

  setupScreen.classList.remove('active');
  gameScreen.classList.add('active');
  logEl.innerHTML = '';

  buildBoard();
  createTokens();
  renderPlayers();
  log('La partie commence. Bonne chance !', true);
  beginTurn();
}

/* ==================== LOGIQUE DES TOURS ==================== */
function currentPlayer() {
  return state.players[state.current] || null;
}

function beginTurn() {
  if (state.gameOver) return;
  const p = currentPlayer();
  state.rolled = false;
  state.dice = 0;
  turnLabel.innerHTML = `Au tour de <strong style="color: var(--${p.color})">${p.name}</strong>`;
  renderPlayers();
  clearMovable();

  if (mp.active) {
    if (mp.role === 'client') {
      updateOnlineControls();
      enableShakeListener();
      return;
    }
    // Hôte
    updateOnlineControls();
    if (p.isAI) {
      diceBtn.disabled = true;
      setHint(`${p.name} (IA) réfléchit…`);
      setTimeout(() => rollDice(), 750);
    } else {
      enableShakeListener();
    }
  } else {
    // Mode local standard
    if (p.isAI) {
      diceBtn.disabled = true;
      setHint(`${p.name} (IA) réfléchit…`);
      setTimeout(() => rollDice(), 750);
    } else {
      diceBtn.disabled = false;
      setHint('Cliquez sur le dé pour lancer');
      enableShakeListener();
    }
  }
}

function nextTurn(extraTurn) {
  if (state.gameOver) return;
  if (!extraTurn) {
    state.sixCount = 0;
    let n = state.current;
    do { n = (n + 1) % state.players.length; } while (state.players[n].finishedRank > 0);
    state.current = n;
  }
  beginTurn();
  if (mp.active && mp.role === 'host') broadcastState();
}

/* ---------- Lancer de dé ---------- */
diceBtn.addEventListener('click', () => {
  requestShakePermission();
  if (state.busy || state.rolled || currentPlayer().isAI) return;
  rollDice();
});

async function rollDice() {
  disableShakeListener();
  if (state.busy || state.rolled) return;

  if (mp.active && mp.role === 'client') {
    const conn = mp.conn[mp.roomCode];
    if (conn && conn.open) {
      conn.send({ type: 'ROLL_DICE' });
    }
    return;
  }

  state.busy = true;
  state.rolled = true;
  diceBtn.disabled = true;
  sfx.dice();

  // animation de roulement
  diceFace.classList.add('rolling');
  const animEnd = sleep(560);
  const flicker = setInterval(() => {
    diceFace.dataset.v = String(1 + Math.floor(Math.random() * 6));
  }, 80);
  await animEnd;
  clearInterval(flicker);
  diceFace.classList.remove('rolling');

  const value = 1 + Math.floor(Math.random() * 6);
  state.dice = value;
  diceFace.dataset.v = String(value);

  const p = currentPlayer();
  log(`<strong>${p.name}</strong> lance le dé : <strong>${value}</strong>`);

  if (mp.active && mp.role === 'host') {
    broadcastState();
  }

  // règle des trois 6 consécutifs
  if (value === 6) {
    state.sixCount++;
    if (state.sixCount === 3) {
      log(`${p.name} a fait trois 6 de suite — tour perdu !`);
      setHint('Trois 6 de suite : tour perdu !');
      sfx.skip();
      state.busy = false;
      await sleep(1100);
      nextTurn(false);
      return;
    }
  } else {
    state.sixCount = 0;
  }

  const movable = getMovableTokens(state.current, value);

  if (movable.length === 0) {
    setHint(`Aucun mouvement possible avec un ${value}`);
    sfx.skip();
    state.busy = false;
    await sleep(1000);
    nextTurn(value === 6);
    return;
  }

  state.busy = false;

  if (p.isAI) {
    await sleep(550);
    const choice = aiChooseMove(state.current, value, movable);
    await moveToken(state.current, choice);
  } else if (movable.length === 1) {
    // un seul coup possible : jouer automatiquement
    setHint('Un seul coup possible — déplacement automatique');
    await sleep(500);
    await moveToken(state.current, movable[0]);
  } else {
    highlightMovable(movable);
    setHint('Choisissez un pion à déplacer');
  }
}

/* ---------- Coups possibles ---------- */
function getMovableTokens(pIdx, dice) {
  const p = state.players[pIdx];
  const res = [];
  p.tokens.forEach((pos, tIdx) => {
    if (pos === FINISH_POS) return;
    if (pos === -1) {
      if (dice === 6) res.push(tIdx);
    } else if (pos + dice <= FINISH_POS) {
      res.push(tIdx);
    }
  });
  return res;
}

function highlightMovable(tokenIdxs) {
  clearMovable();
  tokenIdxs.forEach((tIdx) => {
    document.getElementById(tokenId(state.current, tIdx))?.classList.add('movable');
  });
}
function clearMovable() {
  document.querySelectorAll('.token.movable').forEach((t) => t.classList.remove('movable'));
}

function onTokenClick(pIdx, tIdx) {
  if (state.busy || state.gameOver) return;
  if (pIdx !== state.current || !state.rolled) return;
  if (currentPlayer().isAI) return;
  const el = document.getElementById(tokenId(pIdx, tIdx));
  if (!el.classList.contains('movable')) return;

  if (mp.active && mp.role === 'client') {
    const conn = mp.conn[mp.roomCode];
    if (conn && conn.open) {
      conn.send({ type: 'MOVE_TOKEN', tIdx: tIdx });
    }
    return;
  }

  moveToken(pIdx, tIdx);
}

/* ---------- Déplacement ---------- */
function absCell(color, pos) {
  return pos >= 0 && pos <= 50 ? (START_INDEX[color] + pos) % 52 : -1;
}

async function moveToken(pIdx, tIdx) {
  state.busy = true;
  clearMovable();
  const p = state.players[pIdx];
  const el = document.getElementById(tokenId(pIdx, tIdx));
  const dice = state.dice;
  let extraTurn = dice === 6;

  if (mp.active && mp.role === 'host') {
    broadcastAnimateMove(pIdx, tIdx, dice);
  }

  if (p.tokens[tIdx] === -1) {
    // sortie de base
    p.tokens[tIdx] = 0;
    sfx.out();
    el.classList.add('hop');
    renderTokens();
    log(`<strong>${p.name}</strong> sort un pion de sa base`);
    await sleep(320);
    el.classList.remove('hop');
  } else {
    // avancer case par case
    for (let s = 0; s < dice; s++) {
      p.tokens[tIdx]++;
      sfx.step();
      el.classList.add('hop');
      renderTokens();
      await sleep(230);
      el.classList.remove('hop');
    }
  }

  const newPos = p.tokens[tIdx];

  // Capture ?
  if (newPos >= 0 && newPos <= 50) {
    const cell = absCell(p.color, newPos);
    if (!SAFE_CELLS.has(cell)) {
      for (let oi = 0; oi < state.players.length; oi++) {
        if (oi === pIdx) continue;
        const opp = state.players[oi];
        opp.tokens.forEach((opos, otIdx) => {
          if (opos >= 0 && opos <= 50 && absCell(opp.color, opos) === cell) {
            opp.tokens[otIdx] = -1;
            const oel = document.getElementById(tokenId(oi, otIdx));
            oel.classList.add('captured-anim');
            setTimeout(() => oel.classList.remove('captured-anim'), 520);
            log(`<strong>${p.name}</strong> capture un pion de <strong>${opp.name}</strong> !`, true);
            sfx.capture();
            extraTurn = true;
          }
        });
      }
      renderTokens();
    }
  }

  // Pion arrivé ?
  if (newPos === FINISH_POS) {
    sfx.finish();
    log(`<strong>${p.name}</strong> amène un pion à la maison !`, true);
    extraTurn = true;

    if (p.tokens.every((t) => t === FINISH_POS)) {
      p.finishedRank = state.ranking.length + 1;
      state.ranking.push(p);
      sfx.win();
      log(`🏆 <strong>${p.name}</strong> termine ${p.finishedRank === 1 ? 'premier' : p.finishedRank + 'ᵉ'} !`, true);
      renderPlayers();

      const remaining = state.players.filter((x) => x.finishedRank === 0);
      if (remaining.length <= 1) {
        remaining.forEach((x) => {
          x.finishedRank = state.ranking.length + 1;
          state.ranking.push(x);
        });
        state.gameOver = true;
      }
      showVictory(p);
      if (mp.active && mp.role === 'host') broadcastState();
      state.busy = false;
      return;
    }
  }

  renderPlayers();
  if (mp.active && mp.role === 'host') broadcastState();
  state.busy = false;
  await sleep(250);
  nextTurn(extraTurn);
}

/* ==================== IA ==================== */
function aiChooseMove(pIdx, dice, movable) {
  const p = state.players[pIdx];
  let best = movable[0];
  let bestScore = -Infinity;

  movable.forEach((tIdx) => {
    const pos = p.tokens[tIdx];
    const newPos = pos === -1 ? 0 : pos + dice;
    let score = 0;

    // terminer un pion
    if (newPos === FINISH_POS) score += 120;
    // entrer dans la colonne d'arrivée
    else if (newPos >= 51) score += 55;

    // sortir de base
    if (pos === -1) score += 45;

    if (newPos >= 0 && newPos <= 50) {
      const cell = absCell(p.color, newPos);
      // capture possible
      if (!SAFE_CELLS.has(cell)) {
        for (let oi = 0; oi < state.players.length; oi++) {
          if (oi === pIdx) continue;
          const opp = state.players[oi];
          if (opp.tokens.some((op) => op >= 0 && op <= 50 && absCell(opp.color, op) === cell)) {
            score += 90;
          }
        }
      } else {
        score += 25; // atterrir sur une case sûre
      }

      // danger : un adversaire à 1-6 cases derrière la nouvelle position
      for (let oi = 0; oi < state.players.length; oi++) {
        if (oi === pIdx) continue;
        const opp = state.players[oi];
        opp.tokens.forEach((op) => {
          if (op >= 0 && op <= 50) {
            const oc = absCell(opp.color, op);
            const dist = (cell - oc + 52) % 52;
            if (dist >= 1 && dist <= 6) score -= 18;
          }
        });
      }
    }

    // préférer avancer le pion le plus proche de l'arrivée
    score += (pos === -1 ? 0 : pos) * 0.4;
    // léger aléa pour varier le jeu
    score += Math.random() * 4;

    if (score > bestScore) { bestScore = score; best = tIdx; }
  });

  return best;
}

/* ==================== VICTOIRE ==================== */
function showVictory(winner) {
  $('#victory-title').textContent = state.gameOver ? 'Partie terminée !' : 'Victoire !';
  $('#victory-text').textContent = state.gameOver
    ? 'Classement final de la partie :'
    : `${winner.name} a amené ses 4 pions à la maison !`;

  const rk = $('#ranking');
  rk.innerHTML = '';
  state.ranking.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `<span class="place">${p.finishedRank}ᵉ</span><span class="dot ${p.color}"></span><span>${p.name}</span>`;
    rk.appendChild(row);
  });

  $('#continue-btn').style.display = state.gameOver ? 'none' : '';

  // confettis
  const conf = victoryModal.querySelector('.confetti');
  conf.innerHTML = '';
  const palette = ['#e5484d', '#30a46c', '#f0b429', '#3e7bfa', '#e3b94d'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = palette[i % palette.length];
    s.style.animationDuration = `${2.2 + Math.random() * 2.5}s`;
    s.style.animationDelay = `${Math.random() * 2}s`;
    conf.appendChild(s);
  }

  victoryModal.classList.add('show');
}

/* ==================== MULTIJOUEUR EN LIGNE (PEERJS) ==================== */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'LUDO-' + code;
}

const peerOptions = {
  host: '0.peerjs.com',
  secure: true,
  port: 443,
  debug: 1
};

// --- HÔTE (HOST) ---
function initHost() {
  mp.active = true;
  mp.role = 'host';
  mp.myColor = 'red';
  mp.roomCode = generateRoomCode();
  $('#room-code-display').textContent = mp.roomCode;

  if (mp.peer) mp.peer.destroy();

  mp.peer = new Peer(mp.roomCode, peerOptions);

  mp.peer.on('open', () => {
    log(`Salon créé. Code : <strong>${mp.roomCode}</strong> (Copiable en un clic)`, true);
    // L'hôte est toujours le premier joueur (Rouge)
    mp.players = [{ peerId: mp.peer.id, name: 'Hôte (Rouge)', color: 'red', isAI: false, connected: true }];
    // Compléter les slots temporaires avec IA
    fillLobbySlotsWithAI();
    updateHostLobbyUI();
  });

  mp.peer.on('error', (err) => {
    console.error(err);
    if (err.type === 'unavailable-id') {
      initHost(); // Si l'identifiant est déjà pris, on réessaie avec un autre code
    } else {
      log(`<span style="color:var(--red)">Erreur de création de salon : ${err.type}</span>`);
    }
  });

  mp.peer.on('connection', (conn) => {
    conn.on('open', () => {
      conn.on('data', (data) => handleHostMessage(conn, data));
    });
    conn.on('close', () => {
      handleClientDisconnection(conn.peer);
    });
    conn.on('error', () => {
      handleClientDisconnection(conn.peer);
    });
  });
}

function fillLobbySlotsWithAI() {
  const activeColors = COLOR_SETS[setupCount];
  // Conserver les joueurs humains déjà connectés
  const humanPlayers = mp.players.filter(p => !p.isAI);

  mp.players = [...humanPlayers];

  activeColors.forEach((color) => {
    if (!mp.players.some(p => p.color === color)) {
      mp.players.push({
        peerId: 'AI-' + color,
        name: `Joueur ${COLOR_NAMES[color]} (IA)`,
        color: color,
        isAI: true,
        connected: true
      });
    }
  });
}

function updateHostLobbyUI() {
  const listEl = $('#online-connected-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  mp.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'connected-player';
    div.innerHTML = `
      <span class="dot ${p.color}" style="width:12px;height:12px;border-radius:50%;display:inline-block;background:var(--${p.color})"></span>
      <span style="font-weight:600;margin-left:8px;flex:1">${p.name}</span>
      <span class="tag" style="font-size:10px;padding:2px 6px;background:var(--bg);border-radius:4px">${p.isAI ? 'IA' : 'Humain'}</span>
    `;
    listEl.appendChild(div);
  });
}

function broadcastLobby() {
  Object.values(mp.conn).forEach(conn => {
    if (conn.open) {
      conn.send({
        type: 'ROOM_UPDATE',
        players: mp.players,
        maxCount: setupCount
      });
    }
  });
}

function broadcastState() {
  if (mp.role !== 'host') return;
  const serializedState = {
    players: state.players.map(p => ({
      color: p.color,
      name: p.name,
      isAI: p.isAI,
      tokens: [...p.tokens],
      finishedRank: p.finishedRank
    })),
    current: state.current,
    dice: state.dice,
    rolled: state.rolled,
    sixCount: state.sixCount,
    busy: state.busy,
    gameOver: state.gameOver,
    ranking: state.ranking.map(p => p.color) // On envoie les couleurs dans l'ordre de classement
  };

  Object.values(mp.conn).forEach(conn => {
    if (conn.open) {
      conn.send({
        type: 'SYNC_STATE',
        state: serializedState
      });
    }
  });
}

function handleHostMessage(conn, data) {
  if (data.type === 'JOIN') {
    // Trouver le premier emplacement IA disponible pour le remplacer
    const nextAiSlot = mp.players.find(p => p.isAI);
    if (!nextAiSlot) {
      conn.send({ type: 'ERROR', message: 'Le salon est complet.' });
      conn.close();
      return;
    }

    // Assigner la couleur et configurer la connexion
    conn.color = nextAiSlot.color;
    conn.playerName = data.name || `Joueur ${COLOR_NAMES[conn.color]}`;
    mp.conn[conn.peer] = conn;

    // Mettre à jour l'entrée dans le lobby
    nextAiSlot.peerId = conn.peer;
    nextAiSlot.name = conn.playerName;
    nextAiSlot.isAI = false;
    nextAiSlot.connected = true;

    log(`<strong>${conn.playerName}</strong> a rejoint le salon !`, true);
    updateHostLobbyUI();
    broadcastLobby();
  }

  if (data.type === 'ROLL_DICE') {
    const p = currentPlayer();
    if (p.color === conn.color && !state.rolled && !state.busy) {
      rollDice();
    }
  }

  if (data.type === 'MOVE_TOKEN') {
    const p = currentPlayer();
    if (p.color === conn.color && state.rolled && !state.busy) {
      const movable = getMovableTokens(state.current, state.dice);
      if (movable.includes(data.tIdx)) {
        moveToken(state.current, data.tIdx);
      }
    }
  }
}

function handleClientDisconnection(peerId) {
  const conn = mp.conn[peerId];
  if (conn) {
    log(`Le joueur <strong>${conn.playerName}</strong> s'est déconnecté.`, true);
    delete mp.conn[peerId];

    // Remplacer le joueur par une IA dans le lobby ou dans la partie en cours
    const lobbyPlayer = mp.players.find(p => p.peerId === peerId);
    if (lobbyPlayer) {
      lobbyPlayer.peerId = 'AI-' + lobbyPlayer.color;
      lobbyPlayer.name = `Joueur ${COLOR_NAMES[lobbyPlayer.color]} (IA)`;
      lobbyPlayer.isAI = true;
    }

    if (gameScreen.classList.contains('active')) {
      const pIdx = state.players.findIndex(p => p.color === conn.color);
      if (pIdx !== -1) {
        state.players[pIdx].isAI = true;
        state.players[pIdx].name = `Joueur ${COLOR_NAMES[conn.color]} (IA)`;
        renderPlayers();
        // Si c'était son tour, l'IA prend le relais après un court délai
        if (state.current === pIdx && !state.busy) {
          if (!state.rolled) {
            setTimeout(() => rollDice(), 750);
          } else {
            const movable = getMovableTokens(state.current, state.dice);
            if (movable.length > 0) {
              const choice = aiChooseMove(state.current, state.dice, movable);
              setTimeout(() => moveToken(state.current, choice), 550);
            } else {
              nextTurn(state.dice === 6);
            }
          }
        }
      }
      broadcastState();
    } else {
      updateHostLobbyUI();
      broadcastLobby();
    }
  }
}

// --- CLIENT ---
function initClient(roomCode, name) {
  mp.active = true;
  mp.role = 'client';
  mp.roomCode = roomCode.toUpperCase().trim();

  if (mp.peer) mp.peer.destroy();

  const randomClientId = 'LUDO-CLIENT-' + Math.floor(Math.random() * 100000);
  mp.peer = new Peer(randomClientId, peerOptions);

  mp.peer.on('open', () => {
    log(`Connexion au salon <strong>${mp.roomCode}</strong>...`);
    const conn = mp.peer.connect(mp.roomCode);
    mp.conn[mp.roomCode] = conn;

    conn.on('open', () => {
      log(`Connecté ! Envoi des informations d'inscription...`);
      conn.send({ type: 'JOIN', name: name });
    });

    conn.on('data', (data) => handleClientMessage(data));

    conn.on('close', () => {
      alert("Déconnecté de l'hôte. Retour à la configuration.");
      location.reload();
    });

    conn.on('error', (err) => {
      console.error(err);
      alert(`Erreur de connexion : ${err}`);
      location.reload();
    });
  });

  mp.peer.on('error', (err) => {
    console.error(err);
    alert(`Erreur Peer : ${err.type}`);
    location.reload();
  });
}

function handleClientMessage(data) {
  if (data.type === 'ERROR') {
    alert(data.message);
    location.reload();
  }

  if (data.type === 'ROOM_UPDATE') {
    setupCount = data.maxCount;
    mp.players = data.players;

    const selfPlayer = mp.players.find(p => p.peerId === mp.peer.id);
    if (selfPlayer) {
      mp.myColor = selfPlayer.color;
    }
    updateClientLobbyUI();
  }

  if (data.type === 'START_GAME') {
    setupScreen.classList.remove('active');
    gameScreen.classList.add('active');
    logEl.innerHTML = '';

    buildBoard();
    createTokens();
    renderPlayers();
    log('La partie commence en ligne !', true);
  }

  if (data.type === 'ANIMATE_MOVE') {
    clientAnimateMove(data.pIdx, data.tIdx, data.dice);
  }

  if (data.type === 'SYNC_STATE') {
    // Mettre à jour l'état de jeu avec celui reçu de l'hôte
    state.current = data.state.current;
    state.dice = data.state.dice;
    state.rolled = data.state.rolled;
    state.sixCount = data.state.sixCount;
    state.busy = data.state.busy;
    state.gameOver = data.state.gameOver;

    // Mettre à jour la face du dé visuellement
    diceFace.dataset.v = String(state.dice || 6);

    // Reconstruire les joueurs
    state.players = data.state.players.map(p => ({
      color: p.color,
      name: p.name,
      isAI: p.isAI,
      tokens: [...p.tokens],
      finishedRank: p.finishedRank
    }));

    // Reconstruire le classement final
    state.ranking = data.state.ranking.map(color => state.players.find(p => p.color === color));

    renderTokens();
    renderPlayers();
    updateOnlineControls();

    if (state.gameOver) {
      const winner = state.ranking[0];
      showVictory(winner);
    }
  }
}

function broadcastAnimateMove(pIdx, tIdx, dice) {
  Object.values(mp.conn).forEach(conn => {
    if (conn.open) {
      conn.send({
        type: 'ANIMATE_MOVE',
        pIdx: pIdx,
        tIdx: tIdx,
        dice: dice
      });
    }
  });
}

async function clientAnimateMove(pIdx, tIdx, dice) {
  state.busy = true;
  clearMovable();
  const p = state.players[pIdx];
  const el = document.getElementById(tokenId(pIdx, tIdx));
  if (!el) {
    state.busy = false;
    return;
  }

  if (p.tokens[tIdx] === -1) {
    p.tokens[tIdx] = 0;
    sfx.out();
    el.classList.add('hop');
    renderTokens();
    await sleep(320);
    el.classList.remove('hop');
  } else {
    for (let s = 0; s < dice; s++) {
      p.tokens[tIdx]++;
      sfx.step();
      el.classList.add('hop');
      renderTokens();
      await sleep(230);
      el.classList.remove('hop');
    }
  }
  state.busy = false;
}

function updateClientLobbyUI() {
  const listEl = $('#online-connected-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  mp.players.forEach(p => {
    const isMe = p.peerId === mp.peer.id;
    const div = document.createElement('div');
    div.className = 'connected-player';
    div.innerHTML = `
      <span class="dot ${p.color}" style="width:12px;height:12px;border-radius:50%;display:inline-block;background:var(--${p.color})"></span>
      <span style="font-weight:600;margin-left:8px;flex:1">${p.name} ${isMe ? '<strong>(Vous)</strong>' : ''}</span>
      <span class="tag" style="font-size:10px;padding:2px 6px;background:var(--bg);border-radius:4px">${p.isAI ? 'IA' : 'Humain'}</span>
    `;
    listEl.appendChild(div);
  });
}

function updateOnlineControls() {
  const p = currentPlayer();
  const isMyTurn = p.color === mp.myColor;

  if (isMyTurn) {
    turnLabel.innerHTML = `À votre tour (<span style="color: var(--${p.color})">Votre pion</span>)`;
    if (!state.rolled) {
      diceBtn.disabled = false;
      setHint('Cliquez sur le dé ou secouez votre téléphone pour lancer !');
    } else {
      diceBtn.disabled = true;
      const movable = getMovableTokens(state.current, state.dice);
      highlightMovable(movable);
      setHint('Choisissez un pion à déplacer');
    }
  } else {
    turnLabel.innerHTML = `Au tour de <strong style="color: var(--${p.color})">${p.name}</strong>`;
    diceBtn.disabled = true;
    clearMovable();
    setHint(`En attente de ${p.name}...`);
  }
}

/* ==================== CAPTEUR DE SECOUEMENT (SHAKE TO ROLL) ==================== */
let lastX = null, lastY = null, lastZ = null;
const shakeThreshold = 15; // Seuil d'accélération en m/s^2
let lastShakeTime = 0;

function handleDeviceMotion(event) {
  if (state.busy || state.rolled || state.gameOver) return;

  const p = currentPlayer();
  if (p.isAI) return;
  if (mp.active && p.color !== mp.myColor) return;

  const acc = event.acceleration || event.accelerationIncludingGravity;
  if (!acc) return;

  const x = acc.x;
  const y = acc.y;
  const z = acc.z;

  if (lastX !== null) {
    const deltaX = Math.abs(x - lastX);
    const deltaY = Math.abs(y - lastY);
    const deltaZ = Math.abs(z - lastZ);

    if ((deltaX > shakeThreshold && deltaY > shakeThreshold) ||
        (deltaX > shakeThreshold && deltaZ > shakeThreshold) ||
        (deltaY > shakeThreshold && deltaZ > shakeThreshold)) {
      const now = Date.now();
      if (now - lastShakeTime > 1500) {
        lastShakeTime = now;
        if (navigator.vibrate) {
          navigator.vibrate(200);
        }
        rollDice();
      }
    }
  }

  lastX = x;
  lastY = y;
  lastZ = z;
}

function initShakeDetection() {
  // Désactivé par défaut. L'activation dynamique se fait dans beginTurn()
}

function enableShakeListener() {
  const p = currentPlayer();
  if (!p || p.isAI || state.rolled || state.busy || state.gameOver) return;
  if (mp.active && p.color !== mp.myColor) return;
  window.removeEventListener('devicemotion', handleDeviceMotion, true);
  lastX = null; lastY = null; lastZ = null;
  window.addEventListener('devicemotion', handleDeviceMotion, true);
}

function disableShakeListener() {
  window.removeEventListener('devicemotion', handleDeviceMotion, true);
}

let shakePermissionAsked = false;
function requestShakePermission() {
  if (typeof DeviceMotionEvent === 'undefined') return;
  if (typeof DeviceMotionEvent.requestPermission !== 'function') {
    enableShakeListener();
    return;
  }
  if (shakePermissionAsked) return;
  shakePermissionAsked = true;
  DeviceMotionEvent.requestPermission()
    .then((permissionState) => {
      if (permissionState === 'granted') {
        enableShakeListener();
        log('Capteur de secouement activé avec succès !', true);
      }
    })
    .catch((e) => console.warn('Shake permission denied or failed', e));
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get('join');
  if (joinCode) {
    $('#btn-mode-local').classList.remove('active');
    $('#btn-mode-online').classList.add('active');
    $('#local-setup').style.display = 'none';
    $('#online-setup').style.display = 'block';

    $('#btn-choose-host').classList.remove('active');
    $('#btn-choose-join').classList.add('active');
    $('#online-host-pane').style.display = 'none';
    $('#online-join-pane').style.display = 'flex';
    $('#start-btn').style.display = 'none';

    $('#room-code-input').value = joinCode.trim();
    $('#player-name-input').focus();
    log(`Invitation détectée pour le salon <strong>${joinCode}</strong> !`);
  }
}

/* ==================== INIT ==================== */
initShakeDetection();
renderSetup();
checkUrlParams();
