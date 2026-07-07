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
  players: [],       // { color, name, isAI, tokens, finishedRank, captures, wasCaptured }
  current: 0,
  dice: 0,
  rolled: false,
  sixCount: 0,
  busy: false,
  gameOver: false,
  ranking: [],
  totalMoves: 0,
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
  reconnectTokens: {}, // token -> { peerId, color, issuedAt } (côté hôte uniquement)
  myReconnectToken: null, // token personnel (côté client, persisté en LocalStorage)
};

let setupCount = 4;
let setupTypes = { red: 'human', green: 'ai', yellow: 'ai', blue: 'ai' };

const COLOR_SETS = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: COLORS };

/* ---------- Règles paramétrables ---------- */
const RULES_DEF = [
  { id: 'requireSixToExit',   label: '6 obligatoire pour sortir', desc: 'Forcer un 6 pour faire sortir un pion de la base', default: true },
  { id: 'captureEnabled',     label: 'Captures activées',        desc: 'Envoyer un pion adverse à la base',                default: true },
  { id: 'threeSixPenalty',    label: '3 six = tour perdu',       desc: 'Pénalité classique : trois 6 consécutifs',        default: true },
  { id: 'extraTurnOnCapture', label: 'Gain de tour (capture)',   desc: 'Rejouer après avoir capturé un pion adverse',      default: true },
  { id: 'extraTurnOnFinish',  label: 'Gain de tour (arrivée)',   desc: 'Rejouer après avoir atteint la maison',            default: true },
  { id: 'safeCellsActive',    label: 'Cases sûres',              desc: 'Cases où les pions ne peuvent être capturés',     default: true },
];
const rules = {};
RULES_DEF.forEach(r => { rules[r.id] = r.default; });

