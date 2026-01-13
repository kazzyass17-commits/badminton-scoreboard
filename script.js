// Phase0 practice scoreboard with future tournament data model retained (non-UI)
const STORAGE_KEY = "badminton-scoreboard/v1";
const statusEl = () => document.getElementById("storageStatus");

const $ = (id) => document.getElementById(id);
const controls = {
  targetPoints: $("targetPoints"),
  allowDeuce: $("allowDeuce"),
  cumulative: $("cumulativeFlag"),
  nameA1: $("nameA1"),
  nameA2: $("nameA2"),
  nameB1: $("nameB1"),
  nameB2: $("nameB2"),
  scoreA: $("scoreA"),
  scoreB: $("scoreB"),
  setNumber: $("setNumber"),
  historyList: $("historyList"),
  serverBadge: $("serverBadge"),
  serveButtons: document.querySelectorAll("[data-server]"),
  buttons: document.querySelectorAll("button[data-side]"),
  undo: $("undoBtn"),
  reset: $("resetBtn"),
  finishSet: $("finishSetBtn"),
  clearHistory: $("clearHistoryBtn"),
};

const defaultState = () => ({
  settings: {
    targetPoints: 21,
    allowDeuce: true,
    cumulative: false,
  },
  players: {
    A: { p1: "選手A1", p2: "選手A2" },
    B: { p1: "選手B1", p2: "選手B2" },
  },
  scores: { A: 0, B: 0, setNo: 1 },
  pointLog: [],
  history: [],
  serving: { side: "A", member: "1" },
  positions: {
    A: { right: "1", left: "2" }, // サーブサイドのローテーション用
    B: { right: "1", left: "2" },
  },
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
  controls.targetPoints.value = String(state.settings.targetPoints);
  controls.allowDeuce.checked = state.settings.allowDeuce;
  controls.cumulative.checked = state.settings.cumulative;

  controls.nameA1.value = state.players.A.p1;
  controls.nameA2.value = state.players.A.p2;
  controls.nameB1.value = state.players.B.p1;
  controls.nameB2.value = state.players.B.p2;
  controls.scoreA.textContent = state.scores.A;
  controls.scoreB.textContent = state.scores.B;
  controls.setNumber.textContent = state.scores.setNo;
  updateServeUI();
  renderHistory();
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
      meta.textContent = `到達点${item.target} / デュース${item.allowDeuce ? "有" : "無"} / 累積${item.cumulative ? "ON" : "OFF"}${serverTxt}`;
      left.appendChild(title);
      left.appendChild(meta);

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

  if (state.settings.allowDeuce) {
    return maxScore >= target && lead >= 2;
  }
  return maxScore >= target;
}

function updateServeUI() {
  const label = `${state.serving.side}${state.serving.member}`;
  controls.serverBadge.textContent = label;
  controls.serveButtons.forEach((btn) => {
    const active = btn.dataset.server === `${state.serving.side}-${state.serving.member}`;
    btn.classList.toggle("active", active);
  });
}

function setServer(side, member) {
  state.serving = { side, member };
  const other = member === "1" ? "2" : "1";
  // サーブ指定時は右コートにサーバーを合わせる
  state.positions[side] = { right: member, left: other };
  setStatus("サーブ更新");
  updateServeUI();
  saveState();
}

function swapPositions(side) {
  const pos = state.positions[side];
  state.positions[side] = { right: pos.left, left: pos.right };
}

function resolveServerAfterPoint(scoringSide, previousServingSide) {
  if (scoringSide === previousServingSide) {
    // サーブ側が得点: 同じプレイヤーがサーブ継続し、左右を入れ替える
    swapPositions(scoringSide);
    return state.serving; // memberは維持
  }
  // レシーブ側が得点: サービス権獲得。自陣の得点偶奇で右/左を決める
  const score = state.scores[scoringSide];
  const pos = state.positions[scoringSide];
  const member = score % 2 === 0 ? pos.right : pos.left;
  return { side: scoringSide, member };
}

function addPoint(side) {
  const prevServingSide = state.serving.side;
  state.scores[side] += 1;
  state.pointLog.push(side);
  state.serving = resolveServerAfterPoint(side, prevServingSide);
  setStatus("編集中");
  syncUI();
  if (isSetFinished()) {
    setStatus("セット終了可能");
  }
  saveState();
}

function undoLastPoint() {
  if (state.pointLog.length === 0) return;
  const side = state.pointLog.pop();
  if (state.scores[side] > 0) {
    state.scores[side] -= 1;
  }
  setStatus("編集中");
  syncUI();
  saveState();
}

function finishSet() {
  const entry = {
    setNo: state.scores.setNo,
    scoreA: state.scores.A,
    scoreB: state.scores.B,
    target: state.settings.targetPoints,
    allowDeuce: state.settings.allowDeuce,
    cumulative: state.settings.cumulative,
    server: state.serving,
    endedAt: Date.now(),
  };
  state.history.push(entry);
  state.scores = { A: 0, B: 0, setNo: state.scores.setNo + 1 };
  state.pointLog = [];
  setStatus("セット保存");
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

  controls.serveButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const [side, member] = btn.dataset.server.split("-");
      setServer(side, member);
    });
  });

  controls.undo.addEventListener("click", undoLastPoint);
  controls.reset.addEventListener("click", () => {
    if (confirm("全データを初期化しますか？")) resetAll();
  });
  controls.finishSet.addEventListener("click", finishSet);
  controls.clearHistory.addEventListener("click", () => {
    if (confirm("セット履歴を消去しますか？")) clearHistory();
  });

  controls.targetPoints.addEventListener("change", (e) => {
    state.settings.targetPoints = Number(e.target.value);
    setStatus("設定変更");
    saveState();
  });

  controls.allowDeuce.addEventListener("change", (e) => {
    state.settings.allowDeuce = e.target.checked;
    setStatus("設定変更");
    saveState();
  });

  controls.cumulative.addEventListener("change", (e) => {
    state.settings.cumulative = e.target.checked;
    setStatus("設定変更");
    saveState();
  });

  const nameHandler = (side, member) => (e) => {
    state.players[side][member] = e.target.value;
    setStatus("名前更新");
    saveState();
  };

  controls.nameA1.addEventListener("input", nameHandler("A", "p1"));
  controls.nameA2.addEventListener("input", nameHandler("A", "p2"));
  controls.nameB1.addEventListener("input", nameHandler("B", "p1"));
  controls.nameB2.addEventListener("input", nameHandler("B", "p2"));
}

function init() {
  syncUI();
  bindEvents();
  setStatus("復元済み");
}

window.addEventListener("DOMContentLoaded", init);
