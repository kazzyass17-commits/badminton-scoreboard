// Phase0 practice scoreboard with future tournament data model retained (non-UI)
const STORAGE_KEY = "badminton-scoreboard/v1";
const statusEl = () => document.getElementById("storageStatus");

const $ = (id) => document.getElementById(id);
const controls = {
  targetPoints: document.querySelectorAll('input[name="targetPoints"]'),
  allowDeuce: document.querySelectorAll('input[name="allowDeuce"]'),
  initialServe: document.querySelectorAll('input[name="initialServe"]'),
  nameA1: $("nameA1"),
  nameA2: $("nameA2"),
  nameB1: $("nameB1"),
  nameB2: $("nameB2"),
  scoreA: $("scoreA"),
  scoreB: $("scoreB"),
  setNumber: $("setNumber"),
  historyList: $("historyList"),
  buttons: document.querySelectorAll("button[data-side]"),
  undo: $("undoBtn"),
  reset: $("resetBtn"),
  finishSet: $("finishSetBtn"),
  clearHistory: $("clearHistoryBtn"),
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
  positions: {
    A: { right: "1", left: "2" }, // サーブサイドのローテーション用
    B: { right: "1", left: "2" },
  },
  lastServer: { A: "1", B: "1" },
  displayOrder: defaultDisplayOrder(),
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
  updateServeUI();
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
}

function swapPositions(side) {
  const pos = state.positions[side];
  state.positions[side] = { right: pos.left, left: pos.right };
}

function resolveServerAfterPoint(scoringSide, previousServingSide) {
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
  };
  const prevServingSide = state.serving.side;
  state.pointLog.push(snapshot);
  state.scores[side] += 1;
  state.serving = resolveServerAfterPoint(side, prevServingSide);
  setStatus("編集中");
  if (isSetFinished()) {
    finishSet(true);
    return;
  }
  syncUI();
  saveState();
}

function undoLastPoint() {
  if (state.pointLog.length === 0) return;
  const snap = state.pointLog.pop();
  state.serving = snap.serving;
  state.positions = snap.positions;
  state.scores = snap.scores;
  state.lastServer = snap.lastServer;
  state.displayOrder = snap.displayOrder;
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
  state.scores = { A: 0, B: 0, setNo: state.scores.setNo + 1 };
  state.pointLog = [];
  // 次セット開始時: 直前セット勝者のp1を初期サーブに
  const winnerSide = entry.scoreA > entry.scoreB ? "A" : "B";
  state.serving = { side: winnerSide, member: "1" };
  state.lastServer[winnerSide] = "1";
  state.positions = { A: { right: "1", left: "2" }, B: { right: "1", left: "2" } };
  state.displayOrder = defaultDisplayOrder();
  setStatus(auto ? "セット自動終了" : "セット保存");
  syncUI();
  saveState();
}

function resetAll() {
  state = defaultState();
  setStatus("初期化");
  syncUI();
  saveState();
}

function clearHistory() {
  state.history = [];
  setStatus("履歴クリア");
  syncUI();
  saveState();
}

function bindEvents() {
  controls.buttons.forEach((btn) => {
    btn.addEventListener("click", () => addPoint(btn.dataset.side));
  });

  controls.undo.addEventListener("click", undoLastPoint);
  controls.reset.addEventListener("click", () => {
    if (confirm("全データを初期化しますか？")) resetAll();
  });
  controls.finishSet.addEventListener("click", finishSet);
  controls.clearHistory.addEventListener("click", () => {
    if (confirm("セット履歴を消去しますか？")) clearHistory();
  });

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

  const nameHandler = (side, slot) => (e) => {
    const order = state.displayOrder[side];
    const memberKey = order[slot];
    state.players[side][memberKey] = e.target.value;
    setStatus("名前更新");
    saveState();
  };

  controls.nameA1.addEventListener("input", nameHandler("A", 0)); // 上段
  controls.nameA2.addEventListener("input", nameHandler("A", 1)); // 下段
  controls.nameB1.addEventListener("input", nameHandler("B", 0)); // 上段
  controls.nameB2.addEventListener("input", nameHandler("B", 1)); // 下段

  controls.initialServe.forEach((r) => {
    r.addEventListener("change", (e) => {
      if (!canChangeInitialServe()) return;
      setInitialServeFromUI(e.target.value);
      setStatus("開始サーブ変更");
    });
  });
}

function init() {
  syncUI();
  bindEvents();
  setStatus("復元済み");
}

window.addEventListener("DOMContentLoaded", init);
