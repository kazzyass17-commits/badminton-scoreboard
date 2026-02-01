// Phase0 practice scoreboard with future tournament data model retained (non-UI)
const STORAGE_KEY = "badminton-scoreboard/v1";
const BOARD_RELOAD_KEY = "badminton-scoreboard/board-reload";
const statusEl = () => document.getElementById("storageStatus");

const $ = (id) => document.getElementById(id);
const controls = {
  targetPoints: document.querySelectorAll('input[name="targetPoints"]'),
  allowDeuce: document.querySelectorAll('input[name="allowDeuce"]'),
  initialServe: document.querySelectorAll('input[name="initialServe"]'),
  serveSide: document.querySelectorAll('input[name="serveSide"]'),
  voiceGender: document.querySelectorAll('input[name="voiceGender"]'),
  nameA1: $("nameA1"),
  nameA2: $("nameA2"),
  nameB1: $("nameB1"),
  nameB2: $("nameB2"),
  scoreA: $("scoreA"),
  scoreB: $("scoreB"),
  setNumber: $("setNumber"),
  historyList: $("historyList"),
  historyListSheet: $("historyListSheet"),
  buttons: document.querySelectorAll("button[data-side]"),
  undo: $("btnUndo"),
  undo2: $("btnUndo2"),
  hardReset: $("btnHardReset"),
  clearHistory: $("clearHistoryBtn"),
  historyPeek: $("btnHistoryPeek"),
  collapseLeft: $("btnCollapseLeft"),
  expandLeft: $("btnExpandLeft"),
  voiceEnabled: $("voiceEnabledToggle"),
  voiceTest: $("voiceTestBtn"),
  dbNameInput: $("dbNameInput"),
  dbAddBtn: $("dbAddBtn"),
  playerDbList: $("playerDbList"),
  dbReset: $("btnDbReset"),
  shareSheet: document.getElementById("btnShareSheet"),
  sheetToCurrent: $("btnSheetToCurrent"),
};

const defaultDisplayOrder = () => ({
  A: ["p2", "p1"], // 上: A2, 下: A1
  B: ["p1", "p2"], // 上: B1, 下: B2
});

const defaultState = () => ({
  settings: {
    targetPoints: 21,
    allowDeuce: true,
    voiceEnabled: false,
    voiceGender: "female",
  },
  players: {
    A: { p1: "選手A1", p2: "選手A2" },
    B: { p1: "選手B1", p2: "選手B2" },
  },
  scores: { A: 0, B: 0, setNo: 1 },
  pointLog: [], // [{ side, serving, positions, scores }]
  rallies: [], // 現行セットのラリー記録
  history: [],
  serving: { side: "A", member: "1" },
  initialServeSide: "A", // ラジオ選択保持（0-0時のみ効く）
  initialServeApplied: false, // 0-0から動いたかどうか
  positions: {
    A: { right: "1", left: "2" }, // サーブサイドのローテーション用
    B: { right: "1", left: "2" },
  },
  lastServer: { A: "1", B: "1" },
  displayOrder: defaultDisplayOrder(),
  playerDB: [],
  viewMode: "board",
  sheetSetIndex: null,
  leftCollapsed: false,
  historyPeek: false,
  playerDbOpen: false,
  // Future tournament entities kept in state (UI非表示)
  tournament: null, // { tournament_id, name, start_date, end_date, court_count, status }
  entries: [], // Entry[]
  matches: [], // Match[]
  approvals: [], // Approval[]
});

class LocalDataStore {
  constructor(key) {
    this.key = key;
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Failed to parse saved state", e);
      return null;
    }
  }

  save(state) {
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
      setStatus("保存済み");
    } catch (e) {
      console.warn("Failed to save state", e);
      setStatus("保存失敗");
    }
  }

  clear() {
    localStorage.removeItem(this.key);
  }
}

const store = new LocalDataStore(STORAGE_KEY);
let state = migrate(store.load() ?? defaultState());
let lastAutoFinishSnapshot = null;
let scrollLimit = null;
let forceBoardTimer = null;

const getScrollLimit = () => {
  const layout = document.querySelector(".layout");
  if (!layout) return 0;
  const cards = Array.from(layout.querySelectorAll(".card")).filter(
    (el) => !el.classList.contains("hidden")
  );
  const layoutBottom = layout.getBoundingClientRect().bottom + window.scrollY;
  if (!cards.length) {
    return Math.max(0, layoutBottom - window.innerHeight);
  }
  const maxBottom = Math.max(
    ...cards.map((el) => el.getBoundingClientRect().bottom + window.scrollY)
  );
  return Math.max(0, maxBottom - window.innerHeight);
};

const clampScrollToContent = () => {
  if (scrollLimit === null) return;
  if (window.scrollY > scrollLimit + 1) {
    window.scrollTo(0, scrollLimit);
  }
};

const updateScrollLimit = () => {
  requestAnimationFrame(() => {
    scrollLimit = getScrollLimit();
    clampScrollToContent();
  });
};

const forceBoardView = () => {
  if (state.viewMode !== "board") return;
  const board = document.querySelectorAll(".view-board");
  const sheet = document.querySelectorAll(".view-sheet");
  board.forEach((el) => {
    el.classList.remove("hidden");
    el.style.display = "";
  });
  sheet.forEach((el) => {
    el.classList.add("hidden");
    el.style.display = "none";
  });
  document.body.classList.remove("view-sheet");
  updateLayoutVisibility();
  updateScrollLimit();
  if (forceBoardTimer) {
    clearTimeout(forceBoardTimer);
  }
  const retry = () => {
    if (state.viewMode !== "board") return;
    const card = document.querySelector(".scoreboard-card.view-board");
    if (!card || card.offsetParent === null || card.getClientRects().length === 0) {
      board.forEach((el) => {
        el.classList.remove("hidden");
        el.style.display = "";
      });
      sheet.forEach((el) => {
        el.classList.add("hidden");
        el.style.display = "none";
      });
      document.body.classList.remove("view-sheet");
      updateLayoutVisibility();
      updateScrollLimit();
    }
    if (card && card.offsetParent !== null && card.getClientRects().length > 0) {
      return;
    }
    const reloaded = sessionStorage.getItem(BOARD_RELOAD_KEY);
    if (!reloaded) {
      sessionStorage.setItem(BOARD_RELOAD_KEY, "1");
      location.reload();
    }
  };
  forceBoardTimer = setTimeout(retry, 0);
  setTimeout(retry, 120);
  setTimeout(retry, 300);
};