function renderRules() {
  const cfg = $('#rules-config');
  if (!cfg) return;
  cfg.innerHTML = '';
  RULES_DEF.forEach(r => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <div>
        <div class="rule-label">${r.label}</div>
        <div class="rule-desc">${r.desc}</div>
      </div>
      <button class="rule-toggle ${rules[r.id] ? 'on' : ''}" data-rule="${r.id}" aria-label="${r.label}" aria-pressed="${rules[r.id]}"></button>`;
    row.querySelector('.rule-toggle').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      rules[r.id] = !rules[r.id];
      btn.classList.toggle('on', rules[r.id]);
      btn.setAttribute('aria-pressed', String(rules[r.id]));
    });
    cfg.appendChild(row);
  });
}

function renderResumeBanner() {
  const banner = document.createElement('div');
  banner.id = 'resume-banner';
  banner.className = 'resume-banner';
  const saved = hasSavedGame();
  const rejoin = loadReconnectToken();
  if (saved) {
    banner.innerHTML = `
      <div class="resume-info">
        <strong>Partie en cours détectée</strong>
        <span>Reprendre là où vous vous êtes arrêté ?</span>
      </div>
      <div class="resume-actions">
        <button id="resume-yes" class="start-btn" style="margin:0;padding:10px 18px;font-size:13px;">Reprendre</button>
        <button id="resume-no" class="btn-secondary" style="margin:0;padding:10px 18px;font-size:13px;">Nouvelle</button>
      </div>`;
    banner.querySelector('#resume-yes').addEventListener('click', () => {
      if (restoreFromSave()) {
        setupScreen.classList.remove('active');
        gameScreen.classList.add('active');
        logEl.innerHTML = '';
        buildBoard();
        createTokens();
        renderPlayers();
        renderRules();
        log('Partie restaurée depuis la sauvegarde locale.', true);
        beginTurn();
      }
    });
    banner.querySelector('#resume-no').addEventListener('click', () => {
      clearSavedState();
      banner.remove();
    });
  } else if (rejoin && rejoin.roomCode) {
    banner.innerHTML = `
      <div class="resume-info">
        <strong>Connexion précédente</strong>
        <span>Salle <code>${rejoin.roomCode}</code> — rejoindre automatiquement ?</span>
      </div>
      <div class="resume-actions">
        <button id="rejoin-yes" class="start-btn" style="margin:0;padding:10px 18px;font-size:13px;">Rejoindre</button>
        <button id="rejoin-no" class="btn-secondary" style="margin:0;padding:10px 18px;font-size:13px;">Ignorer</button>
      </div>`;
    banner.querySelector('#rejoin-yes').addEventListener('click', () => {
      $('#btn-mode-online').click();
      $('#btn-choose-join').click();
      $('#room-code-input').value = rejoin.roomCode;
      $('#player-name-input').value = 'Joueur';
      $('#player-name-input').focus();
      banner.remove();
    });
    banner.querySelector('#rejoin-no').addEventListener('click', () => {
      clearReconnectToken();
      banner.remove();
    });
  } else {
    return;
  }
  const card = document.querySelector('.setup-card');
  if (card) card.parentNode.insertBefore(banner, card);
}

/* ---------- Persistance (LocalStorage) ---------- */
const STORAGE_KEY = 'ludo-royal-state-v1';
let autoSaveEnabled = true;
let saveTimer = null;

function serializeState() {
  return JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    state: {
      players: state.players.map(p => ({ color: p.color, name: p.name, isAI: p.isAI, tokens: [...p.tokens], finishedRank: p.finishedRank })),
      current: state.current,
      dice: state.dice,
      rolled: state.rolled,
      sixCount: state.sixCount,
      busy: state.busy,
      gameOver: state.gameOver,
      ranking: state.ranking.map(p => p.color),
    },
    rules: { ...rules },
    setupCount,
    setupTypes: { ...setupTypes },
  });
}

function scheduleSave() {
  if (!autoSaveEnabled) return;
  if (state.gameOver || state.players.length === 0) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, serializeState()); } catch (e) { /* quota */ }
  }, 400);
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch (e) { return null; }
}

function clearSavedState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

function hasSavedGame() {
  const s = loadSavedState();
  return !!(s && s.state && s.state.players && s.state.players.length > 0 && !s.state.gameOver);
}

function restoreFromSave() {
  const saved = loadSavedState();
  if (!saved) return false;
  setupCount = saved.setupCount || 4;
  if (saved.setupTypes) setupTypes = { ...saved.setupTypes };
  if (saved.rules) Object.assign(rules, saved.rules);
  const s = saved.state;
  state.players = s.players.map(p => ({ color: p.color, name: p.name, isAI: p.isAI, tokens: [...p.tokens], finishedRank: p.finishedRank }));
  state.current = s.current;
  state.dice = s.dice;
  state.rolled = s.rolled;
  state.sixCount = s.sixCount;
  state.busy = s.busy;
  state.gameOver = s.gameOver;
  state.ranking = s.ranking.map(c => state.players.find(p => p.color === c));
  return true;
}

function pIdxFromColor(color) {
  return state.players.findIndex(p => p.color === color);
}

/* ---------- i18n (FR/EN) ---------- */
const I18N = {
  fr: {
    title: 'Ludo Royal', subtitle: 'Le jeu de plateau classique, réinventé avec élégance',
    setupMode: 'Mode de jeu', local: 'Local', online: 'En Ligne',
    playerCount: 'Nombre de joueurs', players: 'Joueurs',
    rules: 'Règles de la partie', gameMode: 'Mode de jeu',
    express: 'Mode Express ⚡', expressDesc: '2 pions par joueur au lieu de 4 (parties rapides)',
    aiDifficulty: 'Difficulté de l\'IA', easy: 'Facile', normal: 'Normal', hard: 'Difficile',
    achievements: 'Succès', resetAchievements: 'Réinitialiser les succès',
    createRoom: 'Créer un salon', joinRoom: 'Rejoindre un salon',
    roomCode: 'Code du salon', connectedPlayers: 'Joueurs connectés (Lobby)',
    enterCode: 'Entrer le code du salon', yourName: 'Votre Pseudo',
    join: 'Rejoindre le salon', spectate: 'Mode Spectateur 👁️',
    start: 'Commencer la partie', theme: 'Thème', skin: 'Skin des pions',
    chat: 'Chat', replay: 'Replay', music: 'Musique',
    victory: 'Victoire !', gameOver: 'Partie terminée !',
    rollDice: 'Lancez le dé pour commencer', noMove: 'Aucun mouvement possible avec un',
    skipTurn: 'Trois 6 de suite : tour perdu !',
    resume: 'Partie en cours détectée', resumeDesc: 'Reprendre là où vous vous êtes arrêté ?',
    resumeYes: 'Reprendre', resumeNo: 'Nouvelle',
    rejoin: 'Connexion précédente', rejoinDesc: 'Salle', rejoinYes: 'Rejoindre', rejoinNo: 'Ignorer',
  },
  en: {
    title: 'Ludo Royal', subtitle: 'The classic board game, reimagined with elegance',
    setupMode: 'Game mode', local: 'Local', online: 'Online',
    playerCount: 'Player count', players: 'Players',
    rules: 'Game rules', gameMode: 'Game mode',
    express: 'Express mode ⚡', expressDesc: '2 pawns per player instead of 4 (fast games)',
    aiDifficulty: 'AI difficulty', easy: 'Easy', normal: 'Normal', hard: 'Hard',
    achievements: 'Achievements', resetAchievements: 'Reset achievements',
    createRoom: 'Create a room', joinRoom: 'Join a room',
    roomCode: 'Room code', connectedPlayers: 'Connected players (Lobby)',
    enterCode: 'Enter room code', yourName: 'Your nickname',
    join: 'Join the room', spectate: 'Spectator mode 👁️',
    start: 'Start the game', theme: 'Theme', skin: 'Token skin',
    chat: 'Chat', replay: 'Replay', music: 'Music',
    victory: 'Victory !', gameOver: 'Game over !',
    rollDice: 'Roll the dice to begin', noMove: 'No move possible with a',
    skipTurn: 'Three 6 in a row : turn lost !',
    resume: 'Game in progress detected', resumeDesc: 'Resume where you left off ?',
    resumeYes: 'Resume', resumeNo: 'New',
    rejoin: 'Previous connection', rejoinDesc: 'Room', rejoinYes: 'Rejoin', rejoinNo: 'Ignore',
  }
};
let currentLang = localStorage.getItem('ludo-royal-lang') || 'fr';
function t(key) { return (I18N[currentLang] && I18N[currentLang][key]) || I18N.fr[key] || key; }
function applyI18n() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
}
function setLang(lang) {
  currentLang = lang;
  try { localStorage.setItem('ludo-royal-lang', lang); } catch (e) {}
  applyI18n();
}

/* ---------- Thèmes ---------- */
const THEMES = { dark: 'Dark', pastel: 'Pastel', neon: 'Neon', forest: 'Forest' };
let currentTheme = localStorage.getItem('ludo-royal-theme') || 'dark';
function setTheme(theme) {
  currentTheme = theme;
  try { localStorage.setItem('ludo-royal-theme', theme); } catch (e) {}
  document.body.classList.remove('theme-dark', 'theme-pastel', 'theme-neon', 'theme-forest');
  if (theme !== 'dark') document.body.classList.add(`theme-${theme}`);
}

/* ---------- Skins de pions ---------- */
const TOKEN_SKINS = {
  classic: { emojis: null },
  emojis:  { emojis: { red: '🔴', green: '🟢', yellow: '🟡', blue: '🔵' } },
  fruits:  { emojis: { red: '🍎', green: '🍏', yellow: '🍌', blue: '🫐' } },
  animals: { emojis: { red: '🦁', green: '🐸', yellow: '🐝', blue: '🐳' } },
};
let currentSkin = localStorage.getItem('ludo-royal-skin') || 'classic';

/* ---------- Musique de fond (WebAudio, sans fichiers) ---------- */
let musicOn = false;
let musicNodes = null;
function startMusic() {
  if (musicOn) return;
  musicOn = true;
  try {
    const ctx = audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());
    // Drone indien : accords de quinte + tierce mineure, oscillateurs lents
    const freqs = [110, 165, 220, 277]; // La2, Mi3, La3, Do#4
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
    masterGain.connect(ctx.destination);
    const oscs = freqs.map(f => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      // LFO léger pour mouvement
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 0.15 + Math.random() * 0.1;
      lfoG.gain.value = 0.3;
      lfo.connect(lfoG).connect(o.frequency);
      lfo.start();
      g.gain.value = 0.4 + Math.random() * 0.2;
      o.connect(g).connect(masterGain);
      o.start();
      return { o, g, lfo };
    });
    musicNodes = { ctx, oscs, masterGain };
  } catch (e) { console.warn('Music init failed', e); }
}
function stopMusic() {
  musicOn = false;
  if (!musicNodes) return;
  const { ctx, masterGain } = musicNodes;
  try {
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    setTimeout(() => {
      musicNodes.oscs.forEach(({ o, lfo }) => { try { o.stop(); lfo.stop(); } catch (e) {} });
      musicNodes = null;
    }, 600);
  } catch (e) {}
}

/* ---------- Chat intégré ---------- */
const chat = {
  messages: [],
  listeners: new Set(),
};
function chatGetDisplayName() {
  // Nom à afficher devant les messages. Priorité au nom choisi par l'utilisateur.
  if (mp.role === 'host') return mp.players.find(p => p.peerId === mp.peer?.id)?.name || 'Hôte';
  if (mp.role === 'client') {
    const self = mp.players.find(p => p.color === mp.myColor);
    return self?.name || 'Joueur';
  }
  return 'Spectateur';
}

function chatSend(text) {
  if (!mp.active) return;
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return;
  const isEmojiOnly = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(trimmed);
  const msg = {
    from: chatGetDisplayName(),
    color: mp.myColor || (mp.role === 'host' ? 'red' : 'green'),
    text: trimmed,
    emojiOnly: isEmojiOnly,
    at: Date.now()
  };
  chat.messages.push(msg);
  if (chat.messages.length > 60) chat.messages.shift();
  renderChatMessages();
  if (mp.role === 'host') {
    Object.values(mp.conn).forEach(conn => conn.open && conn.send({ type: 'CHAT', msg }));
  } else if (mp.role === 'client' && mp.conn[mp.roomCode]?.open) {
    mp.conn[mp.roomCode].send({ type: 'CHAT', msg });
  }
}
function renderChatMessages() {
  const el = $('#chat-messages');
  if (!el) return;
  const myKey = mp.role === 'host'
    ? mp.peer?.id
    : (mp.myColor || mp.roomCode);
  el.innerHTML = chat.messages.slice(-30).map(m => {
    const isMine = (mp.role === 'host' && m.color === 'red') ||
                   (mp.role === 'client' && m.color === mp.myColor);
    const cls = isMine ? 'chat-msg me' : 'chat-msg';
    const colorDot = `<span class="chat-dot" style="background: var(--${m.color || 'gold'}); width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle;"></span>`;
    if (m.emojiOnly) {
      return `<div class="${cls}">${colorDot}<span style="font-size:20px">${escapeHtml(m.text)}</span></div>`;
    }
    return `<div class="${cls}">${colorDot}<strong>${escapeHtml(m.from)}</strong>${escapeHtml(m.text)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}
function showChat(show) {
  const panel = $('#chat-panel');
  if (panel) panel.style.display = show ? 'flex' : 'none';
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- Mode Replay (enregistrement des SYNC_STATE) ---------- */
const replay = {
  enabled: false,
  history: [],
  index: 0,
  playing: false,
  timer: null,
};
function recordState(snapshot) {
  if (!replay.enabled) return;
  replay.history.push(snapshot);
  if (replay.history.length > 200) replay.history.shift();
}
function renderReplayFromIndex(i) {
  const snap = replay.history[i];
  if (!snap) return;
  state.players = snap.players.map(p => ({ color: p.color, name: p.name, isAI: p.isAI, tokens: [...p.tokens], finishedRank: p.finishedRank }));
  state.current = snap.current;
  state.dice = snap.dice;
  renderTokens(); renderPlayers();
  $('#replay-info').textContent = `${i + 1}/${replay.history.length}`;
}

/* ---------- Telemetry anonymisée (compteurs locaux uniquement) ---------- */
const TELEMETRY_KEY = 'ludo-royal-telemetry-v1';
const telemetry = { gamesPlayed: 0, gamesWon: 0, totalCaptures: 0, totalRolls: 0, colorWins: { red: 0, green: 0, yellow: 0, blue: 0 } };
function loadTelemetry() {
  try { const raw = localStorage.getItem(TELEMETRY_KEY); if (raw) Object.assign(telemetry, JSON.parse(raw)); } catch (e) {}
}
function saveTelemetry() {
  try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(telemetry)); } catch (e) {}
}
function recordRoll() { telemetry.totalRolls++; saveTelemetry(); }
function recordCapture() { telemetry.totalCaptures++; saveTelemetry(); }
function recordGameEnd(winnerColor) {
  telemetry.gamesPlayed++;
  if (winnerColor) { telemetry.gamesWon++; telemetry.colorWins[winnerColor] = (telemetry.colorWins[winnerColor] || 0) + 1; }
  saveTelemetry();
}

/* ---------- Mode Express + Niveaux d'IA + Achievements + Spectateur ---------- */
const GAME_MODES = { classic: 'classic', express: 'express' };
let gameMode = GAME_MODES.classic; // 'classic' (4 pions) | 'express' (2 pions)

const AI_LEVELS = { easy: 'easy', normal: 'normal', hard: 'hard' };
let aiLevel = AI_LEVELS.normal;

const ACHIEVEMENTS_KEY = 'ludo-royal-achievements-v1';
const ACHIEVEMENTS = [
  { id: 'first_move',     label: 'Premier pas',           desc: 'Déplacer votre premier pion',           icon: '👣' },
  { id: 'first_capture',  label: 'Chasseur',              desc: 'Capturer un pion adverse',              icon: '🎯' },
  { id: 'three_six',      label: 'Pas de chance !',       desc: 'Faire trois 6 consécutifs',            icon: '💀' },
  { id: 'finish_one',     label: 'Premiere victoire',     desc: 'Faire arriver un pion à la maison',     icon: '🏁' },
  { id: 'win_game',       label: 'Champion !',            desc: 'Terminer une partie en premiere place', icon: '🏆' },
  { id: 'perfect_run',    label: 'Sans faute',            desc: 'Gagner sans avoir été capturé',         icon: '🛡️' },
  { id: 'express_win',    label: 'Speedrunner',           desc: 'Gagner en mode Express',                icon: '⚡' },
  { id: 'all_captures',   label: 'Annihilateur',          desc: 'Capturer les 4 pions d\'un adversaire', icon: '💥' },
];
const unlockedAchievements = new Set();

function loadAchievements() {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(id => unlockedAchievements.add(id));
  } catch (e) {}
}
function saveAchievements() {
  try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...unlockedAchievements])); } catch (e) {}
}
function unlockAchievement(id) {
  if (unlockedAchievements.has(id)) return;
  unlockedAchievements.add(id);
  saveAchievements();
  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (def) showAchievementToast(def);
}
function resetAchievements() {
  unlockedAchievements.clear();
  saveAchievements();
}
function showAchievementToast(def) {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `<span class="ach-icon">${def.icon}</span><div><strong>Succès débloqué</strong><div>${def.label}</div></div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 50);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3500);
}

function aiLevelLabel(l) { return l === 'easy' ? 'Facile' : l === 'hard' ? 'Difficile' : 'Normal'; }

function renderGameModes() {
  const cfg = $('#game-mode-config');
  if (!cfg) return;
  // Purger les anciens enfants dynamiques pour éviter les doublons au re-render
  cfg.querySelectorAll('.dynamic-render').forEach(el => el.remove());

  const aiCfg = document.createElement('div');
  aiCfg.className = 'dynamic-render';
  aiCfg.style.marginTop = '12px';
  aiCfg.innerHTML = `
    <div class="rule-label" style="margin-bottom:8px;">Difficulté de l'IA</div>
    <div class="ai-buttons">
      <button class="count-btn ai-btn ${aiLevel === 'easy' ? 'active' : ''}" data-ai="easy">Facile</button>
      <button class="count-btn ai-btn ${aiLevel === 'normal' ? 'active' : ''}" data-ai="normal">Normal</button>
      <button class="count-btn ai-btn ${aiLevel === 'hard' ? 'active' : ''}" data-ai="hard">Difficile</button>
    </div>`;
  cfg.appendChild(aiCfg);
  aiCfg.querySelectorAll('.ai-btn').forEach(b => {
    b.addEventListener('click', () => {
      aiLevel = b.dataset.ai;
      aiCfg.querySelectorAll('.ai-btn').forEach(x => x.classList.toggle('active', x === b));
    });
  });

  // Achievements preview + reset
  const achDiv = document.createElement('div');
  achDiv.className = 'dynamic-render';
  achDiv.style.marginTop = '14px';
  achDiv.innerHTML = `
    <div class="rule-label" style="margin-bottom:8px;">Succès <span class="ach-count">(${unlockedAchievements.size}/${ACHIEVEMENTS.length})</span></div>
    <div class="ach-grid">
      ${ACHIEVEMENTS.map(a => `<div class="ach-chip ${unlockedAchievements.has(a.id) ? 'unlocked' : ''}" title="${a.desc}">${a.icon}${unlockedAchievements.has(a.id) ? '' : '?'}</div>`).join('')}
    </div>
    <button id="reset-achievements" class="btn-secondary" style="margin-top:8px;padding:8px;font-size:12px;width:100%;">Réinitialiser les succès</button>`;
  cfg.appendChild(achDiv);
  achDiv.querySelector('#reset-achievements').addEventListener('click', () => {
    if (confirm('Réinitialiser tous les succès débloqués ?')) {
      resetAchievements();
      renderGameModes();
    }
  });
}

function renderExpressToggle() {
  const btn = $('#toggle-express');
  if (!btn) return;
  btn.addEventListener('click', () => {
    gameMode = (gameMode === GAME_MODES.express) ? GAME_MODES.classic : GAME_MODES.express;
    btn.classList.toggle('on', gameMode === GAME_MODES.express);
    btn.setAttribute('aria-pressed', String(gameMode === GAME_MODES.express));
  });
}

/* ---------- Mode Spectateur ---------- */
const spectator = {
  active: false,
  hostConn: null,
};

function joinAsSpectator(roomCode) {
  mp.active = true;
  mp.role = 'spectator';
  mp.roomCode = roomCode.toUpperCase().trim();
  if (mp.peer) mp.peer.destroy();
  const id = 'LUDO-SPECT-' + Math.floor(Math.random() * 100000);
  mp.peer = new Peer(id, peerOptions);
  mp.peer.on('open', () => {
    const conn = mp.peer.connect(mp.roomCode);
    mp.conn[mp.roomCode] = conn;
    conn.on('open', () => conn.send({ type: 'SPECTATE' }));
    conn.on('data', (data) => {
      if (data.type === 'START_GAME') {
        setupScreen.classList.remove('active');
        gameScreen.classList.add('active');
        logEl.innerHTML = '';
        buildBoard(); createTokens(); renderPlayers();
        log('Mode spectateur actif 👁️', true);
        spectator.active = true;
      } else if (data.type === 'SYNC_STATE') {
        state.current = data.state.current;
        state.dice = data.state.dice;
        state.players = data.state.players.map(p => ({ color: p.color, name: p.name, isAI: p.isAI, tokens: [...p.tokens], finishedRank: p.finishedRank }));
        state.ranking = data.state.ranking.map(c => state.players.find(p => p.color === c));
        state.gameOver = data.state.gameOver;
        diceFace.dataset.v = String(state.dice || 6);
        renderTokens(); renderPlayers();
        if (state.gameOver) showVictory(state.ranking[0]);
      } else if (data.type === 'ANIMATE_MOVE') {
        clientAnimateMove(data.pIdx, data.tIdx, data.dice);
      } else if (data.type === 'ERROR') {
        alert(data.message);
      }
    });
    conn.on('close', () => { alert('Spectateur déconnecté.'); location.reload(); });
  });
  mp.peer.on('error', (err) => { alert('Erreur spectateur : ' + err.type); location.reload(); });
}

function renderSpectatorToggle() {
  const btn = $('#toggle-spectator');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.classList.toggle('on', !btn.classList.contains('on'));
    btn.setAttribute('aria-pressed', String(!btn.classList.contains('on')));
  });
}

function generateReconnectToken() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function saveReconnectToken(token, roomCode) {
  try { localStorage.setItem(RECONNECT_KEY, JSON.stringify({ token, roomCode, at: Date.now() })); } catch (e) {}
}

function loadReconnectToken() {
  try { const raw = localStorage.getItem(RECONNECT_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

function clearReconnectToken() {
  try { localStorage.removeItem(RECONNECT_KEY); } catch (e) {}
}

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
$('#new-game-btn').addEventListener('click', () => {
  resetMultiplayer();
  victoryModal.classList.remove('show');
  gameScreen.classList.remove('active');
  setupScreen.classList.add('active');
});
$('#restart-btn').addEventListener('click', () => {
  resetMultiplayer();
  victoryModal.classList.remove('show');
  gameScreen.classList.remove('active');
  setupScreen.classList.add('active');
});

/* Reset complet de l'état multi-joueur (Peer, chat, reconnexion) */
function resetMultiplayer() {
  if (mp.peer) {
    try { mp.peer.destroy(); } catch (e) {}
    mp.peer = null;
  }
  mp.active = false;
  mp.role = 'local';
  mp.conn = {};
  mp.roomCode = null;
  mp.myColor = 'red';
  mp.myReconnectToken = null;
  mp.players = [];
  // Vider le chat
  chat.messages = [];
  const chatEl = $('#chat-messages');
  if (chatEl) chatEl.innerHTML = '';
  showChat(false);
  clientRetryCount = 0;
  hostRetryCount = 0;
  brokerIndex = 0;
  clearBrokerTimeout();
  clearNetworkError();
}
$('#continue-btn').addEventListener('click', () => {
  victoryModal.classList.remove('show');
  if (!state.gameOver) nextTurn(false);
});
$('#sound-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  $('#sound-on-icon').style.display = soundOn ? '' : 'none';
  $('#sound-off-icon').style.display = soundOn ? 'none' : '';
});
$('#music-btn').addEventListener('click', () => {
  if (musicOn) { stopMusic(); } else { startMusic(); }
  $('#music-on-icon').style.display = musicOn ? '' : 'none';
  $('#music-off-icon').style.display = musicOn ? 'none' : '';
});
$('#lang-btn').addEventListener('click', () => {
  setLang(currentLang === 'fr' ? 'en' : 'fr');
  $('#lang-btn').textContent = currentLang.toUpperCase();
  applyI18n();
});
$('#chat-send').addEventListener('click', () => {
  const inp = $('#chat-input');
  if (!inp.value.trim()) return;
  chatSend(inp.value);
  inp.value = '';
  // Fermer le panneau d'émojis après envoi
  const bar = $('#chat-emoji-bar');
  if (bar) bar.classList.remove('open');
});
$('#chat-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#chat-send').click(); } });
$('#chat-emoji-toggle').addEventListener('click', () => {
  const bar = $('#chat-emoji-bar');
  if (bar) bar.classList.toggle('open');
});
document.querySelectorAll('.chat-emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = $('#chat-input');
    const emoji = btn.dataset.emoji;
    inp.value += emoji;
    inp.focus();
  });
});
$('#replay-prev').addEventListener('click', () => {
  if (replay.index > 0) { replay.index--; renderReplayFromIndex(replay.index); }
});
$('#replay-next').addEventListener('click', () => {
  if (replay.index < replay.history.length - 1) { replay.index++; renderReplayFromIndex(replay.index); }
});
$('#replay-play').addEventListener('click', () => {
  if (replay.playing) {
    replay.playing = false;
    clearInterval(replay.timer);
  } else {
    replay.playing = true;
    replay.timer = setInterval(() => {
      if (replay.index < replay.history.length - 1) { replay.index++; renderReplayFromIndex(replay.index); }
      else { replay.playing = false; clearInterval(replay.timer); }
    }, 800);
  }
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
  applyTokenSkin();
}

// Batched render via requestAnimationFrame pour éviter les reflows multiples
const renderTokens = (() => {
  let pending = false;
  function flush() {
    pending = false;
    doRender();
  }
  function doRender() {
    if (document.querySelectorAll('.token').length === 0 && state.players.length > 0) {
      createTokens();
      return;
    }
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
        el.style.top = `${((r + 0.11 + or) / 15) * 100}%`;
        el.style.left = `${((c + 0.11 + oc) / 15) * 100}%`;
        el.classList.toggle('finished', pos === FINISH_POS);
      });
    });
  }
  return function renderTokens() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(flush);
  };
})();

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
    const displayLabel = shortPlayerLabel(p, i);
    card.innerHTML = `
      <span class="dot ${p.color}"></span>
      <div class="info">
        <div class="name">${escapeHtml(displayLabel)} <span class="tag">${p.isAI ? 'IA' : 'Humain'}</span> ${medal}</div>
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

/* Helper : libellé court d'un joueur selon le mode de jeu */
function shortPlayerLabel(player, index) {
  if (setupCount === 2 && player && !player.isAI) {
    const humanIdx = state.players.slice(0, index + 1).filter(p => !p.isAI).length;
    return `J${humanIdx}`;
  }
  return (player && player.name) || `Joueur ${index + 1}`;
}

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
      tokens: gameMode === GAME_MODES.express ? [-1, -1] : [-1, -1, -1, -1],
      finishedRank: 0,
      captures: 0,
      wasCaptured: false,
    }));
  } else {
    // Mode local : utilise setupTypes
    state.players = COLOR_SETS[setupCount].map((color, idx) => ({
      color,
      name: COLOR_NAMES[color],
      isAI: setupTypes[color] === 'ai',
      tokens: gameMode === GAME_MODES.express ? [-1, -1] : [-1, -1, -1, -1],
      finishedRank: 0,
      captures: 0,
      wasCaptured: false,
    }));
    // En mode 2 joueurs, renommer les joueurs humains en J1/J2 (sans toucher aux IA)
    if (setupCount === 2) {
      let humanIdx = 0;
      state.players.forEach((p) => {
        if (!p.isAI) {
          humanIdx++;
          p.name = `J${humanIdx}`;
        }
      });
    }
  }
  state.current = 0;
  state.dice = 0;
  state.rolled = false;
  state.sixCount = 0;
  state.busy = false;
  state.gameOver = false;
  state.ranking = [];
  state.totalMoves = 0;
  chat.messages = [];
  const chatEl = $('#chat-messages');
  if (chatEl) chatEl.innerHTML = '';

  setupScreen.classList.remove('active');
  gameScreen.classList.add('active');
  logEl.innerHTML = '';

  // Afficher le chat uniquement en multi
  showChat(mp.active && mp.role !== 'spectator');

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
  scheduleSave();
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
  recordRoll();

  const p = currentPlayer();
  log(`<strong>${p.name}</strong> lance le dé : <strong>${value}</strong>`);

  if (mp.active && mp.role === 'host') {
    broadcastState();
  }

  // règle des trois 6 consécutifs (si activée)
  if (value === 6 && rules.threeSixPenalty) {
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
      if (!rules.requireSixToExit) {
        // Variante : tout dé permet de sortir
        res.push(tIdx);
      } else if (dice === 6) {
        res.push(tIdx);
      }
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
    p.tokens[tIdx] = 0;
    sfx.out();
    el.classList.add('hop');
    renderTokens();
    log(`<strong>${p.name}</strong> sort un pion de sa base`);
    unlockAchievement('first_move');
    state.totalMoves++;
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
    state.totalMoves++;
    unlockAchievement('first_move');
  }

  const newPos = p.tokens[tIdx];

  // Capture ? (si règle activée)
  if (rules.captureEnabled && newPos >= 0 && newPos <= 50) {
    const cell = absCell(p.color, newPos);
    const isSafe = rules.safeCellsActive && SAFE_CELLS.has(cell);
    if (!isSafe) {
      let oppCapturedCount = 0;
      for (let oi = 0; oi < state.players.length; oi++) {
        if (oi === pIdx) continue;
        const opp = state.players[oi];
        opp.tokens.forEach((opos, otIdx) => {
          if (opos >= 0 && opos <= 50 && absCell(opp.color, opos) === cell) {
            opp.tokens[otIdx] = -1;
            opp.wasCaptured = true;
            oppCapturedCount++;
            const oel = document.getElementById(tokenId(oi, otIdx));
            if (oel) {
              oel.classList.add('captured-anim');
              setTimeout(() => oel.classList.remove('captured-anim'), 520);
            }
            log(`<strong>${p.name}</strong> capture un pion de <strong>${opp.name}</strong> !`, true);
            sfx.capture();
            if (rules.extraTurnOnCapture) extraTurn = true;
          }
        });
      }
      if (oppCapturedCount > 0) {
        p.captures = (p.captures || 0) + oppCapturedCount;
        unlockAchievement('first_capture');
        if (p.captures === 4) unlockAchievement('all_captures');
      }
      renderTokens();
    }
  }

  // Pion arrivé ?
  if (newPos === FINISH_POS) {
    sfx.finish();
    log(`<strong>${p.name}</strong> amène un pion à la maison !`, true);
    if (rules.extraTurnOnFinish) extraTurn = true;
    unlockAchievement('finish_one');
    if (gameMode === GAME_MODES.express) unlockAchievement('express_win');

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
      if (p.finishedRank === 1) unlockAchievement('win_game');
      if (!p.wasCaptured && !p.isAI) unlockAchievement('perfect_run');
      return;
    }
  }

  renderPlayers();
  if (mp.active && mp.role === 'host') broadcastState();
  state.busy = false;
  scheduleSave();
  await sleep(250);
  nextTurn(extraTurn);
}

