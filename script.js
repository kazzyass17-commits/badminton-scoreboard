// Phase0 practice scoreboard with future tournament data model retained (non-UI)
const STORAGE_KEY = "badminton-scoreboard/v1";
const statusEl = () => document.getElementById("storageStatus");

const $ = (id) => document.getElementById(id);
const controls = {
  targetPoints: document.querySelectorAll('input[name="targetPoints"]'),
  allowDeuce: document.querySelectorAll('input[name="allowDeuce"]'),
  initialServe: document.querySelectorAll('input[name="initialServe"]'),
  serveSide: document.querySelectorAll('input[name="serveSide"]'),
  nameA1: $("nameA1"),
  nameA2: $("nameA2"),
  nameB1: $("nameB1"),
  nameB2: $("nameB2"),
  scoreA: $("scoreA"),
  scoreB: $("scoreB"),
  setNumber: $("setNumber"),
  historyList: $("historyList"),
  buttons: document.querySelectorAll("button[data-side]"),
  undo: $("btnUndo"),
  hardReset: $("btnHardReset"),
  clearHistory: $("clearHistoryBtn"),
  dbNameInput: $("dbNameInput"),
  dbAddBtn: $("dbAddBtn"),
  playerDbList: $("playerDbList"),
  dbReset: $("btnDbReset"),
};

const defaultDisplayOrder = () => ({
  A: ["p2", "p1"], // 上: A2, 下: A1
  B: ["p1", "p2"], // 上: B1, 下: B2
});

const defaultState = () => ({
  settings: {
    targetPoints: 21,
    allowDeuce: true,
  },
  players: {
    A: { p1: "選手A1", p2: "選手A2" },
    B: { p1: "選手B1", p2: "選手B2" },
  },
  scores: { A: 0, B: 0, setNo: 1 },
  pointLog: [], // [{ side, serving, positions, scores }]
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
    const order = state.displayOrder[side];
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

function renderHistory() {
  const list = controls.historyList;
  if (state.history.length === 0) {
    list.classList.add("empty");
    list.textContent = "まだセットがありません";
    return;
  }
  list.classList.remove("empty");
  list.textContent = "";

  state.history
    .slice()
    .reverse()
    .forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-item";
      const left = document.createElement("div");
      left.className = "left";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = `セット ${item.setNo}: ${item.scoreA} - ${item.scoreB}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      const serverTxt = item.server ? ` / サーブ: ${item.server.side}${item.server.member}` : "";
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
      right.textContent = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
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
    });
    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = p.name;
    const actions = document.createElement("div");
    actions.className = "player-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn micro";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", () => editPlayerName(p.name));
    const delBtn = document.createElement("button");
    delBtn.className = "btn micro danger";
    delBtn.textContent = "削除";
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
  state.players[side][key] = name;
  ensurePlayerInDB(name);
  setStatus("名前更新");
  syncUI();
  saveState();
}

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
    const order = state.displayOrder[side];
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
  };
  const prevServingSide = state.serving.side;
  state.pointLog.push(snapshot);
  state.scores[side] += 1;
  state.serving = resolveServerAfterPoint(side, prevServingSide);
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
  setStatus("編集中");
  syncUI();
  saveState();
}

function finishSet(auto = false) {
  const names = {
    A: state.displayOrder.A.map((k) => state.players.A[k]),
    B: state.displayOrder.B.map((k) => state.players.B[k]),
  };
  const entry = {
    setNo: state.scores.setNo,
    scoreA: state.scores.A,
    scoreB: state.scores.B,
    target: state.settings.targetPoints,
    allowDeuce: state.settings.allowDeuce,
    server: state.serving,
    names,
    endedAt: Date.now(),
  };
  state.history.push(entry);
  if (auto) {
    const winnerSide = entry.scoreA > entry.scoreB ? "A" : "B";
    advanceToNextSet(winnerSide);
    state.pointLog = [];
    state.initialServeApplied = false;
    state.initialServeSide = "A"; // 以降の初期値はA
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
}

function resetAll() {
  // 選手DBを保持し、それ以外をリセット。名前は初期化。
  const preservedDB = [...state.playerDB];
  state = defaultState();
  state.playerDB = preservedDB;
  lastAutoFinishSnapshot = null;
  state.initialServeApplied = false;
  state.initialServeSide = "A";
  setStatus("全リセット（DB保持）");
  syncUI();
  saveState();
}

function hardResetAll() {
  // 全リセットボタンでもDBは保持する仕様に変更
  resetAll();
}

function clearHistory() {
  state.history = [];
  setStatus("履歴クリア");
  syncUI();
  saveState();
}

function resetPlayerDB() {
  state.playerDB = [];
  // 割当名も空にする
  ["A", "B"].forEach((side) => {
    Object.keys(state.players[side]).forEach((k) => {
      state.players[side][k] = "";
    });
  });
  setStatus("選手DBリセット");
  syncUI();
  saveState();
}

function bindEvents() {
  controls.buttons.forEach((btn) => {
    btn.addEventListener("click", () => addPoint(btn.dataset.side));
  });

  controls.undo.addEventListener("click", undoLastPoint);
  controls.hardReset.addEventListener("click", () => {
    if (confirm("全データ（名前含む）を初期化しますか？")) hardResetAll();
  });
  controls.clearHistory.addEventListener("click", () => {
    if (confirm("セット履歴を消去しますか？")) clearHistory();
  });
  if (controls.dbReset) {
    controls.dbReset.addEventListener("click", () => {
      if (confirm("選手DBを初期化しますか？（名前割当も空になります）")) resetPlayerDB();
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

  controls.initialServe.forEach((r) => {
    r.addEventListener("change", (e) => {
      if (!canChangeInitialServe()) return;
      setInitialServeFromUI(e.target.value);
      setStatus("開始サーブ変更");
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
    if (!name) return;
    assignPlayerToSlot(name, `${side}${index}`);
  };
  const makeDragOver = (e) => {
    e.preventDefault();
  };
  [
    { el: controls.nameA1, side: "A", idx: 0 },
    { el: controls.nameA2, side: "A", idx: 1 },
    { el: controls.nameB1, side: "B", idx: 0 },
    { el: controls.nameB2, side: "B", idx: 1 },
  ].forEach(({ el, side, idx }) => {
    if (!el) return;
    el.addEventListener("dragover", makeDragOver);
    el.addEventListener("drop", makeDropHandler(side, idx));
  });
}

function init() {
  syncUI();
  bindEvents();
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
