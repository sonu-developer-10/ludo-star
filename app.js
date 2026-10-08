/* ================================================================
   LUDO INDIA — Multiplayer game client
   Keeps the existing UI, but fixes board rendering, token interaction,
   room controls, player display, turn handling and resilient Firebase sync.
   ================================================================ */

let db = null;
let roomId = null;
let myPlayerColor = null;
let gameState = null;
let roomRefListener = null;
let roomValueRef = null;
let turnTimerHandle = null;
let leaving = false;
let toastTimer = null;
let captureFlashTimer = null;
let lastCaptureEventId = null;
let captureEventInitialized = false;
let previousGameState = null;
let lastWinnerKey = null;
let winnerCelebrationTimer = null;
let passPlayMode = false;
let computerMode = false;
let computerTurnTimer = null;

const PLAYER_COLORS = ['red', 'green', 'yellow', 'blue'];
const COLOR_LABELS = { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };
// Start cells match the supplied reference board exactly.
// The existing 52-cell visual track uses these absolute indices.
const START_POSITIONS = { red: 1, green: 14, yellow: 28, blue: 41 };
// The visual start cells are the first playable cells after each corner.
// Red now starts from cell-7-2 (not cell-7-1), matching the intended board.

const FINISH_POSITION = 57;
const TRACK_LENGTH = 52;
// Four visible star/safe cells from the supplied reference board.
// Start cells are protected too, but they do NOT get a star icon.
const STAR_SAFE_POSITIONS = [9, 22, 35, 48];
const START_SAFE_POSITIONS = Object.values(START_POSITIONS);
const START_COORDINATES = {
  red: [7,2],
  green: [2,9],
  yellow: [9,14],
  blue: [14,7]
};
const SAFE_POSITIONS = [...new Set([...STAR_SAFE_POSITIONS, ...START_SAFE_POSITIONS])];

// The board uses opposite seats for a 2-player game.
const COLOR_ORDERS = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue']
};
const DICE_ICONS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const TURN_SECONDS = 30;