/* ==================== IA ==================== */
function aiChooseMoveEasy(pIdx, dice, movable) {
  const p = state.players[pIdx];
  let best = movable[0];
  let bestScore = -Infinity;
  movable.forEach((tIdx) => {
    const pos = p.tokens[tIdx];
    const newPos = pos === -1 ? 0 : pos + dice;
    let score = 0;
    if (newPos === FINISH_POS) score += 60;
    else if (newPos >= 51) score += 25;
    if (pos === -1) score += 15;
    score += (pos === -1 ? 0 : pos) * 0.2;
    score += Math.random() * 12; // beaucoup d'aléa
    if (score > bestScore) { bestScore = score; best = tIdx; }
  });
  return best;
}

function aiChooseMoveNormal(pIdx, dice, movable) {
  const p = state.players[pIdx];
  let best = movable[0];
  let bestScore = -Infinity;
  movable.forEach((tIdx) => {
    const pos = p.tokens[tIdx];
    const newPos = pos === -1 ? 0 : pos + dice;
    let score = 0;
    if (newPos === FINISH_POS) score += 120;
    else if (newPos >= 51) score += 55;
    if (pos === -1) score += 45;
    if (newPos >= 0 && newPos <= 50) {
      const cell = absCell(p.color, newPos);
      if (!SAFE_CELLS.has(cell)) {
        for (let oi = 0; oi < state.players.length; oi++) {
          if (oi === pIdx) continue;
          const opp = state.players[oi];
          if (opp.tokens.some((op) => op >= 0 && op <= 50 && absCell(opp.color, op) === cell)) score += 90;
        }
      } else score += 25;
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
    score += (pos === -1 ? 0 : pos) * 0.4;
    score += Math.random() * 4;
    if (score > bestScore) { bestScore = score; best = tIdx; }
  });
  return best;
}

function aiChooseMoveHard(pIdx, dice, movable) {
  // Heuristique normale + simulation 1 coup d'avance pour évaluer le danger réel
  const p = state.players[pIdx];
  let best = movable[0];
  let bestScore = -Infinity;
  movable.forEach((tIdx) => {
    const pos = p.tokens[tIdx];
    const newPos = pos === -1 ? 0 : pos + dice;
    let score = 0;
    if (newPos === FINISH_POS) score += 150;
    else if (newPos >= 51) score += 70;
    if (pos === -1) score += 60;
    if (newPos >= 0 && newPos <= 50) {
      const cell = absCell(p.color, newPos);
      const isSafe = rules.safeCellsActive && SAFE_CELLS.has(cell);
      // Capture imminente (cases adverses à portée 1-6)
      let oppCapturesUs = 0;
      let weCaptureOpp = 0;
      for (let oi = 0; oi < state.players.length; oi++) {
        if (oi === pIdx) continue;
        const opp = state.players[oi];
        opp.tokens.forEach((op) => {
          if (op < 0 || op > 50) return;
          const oc = absCell(opp.color, op);
          const distFromOpp = (cell - oc + 52) % 52;
          const distToOpp = (oc - cell + 52) % 52;
          if (distFromOpp >= 1 && distFromOpp <= 6 && !isSafe) oppCapturesUs++;
          if (distToOpp === 0 && !isSafe) weCaptureOpp++;
        });
      }
      score += weCaptureOpp * 110;
      score -= oppCapturesUs * 35;
      if (isSafe) score += 40;
    }
    // Simuler la position des autres pions si on bouge celui-ci
    const simTokens = p.tokens.map((t, i) => i === tIdx ? newPos : t);
    const tokensOnBoard = simTokens.filter(t => t >= 0 && t <= 50).length;
    score += tokensOnBoard * 2;
    // Léger aléa pour la variété
    score += Math.random() * 2;
    if (score > bestScore) { bestScore = score; best = tIdx; }
  });
  return best;
}

function aiChooseMove(pIdx, dice, movable) {
  if (aiLevel === AI_LEVELS.easy) return aiChooseMoveEasy(pIdx, dice, movable);
  if (aiLevel === AI_LEVELS.hard) return aiChooseMoveHard(pIdx, dice, movable);
  return aiChooseMoveNormal(pIdx, dice, movable);
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

/* ==================== PEERJS MULTI-BROKER FALLBACK ==================== */
// Liste de brokers PeerJS testés par ordre de priorité
const PEER_BROKERS = [
  { host: '0.peerjs.com', port: 443, secure: true, name: 'PeerJS Cloud' },
  { host: 'peerjs.com',   port: 443, secure: true, name: 'PeerJS.com' },
];

let brokerIndex = 0;
let brokerTimeout = null;
let hostRetryCount = 0;
const MAX_HOST_RETRIES = 3;
const BROKER_TIMEOUT_MS = 8000;

function clearBrokerTimeout() {
  if (brokerTimeout) { clearTimeout(brokerTimeout); brokerTimeout = null; }
}

function showNetworkError(userMsg, technicalMsg) {
  const lobby = $('#online-host-pane');
  if (!lobby) return;
  let banner = document.getElementById('network-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'network-error-banner';
    banner.style.cssText = 'background:rgba(229,72,77,0.15);border:1px solid var(--red);border-radius:12px;padding:14px;margin-bottom:12px;color:#ff8a8d;font-size:13px;';
    lobby.insertBefore(banner, lobby.firstChild);
  }
  banner.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;">⚠️ ${userMsg}</div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">${technicalMsg}</div>
    <button id="retry-broker" class="start-btn" style="margin:0;padding:8px 14px;font-size:12px;width:auto;">Réessayer</button>
    <button id="use-manual" class="btn-secondary" style="margin:0 0 0 6px;padding:8px 14px;font-size:12px;width:auto;">Mode Manuel (sans serveur)</button>
  `;
  $('#retry-broker').onclick = () => { brokerIndex = 0; hostRetryCount = 0; initHost(); };
  $('#use-manual').onclick = () => startManualMode('host');
}

function clearNetworkError() {
  const banner = document.getElementById('network-error-banner');
  if (banner) banner.remove();
}

// --- HÔTE (HOST) ---
function initHost() {
  mp.active = true;
  mp.role = 'host';
  mp.myColor = 'red';
  mp.roomCode = generateRoomCode();
  $('#room-code-display').textContent = mp.roomCode;

  if (mp.peer) { try { mp.peer.destroy(); } catch (e) {} mp.peer = null; }

  if (hostRetryCount >= MAX_HOST_RETRIES * PEER_BROKERS.length) {
    showNetworkError(
      'Aucun serveur P2P disponible',
      'Tous les brokers PeerJS sont injoignables. Utilisez le Mode Manuel (sans serveur) pour jouer en copiant un code.'
    );
    return;
  }

  const broker = PEER_BROKERS[brokerIndex % PEER_BROKERS.length];
  log(`Connexion au broker ${broker.name}…`);

  mp.peer = new Peer(mp.roomCode, {
    host: broker.host,
    port: broker.port,
    secure: broker.secure,
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    },
  });

  clearBrokerTimeout();
  brokerTimeout = setTimeout(() => {
    if (mp.peer && !mp.peer.open) {
      console.warn(`Broker ${broker.name} timeout`);
      try { mp.peer.destroy(); } catch (e) {}
      brokerIndex++;
      hostRetryCount++;
      initHost();
    }
  }, BROKER_TIMEOUT_MS);

  mp.peer.on('open', () => {
    clearBrokerTimeout();
    clearNetworkError();
    log(`Salon créé via ${broker.name}. Code : <strong>${mp.roomCode}</strong>`, true);
    // L'hôte est toujours P1 (Rouge). Libellé J1 si 2 joueurs, sinon "Hôte".
    const hostName = setupCount === 2 ? 'J1' : 'Hôte (Rouge)';
    mp.players = [{
      peerId: mp.peer.id,
      name: hostName,
      color: 'red',
      isAI: false,
      connected: true
    }];
    fillLobbySlotsWithAI();
    updateHostLobbyUI();
  });

  mp.peer.on('error', (err) => {
    console.error('Peer error:', err);
    clearBrokerTimeout();
    if (err.type === 'unavailable-id') {
      log('Code salon pris, génération d\'un nouveau code…');
      brokerIndex = 0;
      hostRetryCount++;
      setTimeout(() => initHost(), 200);
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed' || err.type === 'ssl-unavailable') {
      log(`<span style="color:var(--red)">Broker ${broker.name} indisponible (${err.type})…</span>`);
      try { mp.peer.destroy(); } catch (e) {}
      brokerIndex++;
      hostRetryCount++;
      setTimeout(() => initHost(), 300);
    } else if (err.type === 'invalid-id' || err.type === 'taken') {
      showNetworkError('Code de salon invalide', 'Le code généré pose problème. Cliquez sur Réessayer.');
    } else if (err.type === 'peer-unavailable') {
      // Pas applicable côté hôte mais on log
      log(`<span style="color:var(--red)">${err.type}</span>`);
    } else {
      log(`<span style="color:var(--red)">Erreur Peer : ${err.type}</span>`);
    }
  });

  mp.peer.on('connection', (conn) => {
    conn.on('open', () => {
      conn.on('data', (data) => handleHostMessage(conn, data));
    });
    conn.on('close', () => handleClientDisconnection(conn.peer));
    conn.on('error', () => handleClientDisconnection(conn.peer));
  });
}

/* ==================== MODE MANUEL (sans serveur P2P) ==================== */
// Échange d'offre/réponse SDP via copy-paste — fonctionne sans aucun serveur
const manualMode = { active: false, role: null, peer: null, connection: null, offer: null };

function startManualMode(role) {
  manualMode.active = true;
  manualMode.role = role;
  showManualUI();
}

function showManualUI() {
  const lobby = $('#online-host-pane');
  if (!lobby) return;
  clearNetworkError();
  lobby.innerHTML = `
    <div class="setup-section">
      <h2>Mode Manuel — ${manualMode.role === 'host' ? 'Hôte' : 'Client'}</h2>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">
        Échangez les codes ci-dessous avec votre adversaire par message, email, ou WhatsApp.
        Aucun serveur requis.
      </p>
      <div id="manual-step-1">
        <div class="rule-label" style="margin-bottom:6px;">1️⃣ Code à envoyer</div>
        <div class="code-box">
          <textarea id="manual-offer" readonly style="flex:1;background:transparent;border:none;color:var(--gold);font-family:monospace;font-size:11px;resize:none;height:80px;outline:none;"></textarea>
          <button id="manual-copy" class="copy-btn">Copier</button>
        </div>
        <button id="manual-generate" class="start-btn" style="margin-top:10px;padding:12px;font-size:14px;">Générer mon code</button>
      </div>
      <div id="manual-step-2" style="margin-top:14px;display:none;">
        <div class="rule-label" style="margin-bottom:6px;">2️⃣ Coller le code de l'adversaire</div>
        <textarea id="manual-answer" class="text-input" placeholder="Coller le code ici..." style="height:80px;font-family:monospace;font-size:11px;"></textarea>
        <button id="manual-connect" class="start-btn" style="margin-top:10px;padding:12px;font-size:14px;">Se connecter</button>
      </div>
    </div>
  `;
  document.getElementById('manual-copy').onclick = () => {
    const txt = document.getElementById('manual-offer').value;
    if (txt) navigator.clipboard.writeText(txt).then(() => { document.getElementById('manual-copy').textContent = 'Copié !'; setTimeout(() => document.getElementById('manual-copy').textContent = 'Copier', 1500); });
  };
  document.getElementById('manual-generate').onclick = generateManualOffer;
  document.getElementById('manual-connect').onclick = connectManualAnswer;
}

async function generateManualOffer() {
  try {
    manualMode.peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    manualMode.peer.onicecandidate = (e) => {
      if (e.candidate) {
        // Recueillir tous les candidats
        if (!manualMode.candidates) manualMode.candidates = [];
        manualMode.candidates.push(e.candidate);
      }
    };
    manualMode.peer.ondatachannel = (e) => {
      manualMode.connection = e.channel;
      setupManualDataChannel();
    };
    const offer = await manualMode.peer.createOffer();
    await manualMode.peer.setLocalDescription(offer);
    // Attendre la fin de la collecte ICE
    await new Promise(r => setTimeout(r, 1500));
    const payload = { sdp: manualMode.peer.localDescription, candidates: manualMode.candidates || [] };
    const encoded = btoa(JSON.stringify(payload));
    document.getElementById('manual-offer').value = encoded;
    log(`Code manuel généré (${encoded.length} caractères). Envoyez-le à votre adversaire.`, true);
    document.getElementById('manual-step-2').style.display = 'block';
  } catch (e) {
    log(`<span style="color:var(--red)">Erreur mode manuel : ${e.message}</span>`);
  }
}

async function connectManualAnswer() {
  try {
    const encoded = document.getElementById('manual-answer').value.trim();
    if (!encoded) { log('Collez le code de l\'adversaire.'); return; }
    const payload = JSON.parse(atob(encoded));
    manualMode.peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    manualMode.peer.onicecandidate = (e) => {
      if (e.candidate) {
        if (!manualMode.candidates) manualMode.candidates = [];
        manualMode.candidates.push(e.candidate);
      }
    };
    manualMode.peer.ondatachannel = (e) => {
      manualMode.connection = e.channel;
      setupManualDataChannel();
    };
    await manualMode.peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    if (payload.candidates) {
      for (const c of payload.candidates) {
        try { await manualMode.peer.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
      }
    }
    const answer = await manualMode.peer.createAnswer();
    await manualMode.peer.setLocalDescription(answer);
    await new Promise(r => setTimeout(r, 1500));
    const answerPayload = { sdp: manualMode.peer.localDescription, candidates: manualMode.candidates || [] };
    const answerEncoded = btoa(JSON.stringify(answerPayload));
    // Pour le client on doit afficher la réponse à renvoyer à l'hôte
    showManualAnswerUI(answerEncoded);
  } catch (e) {
    log(`<span style="color:var(--red)">Code invalide : ${e.message}</span>`);
  }
}

function showManualAnswerUI(encoded) {
  const lobby = $('#online-host-pane');
  if (!lobby) return;
  lobby.innerHTML = `
    <div class="setup-section">
      <h2>Mode Manuel — Réponse</h2>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">
        Envoyez ce code à l'hôte. En attente de la connexion…
      </p>
      <div class="code-box">
        <textarea id="manual-answer-out" readonly style="flex:1;background:transparent;border:none;color:var(--gold);font-family:monospace;font-size:11px;resize:none;height:80px;outline:none;">${encoded}</textarea>
        <button id="manual-copy-out" class="copy-btn">Copier</button>
      </div>
    </div>
  `;
  document.getElementById('manual-copy-out').onclick = () => {
    navigator.clipboard.writeText(encoded).then(() => {
      document.getElementById('manual-copy-out').textContent = 'Copié !';
      setTimeout(() => document.getElementById('manual-copy-out').textContent = 'Copier', 1500);
    });
  };
}

function setupManualDataChannel() {
  const dc = manualMode.connection;
  if (!dc) return;
  dc.onopen = () => {
    log(`Connexion manuelle établie !`, true);
    // Bridge : faire croire à mp.conn que la connexion existe
    if (manualMode.role === 'host') {
      mp.role = 'host';
      mp.active = true;
      // Stocker comme une connexion factice compatible
      const fakePeerId = 'manual-client-' + Date.now();
      mp.conn[fakePeerId] = {
        open: true,
        send: (data) => { try { dc.send(JSON.stringify(data)); } catch (e) { console.warn(e); } },
        peer: fakePeerId,
        color: 'green',
        playerName: 'Adversaire',
      };
      mp.myColor = 'red';
      // Émettre le pseudo du client
      dc.send(JSON.stringify({ type: 'JOIN', name: 'Adversaire (manuel)' }));
    } else {
      mp.role = 'client';
      mp.active = true;
      mp.myColor = 'green';
      mp.conn[mp.roomCode] = {
        open: true,
        send: (data) => { try { dc.send(JSON.stringify(data)); } catch (e) { console.warn(e); } },
        peer: 'manual-host',
      };
      const pseudo = prompt('Votre pseudo :') || 'Client';
      dc.send(JSON.stringify({ type: 'JOIN', name: pseudo }));
    }
  };
  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (manualMode.role === 'host') {
        const conn = Object.values(mp.conn)[0];
        if (conn) handleHostMessage(conn, data);
      } else {
        handleClientMessage(data);
      }
    } catch (err) { console.error('Manual message error', err); }
  };
  dc.onclose = () => {
    log(`<span style="color:var(--red)">Connexion manuelle fermée.</span>`);
  };
}

// --- Reconnexion multi ---
// Quand un client rejoint, l'hôte lui attribue un reconnectToken.
// Si ce client perd la connexion et revient plus tard avec le même token,
// il reprend sa place exacte (couleur, état) sans réinitialiser la partie.
function issueReconnectToken(peerId, color) {
  const token = generateReconnectToken();
  mp.reconnectTokens[token] = { peerId, color, issuedAt: Date.now() };
  return token;
}

function findPlayerByReconnectToken(token) {
  if (!mp.reconnectTokens[token]) return null;
  const entry = mp.reconnectTokens[token];
  return mp.players.find(p => p.color === entry.color) || null;
}

function fillLobbySlotsWithAI() {
  const activeColors = COLOR_SETS[setupCount];
  // Conserver les joueurs humains déjà connectés (ex: l'hôte, ou un client qui s'est reconnecté)
  const humanPlayers = mp.players.filter(p => !p.isAI);
  mp.players = [...humanPlayers];

  activeColors.forEach((color, idx) => {
    if (!mp.players.some(p => p.color === color)) {
      const wantsAI = setupTypes[color] === 'ai';
      // Générer un label J1/J2/etc. pour les slots multi-humains
      const playerNum = mp.players.length + 1;
      const baseName = (setupCount === 2 && wantsAI === false) ? `J${playerNum}` : `Joueur ${COLOR_NAMES[color]}`;
      mp.players.push({
        peerId: (wantsAI ? 'AI-' : 'WAIT-') + color,
        name: wantsAI ? `${baseName} (IA)` : `${baseName} (en attente)`,
        color: color,
        isAI: wantsAI,
        connected: wantsAI  // Une IA est toujours "connectée", un humain en attente ne l'est pas
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
    // 1) Tentative de reconnexion par token persistant
    if (data.reconnectToken && mp.reconnectTokens[data.reconnectToken]) {
      const entry = mp.reconnectTokens[data.reconnectToken];
      const existingSlot = mp.players.find(p => p.color === entry.color);
      if (existingSlot) {
        conn.color = entry.color;
        conn.playerName = existingSlot.name;
        conn.reconnectToken = data.reconnectToken;
        mp.conn[conn.peer] = conn;
        existingSlot.peerId = conn.peer;
        existingSlot.connected = true;
        if (state.players[pIdxFromColor(entry.color)]) {
          state.players[pIdxFromColor(entry.color)].isAI = false;
        }
        log(`<strong>${conn.playerName}</strong> s'est reconnecté !`, true);
        conn.send({ type: 'JOIN_OK', color: entry.color, reconnectToken: data.reconnectToken, reconnected: true });
        if (gameScreen.classList.contains('active')) broadcastState();
        return;
      }
    }

    // 2) Sinon, rejoindre un slot libre (priorité aux slots WAIT pour humains)
    const waitSlot = mp.players.find(p => p.peerId && p.peerId.startsWith('WAIT-'));
    const aiSlot = mp.players.find(p => p.isAI);
    const targetSlot = waitSlot || aiSlot;
    if (!targetSlot) {
      conn.send({ type: 'ERROR', message: 'Le salon est complet.' });
      conn.close();
      return;
    }

    conn.color = targetSlot.color;
    // Calcul du libellé client (J2 en mode 2 joueurs humains, sinon nom fourni)
    let clientDisplayName = data.name;
    if (!clientDisplayName) {
      if (setupCount === 2) {
        // Compter les humains déjà dans le salon (hôte inclus)
        const humansAlready = mp.players.filter(p => !p.isAI && p.peerId !== 'AI-' + p.color).length;
        clientDisplayName = `J${humansAlready + 1}`;
      } else {
        clientDisplayName = `Joueur ${COLOR_NAMES[conn.color]}`;
      }
    }
    conn.playerName = clientDisplayName;
    conn.reconnectToken = issueReconnectToken(conn.peer, conn.color);
    mp.conn[conn.peer] = conn;

    targetSlot.peerId = conn.peer;
    targetSlot.name = conn.playerName;
    targetSlot.isAI = false;
    targetSlot.connected = true;

    log(`<strong>${conn.playerName}</strong> a rejoint le salon !`, true);
    updateHostLobbyUI();
    broadcastLobby();
    conn.send({ type: 'JOIN_OK', color: conn.color, reconnectToken: conn.reconnectToken });
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
let clientRetryCount = 0;
function initClient(roomCode, name) {
  mp.active = true;
  mp.role = 'client';
  mp.roomCode = roomCode.toUpperCase().trim();

  if (mp.peer) { try { mp.peer.destroy(); } catch (e) {} mp.peer = null; }

  if (clientRetryCount >= PEER_BROKERS.length * 2) {
    showNetworkError(
      'Aucun serveur P2P disponible',
      'Tous les brokers PeerJS sont injoignables. Essayez le Mode Manuel (sans serveur).'
    );
    return;
  }

  const broker = PEER_BROKERS[clientRetryCount % PEER_BROKERS.length];
  log(`Connexion au broker ${broker.name}…`);

  const randomClientId = 'LUDO-C-' + Math.floor(Math.random() * 1e8).toString(36);
  mp.peer = new Peer(randomClientId, {
    host: broker.host,
    port: broker.port,
    secure: broker.secure,
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    },
  });

  let clientConnected = false;
  const clientTimeout = setTimeout(() => {
    if (!clientConnected && mp.peer && !mp.peer.open) {
      console.warn(`Client broker ${broker.name} timeout`);
      try { mp.peer.destroy(); } catch (e) {}
      clientRetryCount++;
      initClient(mp.roomCode, name);
    }
  }, BROKER_TIMEOUT_MS);

  mp.peer.on('open', () => {
    clientConnected = true;
    clearTimeout(clientTimeout);
    clearNetworkError();
    log(`Connecté à ${broker.name}. Connexion au salon <strong>${mp.roomCode}</strong>…`);
    let conn;
    try {
      conn = mp.peer.connect(mp.roomCode, { reliable: true });
    } catch (e) {
      log(`<span style="color:var(--red)">Erreur de connexion : ${e.message}</span>`);
      return;
    }
    mp.conn[mp.roomCode] = conn;

    const connectTimeout = setTimeout(() => {
      if (!conn.open) {
        log(`<span style="color:var(--red)">L'hôte ${mp.roomCode} est injoignable. Vérifiez le code.</span>`);
      }
    }, 6000);

    conn.on('open', () => {
      clearTimeout(connectTimeout);
      log('Connecté à l\'hôte !', true);
      const saved = loadReconnectToken();
      const reconnectToken = (saved && saved.roomCode === mp.roomCode) ? saved.token : null;
      try { conn.send({ type: 'JOIN', name, reconnectToken }); } catch (e) { console.error(e); }
    });

    conn.on('data', (data) => handleClientMessage(data));

    conn.on('close', () => {
      log(`<span style="color:var(--red)">Déconnecté de l'hôte.</span>`);
      // Pas de reload brutal, on garde l'écran pour retry
    });

    conn.on('error', (err) => {
      console.error('Conn error:', err);
      log(`<span style="color:var(--red)">Erreur de connexion : ${err.type || err.message}</span>`);
    });
  });

  mp.peer.on('error', (err) => {
    console.error('Peer error:', err);
    clearTimeout(clientTimeout);
    if (err.type === 'peer-unavailable') {
      log(`<span style="color:var(--red)">Salon ${mp.roomCode} introuvable. Vérifiez le code avec l'hôte.</span>`);
    } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'ssl-unavailable'].includes(err.type)) {
      log(`<span style="color:var(--red)">Broker ${broker.name} indisponible…</span>`);
      try { mp.peer.destroy(); } catch (e) {}
      clientRetryCount++;
      setTimeout(() => initClient(mp.roomCode, name), 400);
    } else if (err.type === 'unavailable-id') {
      // ID client pris, réessayer avec un nouveau
      clientRetryCount++;
      setTimeout(() => initClient(mp.roomCode, name), 200);
    } else {
      log(`<span style="color:var(--red)">Erreur Peer : ${err.type}</span>`);
    }
  });
}

