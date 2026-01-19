const controls = {
  trainInput: document.getElementById("trainSeconds"),
  restInput: document.getElementById("restSeconds"),
  repeatModes: document.querySelectorAll('input[name="repeatMode"]'),
  display: document.getElementById("timerDisplay"),
  phase: document.getElementById("timerPhase"),
  start: document.getElementById("timerStartBtn"),
  pause: document.getElementById("timerPauseBtn"),
  stop: document.getElementById("timerStopBtn"),
};

let audioContext = null;

const state = {
  phase: "idle",
  isRunning: false,
  isPaused: false,
  remaining: 0,
  intervalId: null,
  durations: { training: 20, rest: 20 },
  repeat: true,
  lastEnded: false,
};

const getInputValue = (input, fallback) => {
  const value = Number.parseInt(input?.value ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return value;
};

const ensureAudio = () => {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  try {
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioContext = new Ctx();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return audioContext;
  } catch (e) {
    console.warn("AudioContext init failed", e);
    return null;
  }
};

const playTone = ({ frequency, duration = 0.1, volume = 0.08 }) => {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
};

const playBeep = () => playTone({ frequency: 640, duration: 0.08, volume: 0.07 });
const playWarning = () => playTone({ frequency: 1040, duration: 0.12, volume: 0.1 });
const playEnd = () => {
  playTone({ frequency: 1560, duration: 0.18, volume: 0.12 });
  setTimeout(() => {
    playTone({ frequency: 1560, duration: 0.18, volume: 0.12 });
  }, 220);
};

const updateUI = () => {
  let displayValue = state.remaining;
  if (!state.isRunning && !state.isPaused) {
    displayValue = state.lastEnded ? 0 : state.durations.training;
  }
  controls.display.textContent = String(Math.max(0, displayValue));

  let phaseLabel = "待機中";
  if (state.isRunning || state.isPaused) {
    const base = state.phase === "rest" ? "休憩" : "トレーニング";
    phaseLabel = state.isPaused ? `一時停止 (${base})` : base;
  }
  controls.phase.textContent = phaseLabel;
};

const syncDurations = () => {
  const training = Math.max(1, getInputValue(controls.trainInput, state.durations.training));
  const rest = Math.max(0, getInputValue(controls.restInput, state.durations.rest));
  state.durations = { training, rest };
  if (!state.isRunning && !state.isPaused) {
    state.remaining = state.lastEnded ? 0 : training;
  }
  state.lastEnded = false;
  updateUI();
};

const syncRepeatMode = () => {
  if (!controls.repeatModes?.length) return;
  const selected = Array.from(controls.repeatModes).find((input) => input.checked);
  state.repeat = selected?.value !== "off";
};

const stopTimer = ({ ended = false } = {}) => {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.isRunning = false;
  state.isPaused = false;
  state.phase = "idle";
  state.remaining = ended ? 0 : state.durations.training;
  state.lastEnded = ended;
  updateUI();
};

const tick = () => {
  if (!state.isRunning) return;
  state.remaining -= 1;
  if (state.remaining <= 0) {
    playEnd();
    if (state.phase === "training") {
      if (state.durations.rest > 0) {
        state.phase = "rest";
        state.remaining = state.durations.rest;
        updateUI();
        return;
      }
      if (state.repeat) {
        state.phase = "training";
        state.remaining = state.durations.training;
        updateUI();
        return;
      }
    }
    if (state.phase === "rest") {
      if (state.repeat) {
        state.phase = "training";
        state.remaining = state.durations.training;
        updateUI();
        return;
      }
    }
    stopTimer({ ended: true });
    return;
  }
  if (state.remaining <= 3) {
    playWarning();
  } else {
    playBeep();
  }
  updateUI();
};

const startTimer = () => {
  syncDurations();
  if (state.isRunning) return;
  if (state.isPaused) {
    state.isPaused = false;
  } else {
    state.phase = "training";
    state.remaining = state.durations.training;
  }
  state.lastEnded = false;
  if (state.remaining <= 0) return;
  ensureAudio();
  state.isRunning = true;
  state.intervalId = setInterval(tick, 1000);
  updateUI();
};

const pauseTimer = () => {
  if (!state.isRunning) return;
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.isRunning = false;
  state.isPaused = true;
  updateUI();
};

controls.start.addEventListener("click", startTimer);
controls.pause.addEventListener("click", pauseTimer);
controls.stop.addEventListener("click", () => stopTimer({ ended: false }));
controls.trainInput.addEventListener("input", syncDurations);
controls.trainInput.addEventListener("change", syncDurations);
controls.restInput.addEventListener("input", syncDurations);
controls.restInput.addEventListener("change", syncDurations);
controls.repeatModes.forEach((input) => {
  input.addEventListener("change", syncRepeatMode);
});

syncDurations();
syncRepeatMode();