// 52 common-track cells, clockwise, with red starting at row 7 / col 1.
const TRACK = [
  [7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[6,7],[5,7],[4,7],[3,7],[2,7],[1,7],[1,8],[1,9],
  [2,9],[3,9],[4,9],[5,9],[6,9],[7,9],[7,10],[7,11],[7,12],[7,13],[7,14],[7,15],[8,15],[9,15],
  [9,14],[9,13],[9,12],[9,11],[9,10],[10,9],[11,9],[12,9],[13,9],[14,9],[15,9],[15,8],[15,7],
  [14,7],[13,7],[12,7],[11,7],[10,7],[9,6],[9,5],[9,4],[9,3],[9,2],[9,1],[8,1]
];

const HOME_LANES = {
  red: [[8,2],[8,3],[8,4],[8,5],[8,6]],
  green: [[2,8],[3,8],[4,8],[5,8],[6,8]],
  yellow: [[8,14],[8,13],[8,12],[8,11],[8,10]],
  blue: [[14,8],[13,8],[12,8],[11,8],[10,8]]
};

const YARDS = {
  red: [1,1,7,7], green: [1,10,7,16], yellow: [10,10,16,16], blue: [10,1,16,7]
};

function $(id) { return document.getElementById(id); }
function now() { return Date.now(); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function generateGuestName(){const key='ludo_guest_name_v8';try{const saved=localStorage.getItem(key);if(/^Guest \\d{4}$/.test(saved||''))return saved;const name=`Guest ${Math.floor(1000+Math.random()*9000)}`;localStorage.setItem(key,name);return name}catch{return `Guest ${Math.floor(1000+Math.random()*9000)}`}}
function ensureGuestName(){const name=generateGuestName();if($('createName')&&!$('createName').value.trim())$('createName').value=name;if($('joinName')&&!$('joinName').value.trim())$('joinName').value=name;return name}
function setGuestMode(){const name=generateGuestName();if($('createName'))$('createName').value=name;if($('joinName'))$('joinName').value=name;showToast(`🎭 You're playing as ${name}`)}

function normalizeName(value, fallback = 'Player') {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 18);
  return name || (fallback === 'Player' ? generateGuestName() : fallback);
}
function showToast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function showCaptureFlash(event = {}) {
  const el = $('captureFlash');
  if (!el) return;
  const by = event.by && COLOR_LABELS[event.by] ? ` • ${COLOR_LABELS[event.by]}` : '';
  const sub = $('captureFlashSub');
  if (sub) sub.textContent = `Opponent ki goti cut gayi${by}`;
  el.classList.remove('show');
  // Restart animation reliably even when captures happen close together.
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(captureFlashTimer);
  captureFlashTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
function showError(message) {
  const el = $('setupError');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}
function clearError() { $('setupError')?.classList.add('hidden'); }

function createPlayerTokens(color, name) {
  return {
    color,
    name: normalizeName(name, COLOR_LABELS[color]),
    joinedAt: now(),
    tokens: {
      t1: { id:'t1', isBase:true, position:-1 },
      t2: { id:'t2', isBase:true, position:-1 },
      t3: { id:'t3', isBase:true, position:-1 },
      t4: { id:'t4', isBase:true, position:-1 }
    }
  };
}

function createDefaultRoomState(color, name, maxPlayers) {
  return {
    hostColor: color,
    maxPlayers: Math.min(4, Math.max(2, Number(maxPlayers) || 4)),
    status: 'WAITING',
    currentTurn: color,
    diceValue: null,
    diceRolled: false,
    consecutiveSixes: 0,
    turnStartedAt: null,
    createdAt: now(),
    updatedAt: now(),
    players: { [color]: createPlayerTokens(color, name) }
  };
}

function getActiveColors(state = gameState) {
  return PLAYER_COLORS.filter(color => !!state?.players?.[color]);
}

function getNextPlayerTurn(currentColor, state = gameState) {
  const active = getActiveColors(state);
  if (active.length <= 1) return currentColor;
  const start = PLAYER_COLORS.indexOf(currentColor);
  for (let i = 1; i <= PLAYER_COLORS.length; i++) {
    const color = PLAYER_COLORS[(start + i) % PLAYER_COLORS.length];
    if (active.includes(color)) return color;
  }
  return currentColor;
}

function getCellId(row, col) { return `cell-${row}-${col}`; }
function getTrackCoord(position) { return TRACK[((position % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH]; }
function getAbsoluteTrackPosition(color, progress) {
  return (START_POSITIONS[color] + progress) % TRACK_LENGTH;
}
function getStartCoord(color) { return START_COORDINATES[color]; }
function getTokenCoord(color, position) {
  if (position < 0) return null;
  if (position < TRACK_LENGTH) return getTrackCoord(getAbsoluteTrackPosition(color, position));
  if (position === FINISH_POSITION) return [8,8];
  return HOME_LANES[color][Math.min(4, position - TRACK_LENGTH)];
}

function buildBoardCell(row, col) {
  const cell = document.createElement('div');
  cell.id = getCellId(row, col);
  cell.className = 'cell blank';
  cell.dataset.row = row;
  cell.dataset.col = col;
  cell.style.gridRow = row;
  cell.style.gridColumn = col;

  const trackIndex = TRACK.findIndex(([r,c]) => r === row && c === col);
  if (trackIndex >= 0) {
    cell.className = 'cell path';
    if (STAR_SAFE_POSITIONS.includes(trackIndex)) cell.classList.add('safe');
    const startColor = PLAYER_COLORS.find(color => START_POSITIONS[color] === trackIndex);
    if (startColor) cell.classList.add(`start-${startColor}`);
    cell.dataset.track = trackIndex;
  }

  for (const color of PLAYER_COLORS) {
    const laneIndex = HOME_LANES[color].findIndex(([r,c]) => r === row && c === col);
    if (laneIndex >= 0) {
      cell.className = `cell home-lane ${color}-lane`;
      cell.dataset.homeLane = `${color}:${laneIndex}`;
    }
  }

  return cell;
}

function generateBoardUI() {
  const board = $('board');
  if (!board) return;
  board.innerHTML = '';
  board.className = 'board';
  board.setAttribute('role', 'grid');

  // Base 15x15 grid.
  for (let row = 1; row <= 15; row++) {
    for (let col = 1; col <= 15; col++) board.appendChild(buildBoardCell(row, col));
  }

  // Decorative yards. They sit above the base cells but below tokens.
  for (const [color, [r1,c1,r2,c2]] of Object.entries(YARDS)) {
    const yard = document.createElement('div');
    yard.className = `yard ${color}`;
    yard.dataset.color = color;
    yard.style.gridRow = `${r1} / ${r2}`;
    yard.style.gridColumn = `${c1} / ${c2}`;
    yard.innerHTML = `<div class="home-box" aria-label="${COLOR_LABELS[color]} home">${['t1','t2','t3','t4'].map(t => `<div class="token-spot" id="${color}-${t}-spot"></div>`).join('')}</div>`;
    board.appendChild(yard);
  }

  const finish = document.createElement('div');
  finish.className = 'finish';
  finish.style.gridRow = '7 / 10';
  finish.style.gridColumn = '7 / 10';
  finish.innerHTML = '<span>🏆</span>';
  board.appendChild(finish);
}

function ensureTokenElement(color, tokenId) {
  let el = $(`${color}-${tokenId}`);
  if (el) return el;
  el = document.createElement('button');
  el.type = 'button';
  el.id = `${color}-${tokenId}`;
  el.className = `token ${color}`;
  el.dataset.color = color;
  el.dataset.tokenId = tokenId;
  el.textContent = tokenId.slice(1);
  el.setAttribute('aria-label', `${COLOR_LABELS[color]} token ${tokenId.slice(1)}`);
  el.addEventListener('click', () => handleTokenClick(tokenId));
  return el;
}


function tokenPositionKey(color, tokenId, token) {
  if (!token) return `${color}:${tokenId}:missing`;
  return `${color}:${tokenId}:${token.isBase ? -1 : Number(token.position)}`;
}

function getTokenState(state, color, tokenId) {
  return state?.players?.[color]?.tokens?.[tokenId] || null;
}

function getMovementPath(color, fromPosition, toPosition, fromIsBase = false) {
  const from = fromIsBase || Number(fromPosition) < 0 ? -1 : Number(fromPosition);
  const to = Number(toPosition);
  if (to < 0 || from === to) return [];
  const path = [];
  // A token leaving home enters its own start square as step 1.
  for (let pos = from + 1; pos <= to; pos++) path.push(pos);
  return path;
}

function getCellCenter(coord) {
  const cell = coord ? $(getCellId(coord[0], coord[1])) : null;
  if (!cell) return null;
  const r = cell.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function getHomeTokenCenter(color, tokenId) {
  const spot = $(`${color}-${tokenId}-spot`);
  if (!spot) return null;
  const r = spot.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function showRoutePath(color, fromToken, toToken) {
  const fromPos = fromToken?.isBase ? -1 : Number(fromToken?.position ?? -1);
  const toPos = toToken?.isBase ? -1 : Number(toToken?.position ?? -1);
  if (toPos < 0 || fromPos === toPos || toPos < fromPos) return;

  const path = getMovementPath(color, fromPos, toPos, fromPos < 0);
  if (!path.length) return;

  document.querySelectorAll('.route-highlight,.route-highlight-current')
    .forEach(el => el.classList.remove('route-highlight','route-highlight-current'));

  path.forEach((pos, index) => {
    const coord = getTokenCoord(color, pos);
    const cell = coord ? $(getCellId(coord[0], coord[1])) : null;
    if (!cell) return;
    setTimeout(() => {
      cell.classList.add(index === path.length - 1 ? 'route-highlight-current' : 'route-highlight');
    }, index * 95);
  });

  const total = path.length * 95 + 850;
  setTimeout(() => {
    document.querySelectorAll('.route-highlight,.route-highlight-current')
      .forEach(el => el.classList.remove('route-highlight','route-highlight-current'));
  }, total);
}

function createWinnerConfetti() {
  const wrap = $('winnerConfetti');
  if (!wrap) return;
  wrap.innerHTML = '';
  const colors = ['#ef4b55','#20b86b','#f2c33f','#438df0','#fff'];
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--delay', `${Math.random() * .65}s`);
    piece.style.setProperty('--duration', `${1.9 + Math.random() * 1.5}s`);
    piece.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty('--color', colors[i % colors.length]);
    piece.style.setProperty('--size', `${5 + Math.random() * 8}px`);
    wrap.appendChild(piece);
  }
}

function showWinnerCelebration(color) {
  const overlay = $('winnerCelebration');
  if (!overlay) return;
  const player = gameState?.players?.[color];
  const name = player?.name || COLOR_LABELS[color] || 'Player';
  $('winnerName') && ($('winnerName').textContent = name);
  $('winnerColor') && ($('winnerColor').textContent = `${COLOR_LABELS[color] || ''} • Ludo Champion`);
  createWinnerConfetti();
  overlay.classList.remove('show');
  void overlay.offsetWidth;
  overlay.classList.add('show');
  clearTimeout(winnerCelebrationTimer);
  winnerCelebrationTimer = setTimeout(() => overlay.classList.remove('show'), 6500);
}

function renderHomeState() {
  const activeColors = new Set(getActiveColors());
  document.querySelectorAll('.yard[data-color]').forEach(yard => {
    const color = yard.dataset.color;
    const active = activeColors.has(color);
    yard.classList.toggle('inactive-home', !active);
    yard.classList.toggle('active-home', active);
  });
}

function renderTokensUI(previousState = null) {
  if (!gameState?.players) return;

  document.querySelectorAll('.token').forEach(el => el.remove());
  const groups = new Map();

  for (const color of PLAYER_COLORS) {
    const player = gameState.players[color];
    if (!player?.tokens) continue;
    for (const tokenId of Object.keys(player.tokens)) {
      const token = player.tokens[tokenId];
      let target = null;
      let isHome = false;

      if (token.isBase || Number(token.position) < 0) {
        target = $(`${color}-${tokenId}-spot`);
        isHome = true;
      } else {
        const coord = getTokenCoord(color, Number(token.position));
        target = coord ? $(getCellId(coord[0], coord[1])) : null;
      }
      if (!target) continue;

      const groupKey = isHome ? `${color}-${tokenId}-home` : target.id;
      const bucket = groups.get(groupKey) || [];
      bucket.push({ color, tokenId, token, target, isHome });
      groups.set(groupKey, bucket);
    }
  }

  for (const bucket of groups.values()) {
    bucket.forEach((item, index) => {
      const { color, tokenId, token, target, isHome } = item;
      const el = ensureTokenElement(color, tokenId);
      el.classList.toggle('selectable', color === myPlayerColor && canMoveToken(token, gameState.diceValue));
      el.classList.toggle('other-player-token', color !== myPlayerColor);
      el.classList.toggle('home-token', isHome);
      el.classList.toggle('stack-token', !isHome && bucket.length > 1);
      el.dataset.stackIndex = String(index);
      el.dataset.stackCount = String(bucket.length);
      const isSelectable = color === myPlayerColor && canMoveToken(token, gameState.diceValue);
      // Tokens stay visually solid even when they are not clickable.
      // Using disabled=true here applied the browser's opacity to every opponent/invalid token.
      el.disabled = false;
      el.setAttribute('aria-disabled', String(!isSelectable));
      target.appendChild(el);
    });
  }

  if (previousState && gameState?.status === 'PLAYING') {
    for (const color of PLAYER_COLORS) {
      for (const tokenId of ['t1','t2','t3','t4']) {
        const fromToken = getTokenState(previousState, color, tokenId);
        const toToken = getTokenState(gameState, color, tokenId);
        const fromPos = fromToken?.isBase ? -1 : Number(fromToken?.position ?? -1);
        const toPos = toToken?.isBase ? -1 : Number(toToken?.position ?? -1);
        if (toPos > fromPos && toPos >= 0 && toPos - fromPos <= 6) {
          showRoutePath(color, fromToken, toToken);
        }
      }
    }
  }
}

function canMoveToken(token, diceValue) {
  if (!token || !Number.isInteger(Number(diceValue))) return false;
  const dice = Number(diceValue);
  if (token.isBase) return dice === 6;
  return Number(token.position) >= 0 && Number(token.position) + dice <= FINISH_POSITION;
}
function getLegalTokenIds(tokens, diceValue) {
  return Object.entries(tokens || {})
    .filter(([, token]) => canMoveToken(token, diceValue))
    .map(([tokenId]) => tokenId);
}

function hasValidMoves(tokens, diceValue) {
  return getLegalTokenIds(tokens, diceValue).length > 0;
}

function updateVisibleYards() {
  renderHomeState();
}

function renderPlayersUI() {
  const list = $('playersList');
  if (!list || !gameState) return;
  const active = getActiveColors();
  const visibleColors = COLOR_ORDERS[Math.min(4, Math.max(2, Number(gameState.maxPlayers) || 4))] || COLOR_ORDERS[4];
  list.innerHTML = visibleColors.map(color => {
    const player = gameState.players?.[color];
    const activeClass = gameState.currentTurn === color && gameState.status === 'PLAYING' ? 'active' : '';
    if (!player) {
      return `<div class="player empty-player"><div class="player-avatar ${color}">+</div><div><b>${COLOR_LABELS[color]}</b><small>Waiting for player…</small></div></div>`;
    }
    const homeCount = Object.values(player.tokens || {}).filter(t => Number(t.position) === FINISH_POSITION).length;
    return `<div class="player ${activeClass}">
      <div class="player-avatar ${color}">${color === myPlayerColor ? '★' : '●'}</div>
      <div class="player-copy"><b>${escapeHtml(player.name || COLOR_LABELS[color])}${color === gameState.hostColor ? ' 👑' : ''}</b><small>${color === myPlayerColor ? 'You' : COLOR_LABELS[color]} • ${homeCount}/4 Home</small></div>
      <span class="player-dot ${color}"></span>
    </div>`;
  }).join('');
  $('roomTitle') && ($('roomTitle').textContent = `Room ${roomId || ''}`);
  $('roomSubtitle') && ($('roomSubtitle').textContent = `${active.length}/${gameState.maxPlayers || 4} players joined.`);
}

function createPassPlayState(count=4, vsComputer=false) {
  const n = Math.min(4, Math.max(2, Number(count) || 4));
  const colors = COLOR_ORDERS[n];
  const players = {};
  colors.forEach((c,i) => {
    const isBot = !!vsComputer && i > 0;
    players[c] = {
      ...createPlayerTokens(c, isBot ? 'Computer ' + i : 'Player ' + (i + 1)),
      isComputer: isBot
    };
  });
  return {
    hostColor: colors[0],
    maxPlayers: n,
    status: 'PLAYING',
    currentTurn: colors[0],
    diceValue: null,
    diceRolled: false,
    consecutiveSixes: 0,
    turnStartedAt: now(),
    createdAt: now(),
    updatedAt: now(),
    mode: vsComputer ? 'COMPUTER' : 'PASS_PLAY',
    players
  };
}

function enterPassPlay(){
  passPlayMode = true;
  computerMode = window.confirm('🤖 Computer ke saath khelna hai? OK = Computer, Cancel = Pass & Play');
  roomId = 'PASSPLAY';
  myPlayerColor = 'red';
  const count = Number($('playerCount')?.value || 4);
  gameState = createPassPlayState(count, computerMode);
  renderGameUI();
  showToast(computerMode ? `🤖 Vs Computer — ${gameState.maxPlayers} players` : `👥 Pass & Play — ${gameState.maxPlayers} players`);
  scheduleComputerTurn(800);
}

function isComputerTurn() {
  return passPlayMode && computerMode && !!gameState?.players?.[gameState.currentTurn]?.isComputer;
}

function clearComputerTurnTimer() {
  clearTimeout(computerTurnTimer);
  computerTurnTimer = null;
}

function scheduleComputerTurn(delay=650) {
  clearComputerTurnTimer();
  if (!isComputerTurn() || gameState?.status !== 'PLAYING') return;
  computerTurnTimer = setTimeout(() => {
    computerTurnTimer = null;
    if (isComputerTurn() && !gameState?.diceRolled) rollPassPlayDice(true);
  }, delay);
}

function chooseComputerToken(color, dice) {
  const tokens = gameState?.players?.[color]?.tokens || {};
  const legal = getLegalTokenIds(tokens, dice);
  if (!legal.length) return null;

  // Prefer a capture, then a home finish, then opening a base token on 6,
  // otherwise advance the token that is furthest along.
  const capture = legal.find(id => {
    const t = tokens[id];
    const np = t.isBase ? 0 : Number(t.position) + dice;
    const target = np < TRACK_LENGTH ? getAbsoluteTrackPosition(color, np) : null;
    if (target === null || SAFE_POSITIONS.includes(target)) return false;
    return getActiveColors(gameState).some(op =>
      op !== color && Object.values(gameState.players?.[op]?.tokens || {}).some(ot =>
        !ot.isBase && Number(ot.position) < TRACK_LENGTH &&
        getAbsoluteTrackPosition(op, Number(ot.position)) === target
      )
    );
  });
  if (capture) return capture;

  const home = legal.find(id => {
    const t=tokens[id];
    return (t.isBase ? 0 : Number(t.position)+dice) === FINISH_POSITION;
  });
  if (home) return home;

  const open = legal.find(id => tokens[id]?.isBase);
  if (open) return open;

  return legal.sort((a,b) => Number(tokens[b]?.position||0)-Number(tokens[a]?.position||0))[0];
}

function nextLocalTurn(d=0,c=false,h=false) {
  const extra=d===6||c||h;
  gameState.currentTurn=extra?gameState.currentTurn:getNextPlayerTurn(gameState.currentTurn,gameState);
  gameState.diceValue=null;
  gameState.diceRolled=false;
  gameState.consecutiveSixes=extra&&d===6?Number(gameState.consecutiveSixes||0):0;
  gameState.turnStartedAt=now();
  gameState.updatedAt=now();
  renderGameUI();
  scheduleComputerTurn();
}

function rollPassPlayDice(fromComputer=false) {
  if (!passPlayMode || !gameState || gameState.status!=='PLAYING' || gameState.diceRolled) return;
  if (computerMode && isComputerTurn() && !fromComputer) return;

  const color=gameState.currentTurn;
  const value=Math.floor(Math.random()*6)+1;
  const s=Number(gameState.consecutiveSixes||0)+(value===6?1:0);

  if(value===6 && s>=3){
    gameState.diceValue=null;
    gameState.diceRolled=false;
    gameState.consecutiveSixes=0;
    gameState.currentTurn=getNextPlayerTurn(color,gameState);
    renderGameUI();
    showToast('3 consecutive sixes — next player!');
    scheduleComputerTurn(700);
    return;
  }

  gameState.diceValue=value;
  gameState.diceRolled=true;
  gameState.consecutiveSixes=s;
  renderGameUI();

  const legal=getLegalTokenIds(gameState.players[color].tokens,value);
  if(!legal.length){
    setTimeout(()=>{
      if(passPlayMode&&gameState?.currentTurn===color&&gameState.diceRolled){
        nextLocalTurn(value);
        showToast('No legal move — turn passed.');
      }
    },650);
  } else if(legal.length===1){
    setTimeout(()=>movePassPlayToken(legal[0]), isComputerTurn()?500:450);
  } else if(isComputerTurn()){
    setTimeout(()=>{
      if(isComputerTurn() && gameState.diceRolled){
        const pick=chooseComputerToken(color,value);
        if(pick) movePassPlayToken(pick);
      }
    },550);
  } else {
    showToast(COLOR_LABELS[color]+' ki turn — goti choose karein');
  }
}

function movePassPlayToken(id){
  if(!passPlayMode||!gameState||gameState.status!=='PLAYING'||!gameState.diceRolled)return;
  const color=gameState.currentTurn;
  if(computerMode && gameState.players?.[color]?.isComputer===true && !computerMode)return;
  const d=Number(gameState.diceValue);
  const t=gameState.players[color]?.tokens?.[id];
  if(!canMoveToken(t,d))return showToast('Ye goti is dice ke saath move nahi kar sakti.');

  const before=JSON.parse(JSON.stringify(t));
  const np=t.isBase?0:Number(t.position)+d;
  const target=np<TRACK_LENGTH?getAbsoluteTrackPosition(color,np):null;
  const safe=target!==null&&SAFE_POSITIONS.includes(target);
  let cap=false;

  if(target!==null&&!safe) for(const op of getActiveColors(gameState)){
    if(op===color)continue;
    for(const ot of Object.values(gameState.players[op]?.tokens||{}))
      if(!ot.isBase&&Number(ot.position)<TRACK_LENGTH&&getAbsoluteTrackPosition(op,Number(ot.position))===target){
        ot.isBase=true;ot.position=-1;cap=true;
      }
  }

  t.isBase=false;t.position=np;
  const win=Object.values(gameState.players[color].tokens||{}).every(x=>Number(x.position)===FINISH_POSITION);
  if(win){
    gameState.status='FINISHED';
    gameState.winnerColor=color;
    gameState.winnerName=gameState.players[color].name;
    gameState.diceRolled=false;
    gameState.diceValue=null;
    renderGameUI();
    showRoutePath(color,before,t);
    clearComputerTurnTimer();
    return;
  }

  gameState.diceRolled=false;
  gameState.diceValue=null;
  nextLocalTurn(d,cap,np===FINISH_POSITION);
  renderGameUI();
  showRoutePath(color,before,t);
  if(cap)showToast('🎯 Goti cut gayi! Extra turn.');
}


function renderGameUI(previousState = null) { if (!gameState) return;
  if(passPlayMode){$('lobby')?.classList.add('hidden');$('room')?.classList.remove('hidden');$('roomBadge')&&($('roomBadge').textContent='LOCAL • PASS & PLAY');$('bigRoomCode')&&($('bigRoomCode').textContent='PASS');$('roomStatePill')&&($('roomStatePill').textContent=gameState.status==='FINISHED'?'FINISHED':'PASS & PLAY');$('waitingBox')?.classList.add('hidden');$('game')?.classList.remove('hidden');renderPlayersUI();if(gameState.status==='FINISHED'){const wc=gameState.winnerColor||gameState.currentTurn,w=gameState.winnerName||COLOR_LABELS[wc];$('turnText')&&($('turnText').textContent='🏆 '+w+' Wins!');$('status')&&($('status').textContent=w+' is the Ludo Champion! 🎉');$('rollBtn')&&($('rollBtn').disabled=true);renderTokensUI(previousState);if(lastWinnerKey!=='pass:'+wc+':'+w){lastWinnerKey='pass:'+wc+':'+w;showWinnerCelebration(wc);}return;}const rb=$('rollBtn');if(rb){const botTurn=isComputerTurn();rb.disabled=!!gameState.diceRolled||botTurn;rb.classList.toggle('is-my-turn',!gameState.diceRolled&&!botTurn);}$('diceFace')&&($('diceFace').textContent=gameState.diceValue?DICE_ICONS[gameState.diceValue-1]:'🎲');$('turnText')&&($('turnText').textContent=(gameState.players?.[gameState.currentTurn]?.isComputer?'🤖 ':'')+(gameState.players?.[gameState.currentTurn]?.name||COLOR_LABELS[gameState.currentTurn])+' ki Turn');$('status')&&($('status').textContent=gameState.diceRolled?'Goti choose karein.':'Phone next player ko pass karein, phir Dice Roll karein.');$('turnTimer')&&($('turnTimer').textContent='Pass the device');renderTokensUI(previousState);return;}
  $('lobby')?.classList.add('hidden');
  $('room')?.classList.remove('hidden');
  $('roomBadge') && ($('roomBadge').textContent = `ROOM — ${roomId || '—'}`);
  $('bigRoomCode') && ($('bigRoomCode').textContent = roomId || '------');
  $('roomStatePill') && ($('roomStatePill').textContent = gameState.status === 'PLAYING' ? 'PLAYING' : 'WAITING');

  const active = getActiveColors();
  updateVisibleYards();
  const waiting = gameState.status !== 'PLAYING';
  $('waitingBox')?.classList.toggle('hidden', !waiting);
  $('game')?.classList.toggle('hidden', waiting);
  // Host and joiners intentionally share the exact same waiting/game shell.
  // Only the action state differs: the host can start; joiners see the same
  // button in the same place, disabled until the host starts the game.
  const requiredPlayers = Number(gameState.maxPlayers || 4);
  const isHost = gameState.hostColor === myPlayerColor;
  const startReady = waiting && isHost && active.length >= requiredPlayers;
  const startBtn = $('startBtn');
  if (startBtn) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = !startReady;
    startBtn.classList.toggle('startBtn-ready', startReady);
    startBtn.textContent = isHost ? '🎲 Start Game' : '⏳ Waiting for Host';
    startBtn.setAttribute('aria-label', isHost ? 'Start Game' : 'Waiting for host');
  }
  if ($('startHint')) {
    $('startHint').textContent = waiting
      ? (isHost
          ? (active.length >= requiredPlayers
              ? 'All players joined. Start Game now.'
              : `${active.length}/${requiredPlayers} players joined. Waiting for players…`)
          : 'You joined this room. Waiting for the host to start the game.')
      : '';
  }

  renderPlayersUI();
  if (waiting) return;

  if (gameState.status === 'FINISHED') {
    const winnerColor = gameState.winnerColor || gameState.currentTurn;
    const winner = gameState.winnerName || gameState.players?.[winnerColor]?.name || COLOR_LABELS[winnerColor] || 'Player';
    $('turnText') && ($('turnText').textContent = `🏆 ${winner} Wins!`);
    $('turnTimer') && ($('turnTimer').textContent = 'Game finished');
    $('status') && ($('status').textContent = `${winner} is the Ludo Champion! 🎉`);
    $('rollBtn') && ($('rollBtn').disabled = true);
    renderTokensUI(previousState);
    clearInterval(turnTimerHandle);
    const winnerKey = `${roomId}:${winnerColor}:${winner}`;
    if (lastWinnerKey !== winnerKey) {
      lastWinnerKey = winnerKey;
      showWinnerCelebration(winnerColor);
    }
    return;
  }

  const isMyTurn = gameState.currentTurn === myPlayerColor;
  const canRoll = isMyTurn && !gameState.diceRolled;
  const rollBtn = $('rollBtn');
  if (rollBtn) {
    rollBtn.disabled = !canRoll;
    rollBtn.classList.toggle('is-my-turn', canRoll);
    rollBtn.style.opacity = canRoll ? '1' : '.55';
  }
  $('diceFace') && ($('diceFace').textContent = gameState.diceValue ? DICE_ICONS[Number(gameState.diceValue)-1] : '🎲');
  $('turnText') && ($('turnText').textContent = isMyTurn ? 'Aapki Turn Hai!' : `${escapeHtml(gameState.players?.[gameState.currentTurn]?.name || COLOR_LABELS[gameState.currentTurn] || 'Player')} ki Turn...`);
  $('status') && ($('status').textContent = isMyTurn
    ? (gameState.diceRolled ? `Dice: ${gameState.diceValue}. Apna token choose karein.` : 'Aapki turn hai! Dice roll karein.')
    : 'Opponent ki turn chal rahi hai…');

  renderTokensUI(previousState);
  updateTurnTimer();
}

function updateTurnTimer() {
  clearInterval(turnTimerHandle);
  const el = $('turnTimer');
  if (!el || !gameState?.turnStartedAt || gameState.status !== 'PLAYING') {
    if (el) el.textContent = '';
    return;
  }
  const tick = () => {
    const left = Math.max(0, TURN_SECONDS - Math.floor((now() - Number(gameState.turnStartedAt)) / 1000));
    el.textContent = `${left}s remaining`;
    if (left === 0) {
      clearInterval(turnTimerHandle);
      if (gameState.currentTurn === myPlayerColor) autoPassTurn();
    }
  };
  tick();
  turnTimerHandle = setInterval(tick, 1000);
}

async function initFirebase() {
  try {
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK load nahi hua. Internet/CDN connection check karein.');
    if (typeof firebaseConfig === 'undefined') throw new Error('firebase-config.js load nahi hua.');

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();

    const connectedRef = db.ref('.info/connected');
    let connected = false;
    const connectionTimeout = setTimeout(() => {
      if (connected) return;
      $('connectionText') && ($('connectionText').textContent = 'Offline');
      $('authText') && ($('authText').textContent = 'Error');
      $('connectionDot')?.classList.add('offline');
      $('createSubmit') && ($('createSubmit').disabled = true);
      $('joinSubmit') && ($('joinSubmit').disabled = true);
      showError('Firebase connect nahi ho raha. Realtime Database URL, Database creation aur Firebase Rules check karein. Agar Firebase Console mein database kisi aur region mein hai to firebase-config.js ka databaseURL wahi exact URL hona chahiye.');
    }, 7000);

    connectedRef.on('value', snap => {
      connected = snap.val() === true;
      $('connectionText') && ($('connectionText').textContent = connected ? 'Online' : 'Connecting…');
      $('authText') && ($('authText').textContent = connected ? 'Guest Mode' : 'Connecting');
      $('connectionDot')?.classList.toggle('offline', !connected);
      document.body.classList.toggle('firebase-connected', connected);
      $('createSubmit') && ($('createSubmit').disabled = !connected);
      $('joinSubmit') && ($('joinSubmit').disabled = !connected);
      if (connected) { clearTimeout(connectionTimeout); clearError(); }
    });
  } catch (err) {
    console.error(err);
    $('connectionText') && ($('connectionText').textContent = 'Offline');
    $('authText') && ($('authText').textContent = 'Error');
    $('createSubmit') && ($('createSubmit').disabled = true);
    $('joinSubmit') && ($('joinSubmit').disabled = true);
    showError(`Firebase setup error: ${err.message}`);
  }
}
function allocateColor(players, maxPlayers = 4) {
  const order = COLOR_ORDERS[Math.min(4, Math.max(2, Number(maxPlayers) || 4))] || COLOR_ORDERS[4];
  return order.find(color => !players?.[color]) || null;
}

async function reconcileRoomState(snapshotState) {
  if (!db || !roomId || !snapshotState?.players) return;
  const active = getActiveColors(snapshotState);
  if (!active.length) return;

  const needsHost = !snapshotState.hostColor || !snapshotState.players[snapshotState.hostColor];
  const needsTurn = snapshotState.status === 'PLAYING' && (!snapshotState.currentTurn || !snapshotState.players[snapshotState.currentTurn]);
  if (!needsHost && !needsTurn) return;

  try {
    await db.ref(`rooms/${roomId}`).transaction(current => {
      if (!current?.players) return current;
      const colors = PLAYER_COLORS.filter(c => !!current.players[c]);
      if (!colors.length) return current;
      if (!current.hostColor || !current.players[current.hostColor]) current.hostColor = colors[0];
      if (current.status === 'PLAYING' && (!current.currentTurn || !current.players[current.currentTurn])) {
        current.currentTurn = current.hostColor || colors[0];
        current.diceRolled = false;
        current.diceValue = null;
        current.consecutiveSixes = 0;
        current.turnStartedAt = now();
      }
      current.updatedAt = now();
      return current;
    });
  } catch (err) {
    console.warn('Room reconciliation failed:', err);
  }
}

function attachRoomListener() {
  if (!db || !roomId) return;
  if (roomValueRef && roomRefListener) roomValueRef.off('value', roomRefListener);
  roomValueRef = db.ref(`rooms/${roomId}`);
  captureEventInitialized = false;
  lastCaptureEventId = null;
  previousGameState = null;
  lastWinnerKey = null;
  roomRefListener = snapshot => {
    const previousState = gameState;
    gameState = snapshot.val();
    if (!gameState) {
      cleanupLocal(false);
      showToast('Room closed.');
      return;
    }

    const captureEvent = gameState.captureEvent;
    if (!captureEventInitialized) {
      lastCaptureEventId = captureEvent?.id || null;
      captureEventInitialized = true;
    } else if (captureEvent?.id && captureEvent.id !== lastCaptureEventId) {
      lastCaptureEventId = captureEvent.id;
      showCaptureFlash(captureEvent);
    }

    renderGameUI(previousState);
    reconcileRoomState(gameState);
  };
  roomValueRef.on('value', roomRefListener);
}

async function initGameRoom(targetRoomId, requestedColor, name, maxPlayers) {
  clearError();
  if (!db) return showError('Firebase connection ready nahi hai. Page refresh karke try karein.');
  if (!targetRoomId) return showError('Room code missing hai.');

  const cleanRoom = String(targetRoomId).trim().toUpperCase().slice(0, 6);
  const roomRef = db.ref(`rooms/${cleanRoom}`);
  const playerName = normalizeName(name);

  try {
    let assignedColor = requestedColor || null;
    const result = await roomRef.transaction(current => {
      if (!current) return createDefaultRoomState(assignedColor || 'red', playerName, maxPlayers);
      if (current.status === 'PLAYING') return; // abort: game already started
      current.players = current.players || {};
      if (Object.keys(current.players).length >= Number(current.maxPlayers || 4)) return;
      assignedColor = allocateColor(current.players, current.maxPlayers);
      if (!assignedColor) return;
      current.players[assignedColor] = createPlayerTokens(assignedColor, playerName);
      current.updatedAt = now();
      return current;
    });

    if (!result.committed) {
      throw new Error('Room full hai ya game already start ho chuka hai.');
    }

    roomId = cleanRoom;
    myPlayerColor = assignedColor || requestedColor || 'red';
    // IMPORTANT: do not use Firebase onDisconnect().remove() here.
    // A phone screen lock/background can temporarily disconnect Firebase;
    // the player must stay in the party until they explicitly press Leave.
    attachRoomListener();
    showToast(`Room joined as ${COLOR_LABELS[myPlayerColor]}`);
  } catch (err) {
    console.error(err);
    roomId = null; myPlayerColor = null;
    showError(err.message || 'Room join failed.');
  }
}

async function startGame() {
  if (!db || !roomId || !gameState || gameState.hostColor !== myPlayerColor) return;
  const count = getActiveColors().length;
  const required = Number(gameState.maxPlayers || 2);
  if (count < required) return showToast(`Start Game ke liye ${required} players join karna zaroori hai.`);
  const updates = {
    [`rooms/${roomId}/status`]: 'PLAYING',
    [`rooms/${roomId}/currentTurn`]: gameState.hostColor,
    [`rooms/${roomId}/diceValue`]: null,
    [`rooms/${roomId}/diceRolled`]: false,
    [`rooms/${roomId}/consecutiveSixes`]: 0,
    [`rooms/${roomId}/turnStartedAt`]: now(),
    [`rooms/${roomId}/updatedAt`]: now()
  };
  await db.ref().update(updates);
  showToast(`Game started${count < required ? ` (${count} players)` : ''}!`);
}

function rollDice() { if(passPlayMode)return rollPassPlayDice(false); if (!gameState || !db || gameState.status !== 'PLAYING') return;
  if (gameState.currentTurn !== myPlayerColor) return showToast('Aapka turn nahi hai.');
  if (gameState.diceRolled) return showToast('Pehle current dice ka token move karein.');

  const value = Math.floor(Math.random() * 6) + 1;
  const sixes = Number(gameState.consecutiveSixes || 0) + (value === 6 ? 1 : 0);
  if (value === 6 && sixes >= 3) {
    const next = getNextPlayerTurn(myPlayerColor);
    showToast('3 consecutive sixes — turn next player ko mil gayi.');
    return db.ref(`rooms/${roomId}`).update({ diceValue:null, diceRolled:false, consecutiveSixes:0, currentTurn:next, turnStartedAt:now(), updatedAt:now() });
  }

  const tokens = gameState.players?.[myPlayerColor]?.tokens;
  if (!tokens) return;
  const legalTokenIds = getLegalTokenIds(tokens, value);

  if (!legalTokenIds.length) {
    const next = value === 6 ? myPlayerColor : getNextPlayerTurn(myPlayerColor);
    return db.ref(`rooms/${roomId}`).update({
      diceValue:value, diceRolled:false,
      consecutiveSixes:value === 6 ? sixes : 0,
      currentTurn:next, turnStartedAt:now(), updatedAt:now()
    });
  }

  // If there is exactly one legal token, Ludo should move it automatically.
  // We briefly publish the dice result so the player can see what was rolled,
  // then resolve the move from the same game snapshot.
  if (legalTokenIds.length === 1) {
    const tokenId = legalTokenIds[0];
    return db.ref(`rooms/${roomId}`).update({
      diceValue:value, diceRolled:true, consecutiveSixes:sixes, updatedAt:now()
    }).then(() => new Promise(resolve => setTimeout(resolve, 350)))
      .then(() => moveTokenAndResolve(tokenId, value, true));
  }

  return db.ref(`rooms/${roomId}`).update({ diceValue:value, diceRolled:true, consecutiveSixes:sixes, updatedAt:now() });
}

async function handleTokenClick(tokenId) { if(passPlayMode)return movePassPlayToken(tokenId); if (!gameState || !db || gameState.status !== 'PLAYING') return;
  if (gameState.currentTurn !== myPlayerColor || !gameState.diceRolled) return;
  const dice = Number(gameState.diceValue);
  const token = gameState.players?.[myPlayerColor]?.tokens?.[tokenId];
  if (!canMoveToken(token, dice)) return showToast('Ye token is dice ke saath move nahi kar sakta.');
  await moveTokenAndResolve(tokenId, dice, false);
}

async function moveTokenAndResolve(tokenId, dice, automatic = false) {
  if (!gameState || !db || gameState.status !== 'PLAYING') return;
  if (gameState.currentTurn !== myPlayerColor || !gameState.diceRolled) return;

  const myPlayer = gameState.players?.[myPlayerColor];
  const token = myPlayer?.tokens?.[tokenId];
  if (!canMoveToken(token, dice)) return;

  const newPosition = token.isBase ? 0 : Number(token.position) + dice;
  // Base exit is always the player's own coloured start square.
  // The visual board and logical track both use START_POSITIONS for this.
  if (token.isBase && dice === 6) {
    const startCoord = getStartCoord(myPlayerColor);
    if (!startCoord) return;
  }
  const reachedHome = newPosition === FINISH_POSITION;
  const target = newPosition < TRACK_LENGTH ? getAbsoluteTrackPosition(myPlayerColor, newPosition) : null;
  const safe = target !== null && SAFE_POSITIONS.includes(target);
  const updates = {};
  let captured = false;

  // Resolve capture in the same Firebase update as the moving token.
  // This prevents the old two-request flow from making a token appear to
  // move twice or briefly show an incorrect board state.
  if (target !== null && !safe) {
    for (const color of getActiveColors()) {
      if (color === myPlayerColor) continue;
      for (const [opponentTokenId, opponentToken] of Object.entries(gameState.players[color]?.tokens || {})) {
        if (!opponentToken.isBase && Number(opponentToken.position) < TRACK_LENGTH && getAbsoluteTrackPosition(color, Number(opponentToken.position)) === target) {
          updates[`rooms/${roomId}/players/${color}/tokens/${opponentTokenId}/isBase`] = true;
          updates[`rooms/${roomId}/players/${color}/tokens/${opponentTokenId}/position`] = -1;
          captured = true;
        }
      }
    }
  }

  const allHome = Object.entries(myPlayer.tokens || {}).every(([id, t]) =>
    id === tokenId ? newPosition === FINISH_POSITION : Number(t.position) === FINISH_POSITION
  );
  const extraTurn = dice === 6 || captured || reachedHome;
  const next = extraTurn ? myPlayerColor : getNextPlayerTurn(myPlayerColor);

  updates[`rooms/${roomId}/players/${myPlayerColor}/tokens/${tokenId}/isBase`] = false;
  updates[`rooms/${roomId}/players/${myPlayerColor}/tokens/${tokenId}/position`] = newPosition;
  updates[`rooms/${roomId}/diceRolled`] = false;
  updates[`rooms/${roomId}/diceValue`] = null;
  updates[`rooms/${roomId}/consecutiveSixes`] = extraTurn && dice === 6 ? Number(gameState.consecutiveSixes || 0) : 0;
  if (captured) {
    updates[`rooms/${roomId}/captureEvent`] = {
      id: `${now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: 'AA GAYA SWAD',
      by: myPlayerColor,
      at: now()
    };
  }
  updates[`rooms/${roomId}/currentTurn`] = allHome ? myPlayerColor : next;
  updates[`rooms/${roomId}/turnStartedAt`] = now();
  updates[`rooms/${roomId}/updatedAt`] = now();
  if (allHome) {
    updates[`rooms/${roomId}/status`] = 'FINISHED';
    updates[`rooms/${roomId}/winnerColor`] = myPlayerColor;
    updates[`rooms/${roomId}/winnerName`] = myPlayer.name || COLOR_LABELS[myPlayerColor];
  }

  await db.ref().update(updates);
  if (automatic) showToast(`Token ${tokenId.slice(1)} automatically move hua.`);
  if (captured) showToast('🎯 Opponent token cut gaya! Extra turn.');
  if (allHome) showToast('🏆 Aapne saari gotiyan home pahucha di!');
}

async function autoPassTurn() {
  if (!gameState || gameState.status !== 'PLAYING' || gameState.currentTurn !== myPlayerColor) return;
  const next = getNextPlayerTurn(myPlayerColor);
  await db.ref(`rooms/${roomId}`).update({ currentTurn:next, diceValue:null, diceRolled:false, consecutiveSixes:0, turnStartedAt:now(), updatedAt:now() });
}

async function copyRoomCode() {
  if (!roomId) return;
  try { await navigator.clipboard.writeText(roomId); showToast('Room code copied!'); }
  catch { showToast(`Code: ${roomId}`); }
}
async function shareRoom() {
  if (!roomId) return;
  const shareData = { title:'Ludo India', text:`Ludo India room code: ${roomId}`, url:`${location.origin}${location.pathname}?room=${roomId}` };
  try {
    if (navigator.share) await navigator.share(shareData);
    else await navigator.clipboard.writeText(shareData.url), showToast('Invite link copied!');
  } catch (err) { if (err?.name !== 'AbortError') showToast(`Room code: ${roomId}`); }
}

async function leaveGameRoom(redirect = true) {
  if (leaving) return;
  leaving = true;
  try {
    if (db && roomId && myPlayerColor) {
      const oldRoom = roomId;
      const playerRef = db.ref(`rooms/${oldRoom}/players/${myPlayerColor}`);
      await playerRef.remove();
      const snap = await db.ref(`rooms/${oldRoom}/players`).once('value');
      if (!snap.exists() || snap.numChildren() === 0) await db.ref(`rooms/${oldRoom}`).remove();
      if (roomValueRef && roomRefListener) roomValueRef.off('value', roomRefListener);
    }
  } catch (err) { console.warn('Leave cleanup:', err); }
  cleanupLocal(redirect);
  leaving = false;
}
function cleanupLocal(redirect) {
  clearInterval(turnTimerHandle);
  clearComputerTurnTimer();
  passPlayMode=false;
  computerMode=false;
  roomId = null; myPlayerColor = null; gameState = null; previousGameState = null; roomValueRef = null; roomRefListener = null; lastWinnerKey = null;
  if (!redirect) return;
  $('lobby')?.classList.remove('hidden');
  $('room')?.classList.add('hidden');
  $('game')?.classList.add('hidden');
  $('waitingBox')?.classList.add('hidden');
  window.history.replaceState({}, document.title, window.location.pathname);
}

function bindUI(){
  ensureGuestName();
  $('playGuestBtn')?.addEventListener('click',()=>{setGuestMode();if($('createSubmit')&&!$('createSubmit').disabled)$('createForm')?.requestSubmit();});
  $('passPlayBtn')?.addEventListener('click',enterPassPlay);
  $('createForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const name = normalizeName($('createName')?.value);
    const count = Number($('playerCount')?.value || 4);
    const room = Math.random().toString(36).slice(2, 8).toUpperCase();
    await initGameRoom(room, 'red', name, count);
  });
  $('joinForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const code = $('roomCodeInput')?.value.trim().toUpperCase();
    const name = normalizeName($('joinName')?.value);
    if (!/^[A-Z0-9]{6}$/.test(code)) return showError('6-character room code enter karein.');
    await initGameRoom(code, null, name, 4);
  });
  $('roomCodeInput')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); });
  $('rollBtn')?.addEventListener('click', rollDice);
  $('startBtn')?.addEventListener('click', startGame);
  $('leaveBtn')?.addEventListener('click', () => leaveGameRoom(true));
  $('copyCodeBtn')?.addEventListener('click', copyRoomCode);
  $('shareRoomBtn')?.addEventListener('click', shareRoom);
}

document.addEventListener('DOMContentLoaded', async () => {
  generateBoardUI();
  ensureGuestName();
  bindUI();
  await initFirebase();

  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) {
    ensureGuestName();
    $('roomCodeInput') && ($('roomCodeInput').value = urlRoom.toUpperCase().slice(0,6));
    $('joinName')?.focus();
  }
});

// Screen-lock/background safe behavior: changing visibility never removes the player.
// Firebase may temporarily show .info/connected=false, but the room membership remains.
document.addEventListener('visibilitychange', () => {
  if (!db || !roomId || !myPlayerColor) return;
  if (!document.hidden) {
    db.ref(`rooms/${roomId}/players/${myPlayerColor}/lastSeenAt`).set(now()).catch(() => {});
  }
});