function handleClientMessage(data) {
  if (data.type === 'ERROR') {
    log(`<span style="color:var(--red)">${data.message}</span>`);
    return;
  }

  if (data.type === 'JOIN_OK') {
    mp.myColor = data.color;
    mp.myReconnectToken = data.reconnectToken;
    if (data.reconnectToken) {
      saveReconnectToken(data.reconnectToken, mp.roomCode);
      log(`Connecté en tant que <strong>${COLOR_NAMES[data.color]}</strong>${data.reconnected ? ' (reconnecté)' : ''}.`, true);
    }
    return;
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
    if (mp.role !== 'spectator') updateOnlineControls();

    if (state.gameOver) {
      const winner = state.ranking[0];
      showVictory(winner);
    }
  }

  if (data.type === 'CHAT') {
    chat.messages.push(data.msg);
    if (chat.messages.length > 60) chat.messages.shift();
    renderChatMessages();
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

/* ==================== PICKERS (Thème / Skin / Lang) ==================== */
function renderPersonalization() {
  const card = document.querySelector('.setup-card');
  if (!card) return;
  let div = document.getElementById('personalization-config');
  if (!div) {
    div = document.createElement('div');
    div.id = 'personalization-config';
    div.className = 'setup-section';
    div.innerHTML = `
      <h2>Personnalisation</h2>
      <div class="rule-label" style="margin-bottom:6px;" data-i18n="theme">Thème</div>
      <div id="theme-buttons" class="count-buttons" style="margin-bottom:12px;"></div>
      <div class="rule-label" style="margin-bottom:6px;" data-i18n="skin">Skin des pions</div>
      <div id="skin-buttons" class="count-buttons"></div>`;
    card.insertBefore(div, card.querySelector('#start-btn'));
  }
  const themeBtns = div.querySelector('#theme-buttons');
  themeBtns.innerHTML = '';
  Object.entries(THEMES).forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'count-btn' + (currentTheme === key ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      setTheme(key);
      themeBtns.querySelectorAll('.count-btn').forEach(x => x.classList.toggle('active', x === b));
    });
    themeBtns.appendChild(b);
  });
  const skinBtns = div.querySelector('#skin-buttons');
  skinBtns.innerHTML = '';
  const skinLabels = { classic: 'Classique', emojis: 'Émojis', fruits: 'Fruits', animals: 'Animaux' };
  Object.entries(TOKEN_SKINS).forEach(([key]) => {
    const b = document.createElement('button');
    b.className = 'count-btn' + (currentSkin === key ? ' active' : '');
    b.textContent = skinLabels[key] || key;
    b.addEventListener('click', () => {
      currentSkin = key;
      try { localStorage.setItem('ludo-royal-skin', key); } catch (e) {}
      skinBtns.querySelectorAll('.count-btn').forEach(x => x.classList.toggle('active', x === b));
      if (gameScreen.classList.contains('active')) applyTokenSkin();
    });
    skinBtns.appendChild(b);
  });
}