function migrate(data) {
  const next = { ...defaultState(), ...data };
  // migrate players from single name to p1/p2
  if (data?.players) {
    next.players = {
      A: {
        p1: data.players.A?.p1 ?? data.players.A?.name ?? "選手A1",
        p2: data.players.A?.p2 ?? "選手A2",
      },
      B: {
        p1: data.players.B?.p1 ?? data.players.B?.name ?? "選手B1",
        p2: data.players.B?.p2 ?? "選手B2",
      },
    };
  }
  if (!data?.serving) {
    next.serving = { side: "A", member: "1" };
  }
  if (!data?.positions) {
    next.positions = { A: { right: "1", left: "2" }, B: { right: "1", left: "2" } };
  }
  if (!data?.lastServer) {
    next.lastServer = { A: "1", B: "1" };
  }
  // displayOrderは新デフォルトに揃える（A:上p2/下p1, B:上p1/下p2）
  next.displayOrder = defaultDisplayOrder();
  if (!data?.initialServeSide) {
    next.initialServeSide = "A";
  }
  if (data?.initialServeApplied === undefined) {
    next.initialServeApplied = false;
  }
  if (!Array.isArray(data?.playerDB)) {
    next.playerDB = [];
  }
  if (!data?.viewMode) {
    next.viewMode = "board";
  }
  if (data?.settings?.voiceEnabled === undefined) {
    next.settings.voiceEnabled = false;
  }
  if (!data?.settings?.voiceGender) {
    next.settings.voiceGender = "female";
  }
  if (!Array.isArray(data?.rallies)) {
    next.rallies = [];
  }
  if (data?.sheetSetIndex === undefined) {
    next.sheetSetIndex = null;
  }
  if (data?.leftCollapsed === undefined) {
    next.leftCollapsed = false;
  }
  if (data?.historyPeek === undefined) {
    next.historyPeek = false;
  }
  if (data?.playerDbOpen === undefined) {
    next.playerDbOpen = false;
  }
  // pointLog旧形式（文字列）を無視
  if (Array.isArray(data?.pointLog) && data.pointLog.length && typeof data.pointLog[0] === "string") {
    next.pointLog = [];
  }
  return next;
}

function setStatus(text) {
  const el = statusEl();
  if (!el) return;
  el.textContent = text;
}

function saveState() {
  store.save(state);
}

function syncUI() {
  const getDisplayOrderForUI = () => {
    if (state.scores.A === 0 && state.scores.B === 0 && state.history.length === 0) {
      return defaultDisplayOrder();
    }
    return state.displayOrder;
  };
  const uiOrder = getDisplayOrderForUI();
  controls.targetPoints.forEach((r) => {
    r.checked = Number(r.value) === state.settings.targetPoints;
  });
  controls.allowDeuce.forEach((r) => {
    r.checked = (r.value === "true") === state.settings.allowDeuce;
  });
  controls.serveSide?.forEach((r) => {
    r.checked = r.value === state.initialServeSide;
  });

  const setInputs = (side, inputs) => {
    const order = uiOrder[side];
    inputs.top.value = state.players[side][order[0]];
    inputs.bottom.value = state.players[side][order[1]];
  };
  setInputs("A", { top: controls.nameA1, bottom: controls.nameA2 });
  setInputs("B", { top: controls.nameB1, bottom: controls.nameB2 });
  controls.scoreA.textContent = state.scores.A;
  controls.scoreB.textContent = state.scores.B;
  controls.setNumber.textContent = state.scores.setNo;
  syncServeSelector();
  updateServeUI();
  renderHistory();
  renderPlayerDB();
  updateServeRadioState();
  updateAssignOverlay();
  if (controls.voiceEnabled) {
    controls.voiceEnabled.checked = !!state.settings.voiceEnabled;
  }
  controls.voiceGender?.forEach((r) => {
    r.checked = r.value === state.settings.voiceGender;
  });
  syncView();
  updateScrollLimit();
}

function canChangeInitialServe() {
  const noPoints = state.scores.A === 0 && state.scores.B === 0 && state.pointLog.length === 0;
  if (!noPoints) return false;
  if (state.scores.setNo === 1) return true;
  const last = state.history[state.history.length - 1];
  if (!last) return true;
  const winnerSide = last.scoreA > last.scoreB ? "A" : "B";
  return { A: true, B: true }[winnerSide];
}

function syncServeSelector() {
  const allowChange = canChangeInitialServe();
  const desired = `${state.serving.side}-${state.serving.member}`;
  controls.initialServe.forEach((r) => {
    const [side] = r.value.split("-");
    const last = state.history[state.history.length - 1];
    const winnerSide = last ? (last.scoreA > last.scoreB ? "A" : "B") : null;
    const allowedSide = state.scores.setNo === 1 ? true : winnerSide === side;
    r.disabled = !allowChange || !allowedSide;
    r.checked = r.value === desired;
  });
}

function setInitialServeFromUI(value) {
  const [side, member] = value.split("-");
  state.serving = { side, member };
  state.lastServer[side] = member;
  state.positions = { A: { right: "1", left: "2" }, B: { right: "1", left: "2" } };
  state.initialServeSide = side;
  state.initialServeApplied = false;
  updateServeUI();
  saveState();
}

function setServeSide(side) {
  state.initialServeSide = side;
  if (state.scores.A === 0 && state.scores.B === 0) {
    state.serving = { side, member: "1" };
    state.lastServer[side] = "1";
    state.positions = { A: { right: "1", left: "2" }, B: { right: "1", left: "2" } };
    state.initialServeApplied = false;
    updateServeUI();
  }
  saveState();
}