function applyTokenSkin() {
  const skin = TOKEN_SKINS[currentSkin];
  document.querySelectorAll('.token').forEach(el => {
    el.classList.remove('skin-emojis', 'skin-fruits', 'skin-animals');
    if (currentSkin !== 'classic' && skin && skin.emojis) {
      const color = el.classList.contains('red') ? 'red' : el.classList.contains('green') ? 'green' : el.classList.contains('yellow') ? 'yellow' : 'blue';
      el.classList.add('skin-' + currentSkin);
      el.setAttribute('data-emoji', skin.emojis[color]);
    } else {
      el.removeAttribute('data-emoji');
    }
  });
}

/* ==================== PWA Install Prompt ==================== */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Afficher la bannière après 3s si pas encore installée
  setTimeout(() => {
    const dismissed = localStorage.getItem('ludo-royal-pwa-dismissed');
    if (!dismissed) $('#pwa-install').classList.add('show');
  }, 3000);
});

$('#pwa-install-yes').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  $('#pwa-install').classList.remove('show');
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') localStorage.setItem('ludo-royal-pwa-dismissed', '1');
  deferredInstallPrompt = null;
});

$('#pwa-install-no').addEventListener('click', () => {
  $('#pwa-install').classList.remove('show');
  localStorage.setItem('ludo-royal-pwa-dismissed', '1');
});

window.addEventListener('appinstalled', () => {
  $('#pwa-install').classList.remove('show');
  log('Application installée avec succès !', true);
});

/* ==================== Network Status Indicator ==================== */
function updateNetworkStatus() {
  const el = $('#network-status');
  if (!el) return;
  const online = navigator.onLine;
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  el.querySelector('.status-text').textContent = online ? 'En ligne' : 'Hors ligne';
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

/* ==================== Error Boundary Globale ==================== */
function showError(message) {
  const overlay = $('#error-overlay');
  if (!overlay) return;
  $('#error-message').textContent = message;
  overlay.classList.add('show');
}
$('#error-reload').addEventListener('click', () => location.reload());
$('#error-dismiss').addEventListener('click', () => $('#error-overlay').classList.remove('show'));
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
  showError(e.message || 'Erreur inattendue');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  showError(String(e.reason?.message || e.reason || 'Promesse rejetée'));
});

/* ==================== Accessibilité clavier ==================== */
document.addEventListener('keydown', (e) => {
  // Désactiver en mode spectateur ou si game inactif
  if (!gameScreen.classList.contains('active')) return;
  if (state.busy || state.gameOver) return;

  const p = currentPlayer();
  if (!p || p.isAI) return;

  // Espace/Enter : lancer le dé
  if ((e.code === 'Space' || e.key === ' ') && !state.rolled && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    if (!diceBtn.disabled) rollDice();
  }

  // Touches flèches pour sélectionner un pion movable
  if (state.rolled && document.activeElement.tagName !== 'INPUT') {
    const movable = getMovableTokens(state.current, state.dice);
    if (movable.length === 0) return;
    const selected = movable.findIndex(tIdx => {
      const el = document.getElementById(tokenId(state.current, tIdx));
      return el && document.activeElement === el;
    });
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
      e.preventDefault();
      const next = movable[(selected + 1) % movable.length];
      document.getElementById(tokenId(state.current, next))?.focus();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
      e.preventDefault();
      const prev = movable[(selected - 1 + movable.length) % movable.length];
      document.getElementById(tokenId(state.current, prev))?.focus();
    } else if (e.code === 'Enter' && selected >= 0) {
      e.preventDefault();
      moveToken(state.current, movable[selected]);
    }
  }

  // M : toggle musique
  if (e.key === 'm' && document.activeElement.tagName !== 'INPUT') {
    $('#music-btn').click();
  }
  // S : toggle son
  if (e.key === 's' && document.activeElement.tagName !== 'INPUT') {
    $('#sound-btn').click();
  }
  // Échap : fermer modale/menu
  if (e.key === 'Escape') {
    if ($('#error-overlay').classList.contains('show')) $('#error-overlay').classList.remove('show');
    else if ($('#victory-modal').classList.contains('show') && !state.gameOver) {
      $('#victory-modal').classList.remove('show');
      nextTurn(false);
    }
  }
});

/* ==================== INIT ==================== */
loadAchievements();
loadTelemetry();
setTheme(currentTheme);
applyI18n();
initShakeDetection();
renderSetup();
renderRules();
renderGameModes();
renderExpressToggle();
renderSpectatorToggle();
renderPersonalization();
renderResumeBanner();
checkUrlParams();

const langBtnInit = $('#lang-btn');
if (langBtnInit) langBtnInit.textContent = currentLang.toUpperCase();

// Forcer la position initiale des pions si mode express
if (gameMode === GAME_MODES.express && state.players.length > 0) {
  state.players.forEach(p => p.tokens = [-1, -1]);
}