function renderHistoryList(list, { clickable = false, selectedIndex = null, onSelect } = {}) {
  if (!list) return;
  if (state.history.length === 0) {
    list.classList.add("empty");
    list.textContent = "まだセットがありません";
    return;
  }
  list.classList.remove("empty");
  list.textContent = "";

  const items = state.history.slice().reverse();
  items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const actualIndex = state.history.length - 1 - idx;
    if (clickable) {
      row.classList.add("clickable");
      row.dataset.index = String(actualIndex);
      if (selectedIndex === actualIndex) row.classList.add("active");
      row.addEventListener("click", () => onSelect?.(actualIndex));
    }
    const left = document.createElement("div");
    left.className = "left";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `セット ${item.setNo}: ${item.scoreA} - ${item.scoreB}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    const serveSide = item.serveSide ?? "A";
    const serverTxt = ` / サーブ: ${serveSide}1`;
    meta.textContent = `ポイント${item.target} / セッティング${item.allowDeuce ? "有" : "無"}${serverTxt}`;
    const names = document.createElement("div");
    names.className = "meta";
    names.textContent = `A: ${item.names.A.join(" / ")} ｜ B: ${item.names.B.join(" / ")}`;
    left.appendChild(title);
    left.appendChild(meta);
    left.appendChild(names);

    const right = document.createElement("div");
    right.className = "meta";
    const d = new Date(item.endedAt);
    const dateStr = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
    const timeStr = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    right.textContent = `${dateStr} ${timeStr}`;

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });
}

function renderHistory() {
  renderHistoryList(controls.historyList);
  renderHistoryList(controls.historyListSheet, {
    clickable: true,
    selectedIndex: state.sheetSetIndex,
    onSelect: (index) => {
      state.sheetSetIndex = index;
      syncView();
      saveState();
    },
  });
}

function renderPlayerDB() {
  const list = controls.playerDbList;
  if (!list) return;
  if (!state.playerDB.length) {
    list.classList.add("empty");
    list.textContent = "まだ登録がありません";
    return;
  }
  list.classList.remove("empty");
  list.textContent = "";
  state.playerDB.forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.setAttribute("draggable", "true");
    row.dataset.name = p.name;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", p.name);
      dragState.active = true;
      dragState.name = p.name;
      dragState.sourceSlot = null;
      document.body.classList.add("drag-active");
      setDragTargetsActive(true);
      updateAssignOverlay();
    });
    row.addEventListener("dragend", () => {
      dragState.active = false;
      dragState.name = null;
      dragState.sourceSlot = null;
      setDragTargetsActive(false);
      document.body.classList.remove("drag-active");
    });
    row.addEventListener("touchstart", (e) => {
      if (e.target.closest(".player-actions")) return;
      scheduleTouchDrag(p.name, null);
    }, { passive: true });
    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = p.name;
    const actions = document.createElement("div");
    actions.className = "player-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn micro";
    editBtn.setAttribute("draggable", "false");
    editBtn.textContent = "編集";
    editBtn.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      cancelTouchDrag();
    }, { passive: true });
    editBtn.addEventListener("touchend", (e) => {
      e.stopPropagation();
      editPlayerName(p.name);
    }, { passive: true });
    editBtn.addEventListener("click", () => editPlayerName(p.name));
    const delBtn = document.createElement("button");
    delBtn.className = "btn micro danger";
    delBtn.setAttribute("draggable", "false");
    delBtn.textContent = "削除";
    delBtn.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      cancelTouchDrag();
    }, { passive: true });
    delBtn.addEventListener("touchend", (e) => {
      e.stopPropagation();
      deletePlayer(p.name);
    }, { passive: true });
    delBtn.addEventListener("click", () => deletePlayer(p.name));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(name);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function assignPlayerToSlot(name, slot) {
  const side = slot.startsWith("A") ? "A" : "B";
  const index = slot.endsWith("0") ? 0 : 1;
  const order = state.displayOrder[side];
  const key = order[index];
  const currentName = state.players[side][key];
  if (currentName !== name) {
    let found = null;
    ["A", "B"].forEach((s) => {
      Object.keys(state.players[s]).forEach((k) => {
        if (state.players[s][k] === name) {
          found = { side: s, key: k };
        }
      });
    });
    if (found && !(found.side === side && found.key === key)) {
      state.players[found.side][found.key] = currentName;
    }
    state.players[side][key] = name;
  }
  ensurePlayerInDB(name);
  setStatus("名前更新");
  syncUI();
  saveState();
}

const dragState = {
  name: null,
  sourceSlot: null,
  active: false,
  timer: null,
};

const scoreboardDrag = {
  active: false,
  sourceSlot: null,
  timer: null,
};

const slotFromInputId = (id) => {
  switch (id) {
    case "nameA1":
      return "A0";
    case "nameA2":
      return "A1";
    case "nameB1":
      return "B0";
    case "nameB2":
      return "B1";
    default:
      return null;
  }
};

const slotToKey = (slot) => {
  const side = slot.startsWith("A") ? "A" : "B";
  const index = slot.endsWith("0") ? 0 : 1;
  const order = state.displayOrder[side];
  const key = order[index];
  return { side, key };
};

const getSlotValue = (slot) => {
  const { side, key } = slotToKey(slot);
  return state.players[side][key];
};

const setSlotValue = (slot, value) => {
  const { side, key } = slotToKey(slot);
  state.players[side][key] = value;
};

const swapSlots = (sourceSlot, targetSlot) => {
  if (!sourceSlot || !targetSlot || sourceSlot === targetSlot) return;
  const sourceName = getSlotValue(sourceSlot);
  const targetName = getSlotValue(targetSlot);
  setSlotValue(sourceSlot, targetName);
  setSlotValue(targetSlot, sourceName);
  ensurePlayerInDB(sourceName);
  ensurePlayerInDB(targetName);
  setStatus("名前入れ替え");
  syncUI();
  saveState();
};

const applyDrop = (name, targetSlot, sourceSlot) => {
  if (!targetSlot) return;
  if (sourceSlot) {
    swapSlots(sourceSlot, targetSlot);
    return;
  }
  if (!name) return;
  assignPlayerToSlot(name, targetSlot);
};

const setDragTargetsActive = () => {};

const updateAssignOverlay = () => {
  const slots = document.querySelectorAll(".assign-slot");
  if (!slots.length) return;
  slots.forEach((slotEl) => {
    const slot = slotEl.dataset.assignSlot;
    if (!slot) return;
    const nameEl = slotEl.querySelector("[data-assign-name]");
    if (!nameEl) return;
    nameEl.textContent = getSlotValue(slot) ?? "";
  });
};

let speechUnlocked = false;

const prepareSpeech = () => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
};

const numberToCallout = (value) => {
  const words = [
    "ラブ",
    "ワン",
    "ツー",
    "スリー",
    "フォー",
    "ファイブ",
    "シックス",
    "セブン",
    "エイト",
    "ナイン",
    "テン",
    "イレブン",
    "トゥエルブ",
    "サーティーン",
    "フォーティーン",
    "フィフティーン",
    "シックスティーン",
    "セブンティーン",
    "エイティーン",
    "ナインティーン",
    "トゥエンティ",
  ];
  if (value >= 0 && value < words.length) return words[value];
  if (value >= 21 && value <= 29) {
    return `トゥエンティ ${words[value - 20]}`;
  }
  if (value === 30) return "サーティ";
  return String(value);
};

const pickVoice = (gender) => {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const japanese = voices.filter((v) => v.lang?.toLowerCase().startsWith("ja"));
  if (!japanese.length) return null;
  const lower = (name) => name?.toLowerCase?.() ?? "";
  if (gender === "male") {
    return japanese.find((v) => /male|man|男性|おとこ|otoko/.test(lower(v.name))) ?? japanese[0];
  }
  return japanese.find((v) => /female|woman|女性|おんな|onna/.test(lower(v.name))) ?? japanese[0];
};

const speakCallout = (text) => {
  if (!state.settings.voiceEnabled) return;
  if (!window.speechSynthesis) return;
  if (!speechUnlocked) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  const voice = pickVoice(state.settings.voiceGender);
  if (voice) utter.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  window.speechSynthesis.resume?.();
};

const speakStartCall = () => {
  if (state.scores.A === 0 && state.scores.B === 0 && state.pointLog.length === 0) {
    speakCallout("ラブオールプレイ");
  }
};

const speakPointUpdate = (scoringSide, previousServingSide) => {
  const scoreA = state.scores.A;
  const scoreB = state.scores.B;
  if (scoreA === scoreB) {
    const text = `${numberToCallout(scoreA)}オール`;
    speakCallout(text);
    return;
  }
  const prefix = scoringSide === previousServingSide ? "ポイント" : "サービスオーバー";
  const first = scoringSide === "A" ? scoreA : scoreB;
  const second = scoringSide === "A" ? scoreB : scoreA;
  const text = `${prefix} ${numberToCallout(first)}、${numberToCallout(second)}`;
  speakCallout(text);
};

const scheduleTouchDrag = (name, sourceSlot) => {
  if (!name) return;
  clearTimeout(dragState.timer);
  dragState.timer = setTimeout(() => {
    dragState.active = true;
    dragState.name = name;
    dragState.sourceSlot = sourceSlot;
    document.activeElement?.blur?.();
    document.body.classList.add("drag-active");
    setDragTargetsActive(true);
    updateAssignOverlay();
  }, 250);
};

const cancelTouchDrag = () => {
  clearTimeout(dragState.timer);
  dragState.timer = null;
};

const clearScoreboardHighlights = () => {
  [
    controls.nameA1,
    controls.nameA2,
    controls.nameB1,
    controls.nameB2,
  ].forEach((el) => el?.classList.remove("swap-target"));
};

const scheduleScoreboardTouchDrag = (sourceSlot) => {
  if (!sourceSlot) return;
  clearTimeout(scoreboardDrag.timer);
  scoreboardDrag.timer = setTimeout(() => {
    scoreboardDrag.active = true;
    scoreboardDrag.sourceSlot = sourceSlot;
  }, 250);
};

const cancelScoreboardTouchDrag = () => {
  clearTimeout(scoreboardDrag.timer);
  scoreboardDrag.timer = null;
  scoreboardDrag.active = false;
  scoreboardDrag.sourceSlot = null;
  clearScoreboardHighlights();
};

const finishScoreboardTouchDrag = (x, y) => {
  if (!scoreboardDrag.active) return;
  const target = document.elementFromPoint(x, y);
  const input = target?.closest?.("input");
  const slot = input ? slotFromInputId(input.id) : null;
  if (slot && scoreboardDrag.sourceSlot && slot !== scoreboardDrag.sourceSlot) {
    swapSlots(scoreboardDrag.sourceSlot, slot);
  }
  cancelScoreboardTouchDrag();
};

const finishTouchDrag = (x, y) => {
  if (!dragState.active) return;
  const target = document.elementFromPoint(x, y);
  const assignSlot = target?.closest?.("[data-assign-slot]");
  const input = target?.closest?.("input");
  const slot = assignSlot?.dataset?.assignSlot ?? (input ? slotFromInputId(input.id) : null);
  applyDrop(dragState.name, slot, dragState.sourceSlot);
  dragState.active = false;
  dragState.name = null;
  dragState.sourceSlot = null;
  setDragTargetsActive(false);
  document.body.classList.remove("drag-active");
};

function addPlayerToDB() {
  const name = controls.dbNameInput?.value.trim();
  if (!name) return;
  ensurePlayerInDB(name);
  controls.dbNameInput.value = "";
  setStatus("選手追加");
  renderPlayerDB();
  saveState();
}

function ensurePlayerInDB(name) {
  if (!name) return;
  const exists = state.playerDB.some((p) => p.name === name);
  if (!exists) {
    state.playerDB.push({ name });
    renderPlayerDB();
  }
}

function deletePlayer(name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  state.playerDB = state.playerDB.filter((p) => p.name !== name);
  // 割り当て済みの同名を空にする
  ["A", "B"].forEach((side) => {
    Object.keys(state.players[side]).forEach((k) => {
      if (state.players[side][k] === name) state.players[side][k] = "";
    });
  });
  setStatus("選手削除");
  syncUI();
  saveState();
}

function editPlayerName(oldName) {
  const newName = prompt("新しい名前を入力", oldName)?.trim();
  if (!newName || newName === oldName) return;
  if (state.playerDB.some((p) => p.name === newName)) {
    alert("同名が既に登録されています");
    return;
  }
  state.playerDB = state.playerDB.map((p) => (p.name === oldName ? { name: newName } : p));
  // 割り当て済みを置換
  ["A", "B"].forEach((side) => {
    Object.keys(state.players[side]).forEach((k) => {
      if (state.players[side][k] === oldName) state.players[side][k] = newName;
    });
  });
  setStatus("選手名更新");
  syncUI();
  saveState();
}

function isSetFinished() {
  if (state.settings.cumulative) return false;
  const target = state.settings.targetPoints;
  const a = state.scores.A;
  const b = state.scores.B;
  const maxScore = Math.max(a, b);
  const lead = Math.abs(a - b);
  const cap = state.settings.allowDeuce
    ? target === 21
      ? 30
      : target + 5
    : target;

  if (state.settings.allowDeuce) {
    if (maxScore >= cap) return true; // 上限到達で終了
    return maxScore >= target && lead >= 2;
  }
  return maxScore >= target;
}

function updateServeUI() {
  // 名前入力にサーブ表示
  [
    { side: "A", inputs: [controls.nameA1, controls.nameA2] },
    { side: "B", inputs: [controls.nameB1, controls.nameB2] },
  ].forEach(({ side, inputs }) => {
    const order =
      state.scores.A === 0 && state.scores.B === 0 && state.history.length === 0
        ? defaultDisplayOrder()[side]
        : state.displayOrder[side];
    inputs.forEach((input) => input.classList.remove("serving"));
    const idx = order.findIndex((k) => k === `p${state.serving.member}`);
    if (state.serving.side === side && idx !== -1) {
      inputs[idx].classList.add("serving");
    }
  });
  // サーブ権ラジオの見た目同期（ロジックは使わない）
  controls.serveSide?.forEach((r) => {
    if (r.value === state.initialServeSide) {
      r.checked = true;
    }
  });
}

function swapPositions(side) {
  const pos = state.positions[side];
  state.positions[side] = { right: pos.left, left: pos.right };
}

function resolveServerAfterPoint(scoringSide, previousServingSide) {
  // 0-0から初めての得点時だけ初期サーブ側の特例を処理
  if (!state.initialServeApplied && state.scores.A === 0 && state.scores.B === 0) {
    state.initialServeApplied = true;
    if (state.initialServeSide === "B") {
      if (scoringSide === "B") {
        // B得点: B1/B2入替え、Bに加点（呼び出し側で加点済み）、サーブ継続（B側）
        state.displayOrder.B.reverse();
        swapPositions("B");
        return state.serving;
      }
      // A得点: 特例なしで通常ロジックへ
    }
    // initialServeSide が A の場合は現行ロジックへ落ちる
  }

  if (scoringSide === previousServingSide) {
    // サーブ側が得点: 同じプレイヤーがサーブ継続し、左右を入れ替える
    swapPositions(scoringSide);
    // UIの上下も入れ替え
    state.displayOrder[scoringSide].reverse();
    return state.serving; // memberは維持
  }
  // レシーブ側が得点: サービス権獲得。サイド内でサーバーを交互に切替
  const last = state.lastServer[scoringSide] ?? "1";
  const member = last === "1" ? "2" : "1";
  state.lastServer[scoringSide] = member;
  const other = member === "1" ? "2" : "1";
  state.positions[scoringSide] = { right: member, left: other };
  return { side: scoringSide, member };
}

function getPlayerName(side, member) {
  const p = state.players[side];
  const key = member === "1" ? "p1" : "p2";
  return p?.[key] ?? `${side}${member}`;
}

function addPoint(side) {
  const snapshot = {
    side,
    serving: { ...state.serving },
    positions: {
      A: { ...state.positions.A },
      B: { ...state.positions.B },
    },
    scores: { ...state.scores },
    lastServer: { ...state.lastServer },
    displayOrder: {
      A: [...state.displayOrder.A],
      B: [...state.displayOrder.B],
    },
    setNo: state.scores.setNo,
    initialServeApplied: state.initialServeApplied,
    rallies: [...state.rallies],
  };
  const prevServingSide = state.serving.side;
  state.pointLog.push(snapshot);
  state.scores[side] += 1;
  state.serving = resolveServerAfterPoint(side, prevServingSide);
  state.rallies.push({
    rally: state.rallies.length + 1,
    scorer: side,
    scoreA: state.scores.A,
    scoreB: state.scores.B,
    server: `${state.serving.side}${state.serving.member}`,
  });
  speakPointUpdate(side, prevServingSide);
  setStatus("編集中");
  if (isSetFinished()) {
    lastAutoFinishSnapshot = snapshot;
    finishSet(true);
    return;
  }
  syncUI();
  saveState();
}

function undoLastPoint() {
  if (state.pointLog.length === 0) {
    // 直前が自動セット終了だった場合、元に戻す
    if (lastAutoFinishSnapshot) {
      state.serving = lastAutoFinishSnapshot.serving;
      state.positions = lastAutoFinishSnapshot.positions;
      state.scores = lastAutoFinishSnapshot.scores;
      state.lastServer = lastAutoFinishSnapshot.lastServer;
      state.displayOrder = lastAutoFinishSnapshot.displayOrder;
      state.scores.setNo = lastAutoFinishSnapshot.setNo;
      state.initialServeApplied = lastAutoFinishSnapshot.initialServeApplied;
      state.rallies = lastAutoFinishSnapshot.rallies ?? [];
      lastAutoFinishSnapshot = null;
      state.history.pop(); // 自動保存されたセットを取り消す
      setStatus("自動終了を取り消し");
      syncUI();
      saveState();
    }
    return;
  }
  const snap = state.pointLog.pop();
  state.serving = snap.serving;
  state.positions = snap.positions;
  state.scores = snap.scores;
  state.lastServer = snap.lastServer;
  state.displayOrder = snap.displayOrder;
  state.initialServeApplied = snap.initialServeApplied;
  state.rallies = snap.rallies ?? [];
  setStatus("編集中");
  syncUI();
  saveState();
}

function finishSet(auto = false) {
  const names = {
    A: state.displayOrder.A.map((k) => state.players.A[k]),
    B: state.displayOrder.B.map((k) => state.players.B[k]),
  };
  const namesByKey = {
    A1: state.players.A.p1,
    A2: state.players.A.p2,
    B1: state.players.B.p1,
    B2: state.players.B.p2,
  };
  const entry = {
    setNo: state.scores.setNo,
    scoreA: state.scores.A,
    scoreB: state.scores.B,
    target: state.settings.targetPoints,
    allowDeuce: state.settings.allowDeuce,
    server: state.serving,
    names,
    namesByKey,
    rallies: [...state.rallies],
    serveSide: state.initialServeSide,
    initialServeSide: state.initialServeSide,
    endedAt: Date.now(),
  };
  state.history.push(entry);
  if (auto) {
    const winnerSide = entry.scoreA > entry.scoreB ? "A" : "B";
    advanceToNextSet(winnerSide);
    state.pointLog = [];
    state.initialServeApplied = false;
    state.initialServeSide = "A"; // 以降の初期値はA
    state.rallies = [];
    setStatus("セット自動終了");
    syncUI();
    saveState();
  } else {
    // 手動終了（今回は「全リセット」ボタン）→完全リセット
    hardResetAll();
  }
}

function advanceToNextSet(winnerSide) {
  state.scores = { A: 0, B: 0, setNo: state.scores.setNo + 1 };
  state.serving = { side: winnerSide, member: "1" };
  state.lastServer[winnerSide] = "1";
  state.positions = { A: { right: "1", left: "2" }, B: { right: "1", left: "2" } };
  state.displayOrder = defaultDisplayOrder();
  state.initialServeApplied = false;
  state.initialServeSide = "A";
  state.rallies = [];
  speakStartCall();
}

function resetAll() {
  // 選手リストを保持し、それ以外をリセット。名前は初期化。
  const preservedDB = [...state.playerDB];
  state = defaultState();
  state.playerDB = preservedDB;
  lastAutoFinishSnapshot = null;
  state.initialServeApplied = false;
  state.initialServeSide = "A";
  speakStartCall();
  setStatus("全リセット（リスト保持）");
  syncUI();
  saveState();
}

function hardResetAll() {
  // 全リセットボタンでもDBは保持する仕様に変更
  resetAll();
}

function clearHistory() {
  state.history = [];
  state.scores.setNo = 1;
  state.sheetSetIndex = null;
  speakStartCall();
  setStatus("履歴クリア");
  syncUI();
  saveState();
}

function resetPlayerList() {
  state.playerDB = [];
  ["A", "B"].forEach((side) => {
    Object.keys(state.players[side]).forEach((k) => {
      state.players[side][k] = "";
    });
  });
  state.rallies = [];
  setStatus("選手リストリセット");
  syncUI();
  saveState();
}


function bindEvents() {
  controls.buttons.forEach((btn) => {
    btn.addEventListener("click", () => addPoint(btn.dataset.side));
  });

  controls.undo.addEventListener("click", undoLastPoint);
  if (controls.undo2) {
    controls.undo2.addEventListener("click", undoLastPoint);
  }
  controls.hardReset.addEventListener("click", () => {
    if (confirm("全データ（名前含む）を初期化しますか？")) hardResetAll();
  });
  controls.clearHistory.addEventListener("click", () => {
    if (confirm("セット履歴を消去しますか？")) clearHistory();
  });
  if (controls.dbReset) {
    controls.dbReset.addEventListener("click", () => {
      if (confirm("選手リストを初期化しますか？（名前割当も空になります）")) resetPlayerList();
    });
  }

  controls.targetPoints.forEach((r) => {
    r.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      state.settings.targetPoints = Number(e.target.value);
      setStatus("設定変更");
      saveState();
    });
  });

  controls.allowDeuce.forEach((r) => {
    r.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      state.settings.allowDeuce = e.target.value === "true";
      setStatus("設定変更");
      saveState();
    });
  });
  if (controls.voiceEnabled) {
    controls.voiceEnabled.addEventListener("change", (e) => {
      state.settings.voiceEnabled = e.target.checked;
      setStatus("読み上げ設定");
      if (state.settings.voiceEnabled) {
        speechUnlocked = true;
        prepareSpeech();
        speakStartCall();
      }
      saveState();
    });
  }
  if (controls.voiceTest) {
    controls.voiceTest.addEventListener("click", () => {
      speechUnlocked = true;
      prepareSpeech();
      speakCallout("テスト");
    });
  }
  controls.voiceGender?.forEach((r) => {
    r.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      state.settings.voiceGender = e.target.value;
      setStatus("読み上げ設定");
      saveState();
    });
  });

  const nameInputHandler = (side, slot) => (e) => {
    const order = state.displayOrder[side];
    const memberKey = order[slot];
    state.players[side][memberKey] = e.target.value;
    setStatus("名前更新");
    saveState();
  };
  const nameBlurHandler = (side, slot) => (e) => {
    ensurePlayerInDB(e.target.value.trim());
  };

  controls.nameA1.addEventListener("input", nameInputHandler("A", 0)); // 上段
  controls.nameA2.addEventListener("input", nameInputHandler("A", 1)); // 下段
  controls.nameB1.addEventListener("input", nameInputHandler("B", 0)); // 上段
  controls.nameB2.addEventListener("input", nameInputHandler("B", 1)); // 下段
  controls.nameA1.addEventListener("blur", nameBlurHandler("A", 0));
  controls.nameA2.addEventListener("blur", nameBlurHandler("A", 1));
  controls.nameB1.addEventListener("blur", nameBlurHandler("B", 0));
  controls.nameB2.addEventListener("blur", nameBlurHandler("B", 1));
  controls.nameA1.addEventListener("change", nameBlurHandler("A", 0));
  controls.nameA2.addEventListener("change", nameBlurHandler("A", 1));
  controls.nameB1.addEventListener("change", nameBlurHandler("B", 0));
  controls.nameB2.addEventListener("change", nameBlurHandler("B", 1));

  controls.initialServe.forEach((r) => {
    r.addEventListener("change", (e) => {
      if (!canChangeInitialServe()) return;
      setInitialServeFromUI(e.target.value);
      setStatus("開始サーブ変更");
    });
  });

  document.querySelectorAll(".btnViewToggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.viewMode === "sheet") {
        state.viewMode = "board";
        state.sheetSetIndex = null;
        state.playerDbOpen = false;
        syncUI();
        requestAnimationFrame(() => window.scrollTo(0, 0));
        forceBoardView();
      } else {
        state.viewMode = "sheet";
        syncView();
      }
      saveState();
      setStatus(`表示切替: ${state.viewMode === "sheet" ? "スコアシート" : "スコアボード"}`);
    });
  });

  controls.serveSide.forEach((r) => {
    r.addEventListener("change", (e) => {
      setServeSide(e.target.value);
      setStatus("サーブ権表示のみ更新");
    });
  });

  if (controls.dbAddBtn) {
    controls.dbAddBtn.addEventListener("click", addPlayerToDB);
  }
  if (controls.dbNameInput) {
    controls.dbNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPlayerToDB();
      }
    });
  }

  const makeDropHandler = (side, index) => (e) => {
    e.preventDefault();
    const name = e.dataTransfer?.getData("text/plain");
    const sourceSlot = e.dataTransfer?.getData("application/x-badminton-slot");
    if (!name && !sourceSlot) return;
    applyDrop(name, `${side}${index}`, sourceSlot || null);
  };
  const makeDragOver = (e) => {
    e.preventDefault();
  };
  [
    { el: controls.nameA1, side: "A", idx: 0, slot: "A0" },
    { el: controls.nameA2, side: "A", idx: 1, slot: "A1" },
    { el: controls.nameB1, side: "B", idx: 0, slot: "B0" },
    { el: controls.nameB2, side: "B", idx: 1, slot: "B1" },
  ].forEach(({ el, side, idx, slot }) => {
    if (!el) return;
    el.addEventListener("dragover", makeDragOver);
    el.addEventListener("drop", makeDropHandler(side, idx));
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", el.value || " ");
      e.dataTransfer?.setData("application/x-badminton-slot", slot);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      el.classList.add("swap-target");
    });
    el.addEventListener("dragend", () => {
      clearScoreboardHighlights();
    });
    el.addEventListener("dragenter", () => {
      el.classList.add("swap-target");
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("swap-target");
    });
    el.addEventListener("touchstart", () => {
      scheduleScoreboardTouchDrag(slot);
    }, { passive: true });
  });
  document.querySelectorAll(".assign-slot").forEach((el) => {
    el.addEventListener("dragover", makeDragOver);
    el.addEventListener("dragleave", () => {
      el.classList.remove("assign-active");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("assign-active");
      const name = e.dataTransfer?.getData("text/plain");
      const sourceSlot = e.dataTransfer?.getData("application/x-badminton-slot");
      if (!name && !sourceSlot) return;
      const slot = el.dataset.assignSlot;
      applyDrop(name, slot, sourceSlot || null);
    });
    el.addEventListener("dragenter", () => {
      el.classList.add("assign-active");
    });
  });

  document.addEventListener("touchmove", (e) => {
    if (!dragState.active && !scoreboardDrag.active) return;
    e.preventDefault();
    const touch = e.touches?.[0];
    if (!touch) return;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (dragState.active) {
      document.querySelectorAll(".assign-slot").forEach((slot) => {
        slot.classList.toggle("assign-active", slot.contains(target));
      });
    }
    if (scoreboardDrag.active) {
      const input = target?.closest?.("input");
      clearScoreboardHighlights();
      if (input) input.classList.add("swap-target");
    }
  }, { passive: false });
  document.addEventListener("touchend", (e) => {
    if (dragState.active) {
      e.preventDefault();
      document.querySelectorAll(".assign-slot").forEach((slot) => slot.classList.remove("assign-active"));
      const touch = e.changedTouches?.[0];
      if (!touch) return;
      finishTouchDrag(touch.clientX, touch.clientY);
      return;
    }
    if (scoreboardDrag.active) {
      e.preventDefault();
      const touch = e.changedTouches?.[0];
      if (!touch) return;
      finishScoreboardTouchDrag(touch.clientX, touch.clientY);
      return;
    }
    cancelTouchDrag();
    cancelScoreboardTouchDrag();
  }, { passive: false });
  document.addEventListener("touchcancel", () => {
    cancelTouchDrag();
    dragState.active = false;
    setDragTargetsActive(false);
    document.body.classList.remove("drag-active");
    cancelScoreboardTouchDrag();
  }, { passive: true });
  document.addEventListener("dragend", () => {
    if (!dragState.active) return;
    dragState.active = false;
    dragState.name = null;
    dragState.sourceSlot = null;
    setDragTargetsActive(false);
    document.body.classList.remove("drag-active");
  });

  if (controls.shareSheet) {
    controls.shareSheet.addEventListener("click", () => {
      if (navigator.share) {
        navigator.share({ title: "スコアシート", text: "スコアシートを共有", url: location.href }).catch(() => {
          window.print();
        });
      } else {
        window.print();
      }
    });
  }
  window.addEventListener("scroll", clampScrollToContent, { passive: true });
  window.addEventListener("resize", updateScrollLimit);
  updateScrollLimit();
  const updateOverscrollLock = () => {
    const root = document.documentElement;
    const maxScroll = root.scrollHeight - root.clientHeight;
    if (maxScroll <= 0) {
      document.body.classList.remove("overscroll-lock");
      return;
    }
    const atBottom = root.scrollTop >= maxScroll - 1;
    document.body.classList.toggle("overscroll-lock", atBottom);
  };
  window.addEventListener("scroll", updateOverscrollLock, { passive: true });
  window.addEventListener("resize", updateOverscrollLock);
  updateOverscrollLock();
  if (controls.sheetToCurrent) {
    controls.sheetToCurrent.addEventListener("click", () => {
      state.sheetSetIndex = null;
      syncView();
      saveState();
    });
  }
  if (controls.historyPeek) {
    controls.historyPeek.addEventListener("click", () => {
      state.historyPeek = !state.historyPeek;
      updateLayoutVisibility();
      saveState();
    });
  }
  if (controls.collapseLeft) {
    controls.collapseLeft.classList.remove("hidden");
    controls.collapseLeft.addEventListener("click", () => {
      state.playerDbOpen = !state.playerDbOpen;
      updateLayoutVisibility();
      saveState();
    });
  }
  if (controls.expandLeft) {
    controls.expandLeft.addEventListener("click", () => {
      if (state.viewMode === "sheet") {
        state.viewMode = "board";
        state.sheetSetIndex = null;
        state.playerDbOpen = false;
        syncUI();
        requestAnimationFrame(() => window.scrollTo(0, 0));
        forceBoardView();
      } else {
        state.viewMode = "sheet";
        state.playerDbOpen = false;
        syncView();
      }
      updateLayoutVisibility();
      saveState();
    });
  }
}

function init() {
  state.historyPeek = false;
  state.playerDbOpen = false;
  sessionStorage.removeItem(BOARD_RELOAD_KEY);
  syncUI();
  bindEvents();
  if (window.speechSynthesis) {
    prepareSpeech();
    window.speechSynthesis.onvoiceschanged = () => prepareSpeech();
  }
  setStatus("復元済み");
}

window.addEventListener("DOMContentLoaded", init);

function updateServeRadioState() {
  const atStart = state.scores.A === 0 && state.scores.B === 0;
  controls.serveSide.forEach((r) => {
    r.disabled = !atStart;
  });
  document.querySelectorAll(".serve-faint").forEach((el) => {
    el.classList.toggle("active", atStart);
  });
}

function syncView() {
  const board = document.querySelectorAll(".view-board");
  const sheet = document.querySelectorAll(".view-sheet");
  const onSheet = state.viewMode === "sheet";
  renderHistory();
  if (onSheet) {
    board.forEach((el) => {
      el.classList.add("hidden");
      el.style.display = "none";
    });
    sheet.forEach((el) => {
      el.classList.remove("hidden");
      el.style.display = "";
    });
  } else {
    board.forEach((el) => {
      el.classList.remove("hidden");
      el.style.display = "";
    });
    sheet.forEach((el) => {
      el.classList.add("hidden");
      el.style.display = "none";
    });
  }
  document.body.classList.toggle("view-sheet", onSheet);
  if (controls.collapseLeft) {
    controls.collapseLeft.classList.toggle("hidden", onSheet);
  }
  updateLayoutVisibility();
  renderScoreSheet();
  updateScrollLimit();
}

function updateLayoutVisibility() {
  const layout = document.querySelector(".layout");
  const leftCol = document.querySelector(".left-col");
  const isBoard = state.viewMode === "board";
  document.body.classList.toggle("playerdb-open", state.playerDbOpen);
  const assignOverlay = document.getElementById("assignOverlay");
  if (assignOverlay) {
    assignOverlay.classList.toggle("force-visible", state.playerDbOpen && isBoard);
    assignOverlay.style.display = state.playerDbOpen ? "flex" : "";
  }
  if (layout) {
    layout.classList.toggle("playerdb-open", state.playerDbOpen && isBoard);
    layout.classList.toggle("history-hidden", isBoard && (!state.historyPeek || state.playerDbOpen));
  }
  if (leftCol) {
    leftCol.classList.remove("hidden");
  }
  const historyCard = document.querySelector(".history-card.view-board");
  if (historyCard) {
    historyCard.classList.toggle("hidden", !state.historyPeek || state.playerDbOpen);
    historyCard.classList.toggle("history-peek", state.historyPeek);
  }
  const playerDb = document.querySelector(".playerdb-card.view-board");
  if (playerDb) {
    playerDb.classList.toggle("hidden", !(state.playerDbOpen && isBoard));
  }
  updateScrollLimit();
}

function renderScoreSheet() {
  const container = document.getElementById("scoreSheetContent");
  if (!container) return;
  const validHistoryIndex =
    Number.isInteger(state.sheetSetIndex) && state.sheetSetIndex >= 0 && state.sheetSetIndex < state.history.length;
  const viewingHistory = validHistoryIndex && state.viewMode === "sheet";
  const last = {
    setNo: state.scores.setNo,
    scoreA: state.scores.A,
    scoreB: state.scores.B,
    names: {
      A: state.displayOrder.A.map((k) => state.players.A[k]),
      B: state.displayOrder.B.map((k) => state.players.B[k]),
    },
    rallies: state.rallies,
    initialServeSide: state.initialServeSide,
    inProgress: true,
  };
  const base = viewingHistory ? state.history[state.sheetSetIndex] : last;

  // サーバーごとに、そのサーブ権で得点したときの「得点後の値」をラリー順に並べ、空欄も保持する
  const namesNow = {
    A1: base.namesByKey?.A1 ?? state.players.A.p1,
    A2: base.namesByKey?.A2 ?? state.players.A.p2,
    B1: base.namesByKey?.B1 ?? state.players.B.p1,
    B2: base.namesByKey?.B2 ?? state.players.B.p2,
  };
  const calcChunkSize = (labels) => {
    const measureTable = document.createElement("table");
    measureTable.className = "sheet-table";
    measureTable.style.visibility = "hidden";
    measureTable.style.position = "absolute";
    measureTable.style.left = "-9999px";
    measureTable.style.top = "-9999px";
    const tbody = document.createElement("tbody");
    const scoreCell = document.createElement("td");
    scoreCell.className = "score-cell";
    scoreCell.textContent = "00";
    labels.forEach((label) => {
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td");
      nameCell.textContent = label;
      tr.appendChild(nameCell);
      tr.appendChild(scoreCell.cloneNode(true));
      tbody.appendChild(tr);
    });
    measureTable.appendChild(tbody);
    container.appendChild(measureTable);
    let nameWidth = 0;
    tbody.querySelectorAll("td:first-child").forEach((td) => {
      nameWidth = Math.max(nameWidth, td.getBoundingClientRect().width);
    });
    const cellWidth = measureTable.querySelector(".score-cell").getBoundingClientRect().width;
    const spacing = getComputedStyle(measureTable).borderSpacing.split(" ");
    const gapX = Number.parseFloat(spacing[0]) || 0;
    const available = container.clientWidth - nameWidth;
    measureTable.remove();
    const perCell = cellWidth + gapX;
    if (perCell <= 0 || available <= 0) return 10;
    return Math.max(4, Math.floor(available / perCell));
  };
  const maxRally = base.rallies?.length ?? 0;
  const initialKey = `${base.initialServeSide ?? state.initialServeSide ?? "A"}1`;
  const serveChangeCols = new Set();
  let prevServer = initialKey;
  const buckets = {
    A1: Array(maxRally + 1).fill(""),
    A2: Array(maxRally + 1).fill(""),
    B1: Array(maxRally + 1).fill(""),
    B2: Array(maxRally + 1).fill(""),
  };
  if (buckets[initialKey]) buckets[initialKey][0] = "0";
  (base.rallies ?? []).forEach((r, idx) => {
    const srv = r.server ?? "";
    const val = r.scorer === "A" ? r.scoreA : r.scoreB;
    if (buckets[srv]) buckets[srv][idx + 1] = String(val ?? "");
    if (srv && prevServer && srv !== prevServer) {
      serveChangeCols.add(idx + 1);
    }
    if (srv) prevServer = srv;
  });
  const labels = [
    namesNow.A1 || "A1",
    namesNow.A2 || "A2",
    namesNow.B1 || "B1",
    namesNow.B2 || "B2",
  ];
  const chunkSize = calcChunkSize(labels);
  const chunkCount = Math.max(1, Math.ceil((maxRally + 1) / chunkSize));
  const rowsForRange = (start, end) =>
    [
      { key: "A1", label: namesNow.A1 || "A1" },
      { key: "A2", label: namesNow.A2 || "A2" },
      { sep: true },
      { key: "B1", label: namesNow.B1 || "B1" },
      { key: "B2", label: namesNow.B2 || "B2" },
    ]
      .map((row) => {
        if (row.sep) {
          const span = end - start + 2;
          return `<tr class="sheet-sep"><td colspan="${span}"></td></tr>`;
        }
        const cells = buckets[row.key]
          .slice(start, end + 1)
          .map((v, colIdx) => {
            const absoluteIdx = start + colIdx;
            const classes = ["score-cell"];
            if (serveChangeCols.has(absoluteIdx)) {
              classes.push("serve-change");
            }
            return `<td class="${classes.join(" ")}">${v || "&nbsp;"}</td>`;
          })
          .join("");
        const labelCell =
          start === 0
            ? `<td class="name-cell">${row.label}</td>`
            : `<td class="name-cell">&nbsp;</td>`;
        return `<tr>${labelCell}${cells}</tr>`;
      })
      .join("");
  const tables = Array.from({ length: chunkCount }, (_, i) => {
    const start = i * chunkSize;
    const end = Math.min(maxRally, start + chunkSize - 1);
    return `
      <table class="sheet-table">
        <tbody>${rowsForRange(start, end)}</tbody>
      </table>
    `;
  }).join("");

  container.innerHTML = `
    <div class="sheet-summary"><strong>セット数:</strong> ${state.history.length || "進行中"}</div>
    <div class="sheet-summary"><strong>${viewingHistory ? `セット ${base.setNo}（履歴）` : "進行中セット"}:</strong> ${base.scoreA} - ${base.scoreB}</div>
    <div class="sheet-summary"><strong>選手:</strong> A: ${base.names?.A?.join(" / ") ?? ""} ｜ B: ${base.names?.B?.join(" / ") ?? ""}</div>
    <div style="margin-top:8px;">
      ${tables}
    </div>
  `;
  if (controls.sheetToCurrent) {
    controls.sheetToCurrent.classList.toggle("hidden", !viewingHistory);
  }
}
