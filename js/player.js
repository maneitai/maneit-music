/* ============================= */
/* MANEIT MUSIC — PLAYER LOGIC+  */
/* (shuffle/repeat/prev/next/vol */
/*  viz + equalizer)             */
/* ============================= */

const audio = document.getElementById("audio");
const player = document.getElementById("player");
const titleEl = document.getElementById("player-title");
const playPauseBtn = document.getElementById("playPause");
const downloadMp3 = document.getElementById("downloadMp3");
const downloadWav = document.getElementById("downloadWav");

// Optional footer controls (must exist in HTML if you want them)
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleAllBtn = document.getElementById("shuffleAllBtn");
const shuffleArtistBtn = document.getElementById("shuffleArtistBtn");
const repeatBtn = document.getElementById("repeatBtn");
const vizBtn = document.getElementById("vizBtn");
const eqBtn = document.getElementById("eqBtn");
const vol = document.getElementById("vol");

// Visualizer panel (optional)
const vizPanel = document.getElementById("vizPanel");
const vizCanvas = document.getElementById("viz");
const vizCtx = vizCanvas ? vizCanvas.getContext("2d") : null;

// EQ panel (optional)
const eqPanel = document.getElementById("eqPanel");
const eqEnableBtn = document.getElementById("eqEnableBtn");
const eqResetBtn = document.getElementById("eqResetBtn");

const eq_pre = document.getElementById("eq_pre");
const eq_60 = document.getElementById("eq_60");
const eq_170 = document.getElementById("eq_170");
const eq_350 = document.getElementById("eq_350");
const eq_1000 = document.getElementById("eq_1000");
const eq_3500 = document.getElementById("eq_3500");

const val_pre = document.getElementById("val_pre");
const val_60 = document.getElementById("val_60");
const val_170 = document.getElementById("val_170");
const val_350 = document.getElementById("val_350");
const val_1000 = document.getElementById("val_1000");
const val_3500 = document.getElementById("val_3500");

let isPlaying = false;

// ===== Global playlist state (fed by ui.js) =====
let __LIBRARY__ = [];       // array of tracks (flattened)
let __ACTIVE_INDEX__ = -1;  // index in __LIBRARY__

let shuffleMode = "off";    // off | all | artist
let repeatMode = "off";     // off | one | all

let queue = [];
let queuePos = 0;

// ===== Web Audio graph state =====
let audioCtx = null;
let analyser = null;
let srcNode = null;
let rafId = 0;
let vizOn = false;

let eqEnabled = true;
let preGain = null;
let eqNodes = { f60:null, f170:null, f350:null, f1000:null, f3500:null };

// ===== LocalStorage keys =====
const LS = {
  VOL: "maneit_music_vol_v4",
  SHUFFLE: "maneit_music_shuffle_v4", // off|all|artist
  REPEAT: "maneit_music_repeat_v4",   // off|one|all
  VIZ: "maneit_music_viz_v4",         // 0|1
  EQ_OPEN: "maneit_music_eq_open_v4", // 0|1
  EQ_ENABLED: "maneit_music_eq_enabled_v4", // 0|1
  EQ_PRE: "maneit_music_eq_pre_v4",
  EQ_60: "maneit_music_eq_60_v4",
  EQ_170: "maneit_music_eq_170_v4",
  EQ_350: "maneit_music_eq_350_v4",
  EQ_1000: "maneit_music_eq_1000_v4",
  EQ_3500: "maneit_music_eq_3500_v4"
};

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function safeUrl(path) { try { return encodeURI(path); } catch { return path; } }

function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function persistState() {
  try {
    localStorage.setItem(LS.VOL, String(audio.volume));
    localStorage.setItem(LS.SHUFFLE, shuffleMode);
    localStorage.setItem(LS.REPEAT, repeatMode);
    localStorage.setItem(LS.VIZ, vizOn ? "1" : "0");

    if (eqPanel) localStorage.setItem(LS.EQ_OPEN, eqPanel.classList.contains("show") ? "1" : "0");
    localStorage.setItem(LS.EQ_ENABLED, eqEnabled ? "1" : "0");

    if (eq_pre) localStorage.setItem(LS.EQ_PRE, String(eq_pre.value));
    if (eq_60) localStorage.setItem(LS.EQ_60, String(eq_60.value));
    if (eq_170) localStorage.setItem(LS.EQ_170, String(eq_170.value));
    if (eq_350) localStorage.setItem(LS.EQ_350, String(eq_350.value));
    if (eq_1000) localStorage.setItem(LS.EQ_1000, String(eq_1000.value));
    if (eq_3500) localStorage.setItem(LS.EQ_3500, String(eq_3500.value));
  } catch {}
}

function loadState() {
  try {
    const v = parseFloat(localStorage.getItem(LS.VOL));
    if (isFinite(v)) audio.volume = clamp(v, 0, 1);

    const sm = localStorage.getItem(LS.SHUFFLE);
    if (sm === "off" || sm === "all" || sm === "artist") shuffleMode = sm;

    const rm = localStorage.getItem(LS.REPEAT);
    if (rm === "off" || rm === "one" || rm === "all") repeatMode = rm;

    vizOn = localStorage.getItem(LS.VIZ) === "1";
    eqEnabled = localStorage.getItem(LS.EQ_ENABLED) !== "0";

    if (eq_pre)  { const x = localStorage.getItem(LS.EQ_PRE);   if (x !== null) eq_pre.value = x; }
    if (eq_60)   { const x = localStorage.getItem(LS.EQ_60);    if (x !== null) eq_60.value = x; }
    if (eq_170)  { const x = localStorage.getItem(LS.EQ_170);   if (x !== null) eq_170.value = x; }
    if (eq_350)  { const x = localStorage.getItem(LS.EQ_350);   if (x !== null) eq_350.value = x; }
    if (eq_1000) { const x = localStorage.getItem(LS.EQ_1000);  if (x !== null) eq_1000.value = x; }
    if (eq_3500) { const x = localStorage.getItem(LS.EQ_3500);  if (x !== null) eq_3500.value = x; }
  } catch {}
}

function setMiniOn(btn, on) {
  if (!btn) return;
  btn.classList.toggle("on", !!on);
  btn.setAttribute("aria-pressed", String(!!on));
}

function applyShuffleUI() {
  setMiniOn(shuffleAllBtn, shuffleMode === "all");
  setMiniOn(shuffleArtistBtn, shuffleMode === "artist");
}

function applyRepeatUI() {
  if (!repeatBtn) return;
  repeatBtn.dataset.mode = repeatMode;
  repeatBtn.textContent =
    repeatMode === "off" ? "Repeat: Off" :
    repeatMode === "one" ? "Repeat: One" :
    "Repeat: All";
  audio.loop = (repeatMode === "one");
}

function cycleRepeat() {
  const order = ["off", "one", "all"];
  repeatMode = order[(order.indexOf(repeatMode) + 1) % order.length];
  applyRepeatUI();
  persistState();
}

function currentArtistKey() {
  const t = __LIBRARY__[__ACTIVE_INDEX__];
  if (!t) return null;
  return (t.artist || t.projectTitle || "").trim().toLowerCase() || null;
}

function buildQueueFromCurrent() {
  if (!__LIBRARY__.length || __ACTIVE_INDEX__ < 0) return;

  let candidates = [];

  if (shuffleMode === "all") {
    candidates = __LIBRARY__.map((_, i) => i).filter(i => i !== __ACTIVE_INDEX__);
  } else if (shuffleMode === "artist") {
    const key = currentArtistKey();
    candidates = __LIBRARY__
      .map((it, i) => ({ it, i }))
      .filter(x => x.i !== __ACTIVE_INDEX__)
      .filter(x => ((x.it.artist || x.it.projectTitle || "").trim().toLowerCase()) === key)
      .map(x => x.i);
  } else {
    queue = [];
    queuePos = 0;
    return;
  }

  fisherYates(candidates);
  queue = [__ACTIVE_INDEX__, ...candidates];
  queuePos = 0;
}

function setShuffleMode(mode) {
  shuffleMode = mode; // off|all|artist
  applyShuffleUI();
  if (shuffleMode !== "off") buildQueueFromCurrent();
  else { queue = []; queuePos = 0; }
  persistState();
}

// ===== Web Audio / EQ / Viz =====
function dbToGain(db) { return Math.pow(10, db / 20); }
function disconnectSafe(node) { try { node.disconnect(); } catch {} }

function setDbLabel(el, v) {
  if (!el) return;
  const n = Math.round(parseFloat(v) * 10) / 10;
  el.textContent = `${n} dB`;
}

function syncEqLabels() {
  if (eq_pre) setDbLabel(val_pre, eq_pre.value);
  if (eq_60) setDbLabel(val_60, eq_60.value);
  if (eq_170) setDbLabel(val_170, eq_170.value);
  if (eq_350) setDbLabel(val_350, eq_350.value);
  if (eq_1000) setDbLabel(val_1000, eq_1000.value);
  if (eq_3500) setDbLabel(val_3500, eq_3500.value);
}

function applyEqSettings() {
  if (!audioCtx) return;

  const preDb = parseFloat(eq_pre ? eq_pre.value : "0");
  if (preGain) preGain.gain.value = dbToGain(isFinite(preDb) ? preDb : 0);

  if (eqNodes.f60 && eq_60) eqNodes.f60.gain.value = parseFloat(eq_60.value);
  if (eqNodes.f170 && eq_170) eqNodes.f170.gain.value = parseFloat(eq_170.value);
  if (eqNodes.f350 && eq_350) eqNodes.f350.gain.value = parseFloat(eq_350.value);
  if (eqNodes.f1000 && eq_1000) eqNodes.f1000.gain.value = parseFloat(eq_1000.value);
  if (eqNodes.f3500 && eq_3500) eqNodes.f3500.gain.value = parseFloat(eq_3500.value);
}

function applyEqToGraph() {
  if (!audioCtx || !srcNode || !analyser) return;

  disconnectSafe(srcNode);
  if (preGain) disconnectSafe(preGain);
  Object.values(eqNodes).forEach(n => { if (n) disconnectSafe(n); });
  disconnectSafe(analyser);

  if (eqEnabled) {
    srcNode.connect(preGain);
    preGain.connect(eqNodes.f60);
    eqNodes.f60.connect(eqNodes.f170);
    eqNodes.f170.connect(eqNodes.f350);
    eqNodes.f350.connect(eqNodes.f1000);
    eqNodes.f1000.connect(eqNodes.f3500);
    eqNodes.f3500.connect(analyser);
    analyser.connect(audioCtx.destination);
  } else {
    srcNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
}

async function ensureAudioGraph() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch {} }

  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
  }

  if (!preGain) {
    preGain = audioCtx.createGain();
    preGain.gain.value = dbToGain(parseFloat(eq_pre ? eq_pre.value : "0"));
  }

  if (!eqNodes.f60) {
    eqNodes.f60 = audioCtx.createBiquadFilter();
    eqNodes.f60.type = "lowshelf";
    eqNodes.f60.frequency.value = 60;
    eqNodes.f60.gain.value = parseFloat(eq_60 ? eq_60.value : "0");
  }
  if (!eqNodes.f170) {
    eqNodes.f170 = audioCtx.createBiquadFilter();
    eqNodes.f170.type = "peaking";
    eqNodes.f170.frequency.value = 170;
    eqNodes.f170.Q.value = 1.0;
    eqNodes.f170.gain.value = parseFloat(eq_170 ? eq_170.value : "0");
  }
  if (!eqNodes.f350) {
    eqNodes.f350 = audioCtx.createBiquadFilter();
    eqNodes.f350.type = "peaking";
    eqNodes.f350.frequency.value = 350;
    eqNodes.f350.Q.value = 1.0;
    eqNodes.f350.gain.value = parseFloat(eq_350 ? eq_350.value : "0");
  }
  if (!eqNodes.f1000) {
    eqNodes.f1000 = audioCtx.createBiquadFilter();
    eqNodes.f1000.type = "peaking";
    eqNodes.f1000.frequency.value = 1000;
    eqNodes.f1000.Q.value = 1.0;
    eqNodes.f1000.gain.value = parseFloat(eq_1000 ? eq_1000.value : "0");
  }
  if (!eqNodes.f3500) {
    eqNodes.f3500 = audioCtx.createBiquadFilter();
    eqNodes.f3500.type = "highshelf";
    eqNodes.f3500.frequency.value = 3500;
    eqNodes.f3500.gain.value = parseFloat(eq_3500 ? eq_3500.value : "0");
  }

  if (!srcNode) {
    try { srcNode = audioCtx.createMediaElementSource(audio); }
    catch (e) { console.warn("createMediaElementSource failed:", e); }
  }

  applyEqToGraph();
  applyEqSettings();
}

function startViz() {
  if (!vizOn || !analyser || !vizCanvas || !vizCtx) return;
  cancelAnimationFrame(rafId);

  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const cssW = vizCanvas.clientWidth || 600;
  const cssH = 120;

  vizCanvas.width = cssW * dpr;
  vizCanvas.height = cssH * dpr;
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const data = new Uint8Array(analyser.frequencyBinCount);

  const draw = () => {
    rafId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);

    vizCtx.clearRect(0, 0, cssW, cssH);

    vizCtx.globalAlpha = 0.35;
    vizCtx.fillStyle = "rgba(110,231,255,0.15)";
    vizCtx.fillRect(0, cssH - 1, cssW, 1);
    vizCtx.globalAlpha = 1;

    const bars = 90;
    const step = Math.floor(data.length / bars);
    const barW = cssW / bars;

    for (let i = 0; i < bars; i++) {
      const v = data[i * step] / 255;
      const h = Math.max(2, v * cssH);
      vizCtx.globalAlpha = 0.20 + v * 0.70;
      vizCtx.fillStyle = "rgba(232,237,247,0.95)";
      vizCtx.fillRect(i * barW + 1, cssH - h, Math.max(1, barW - 2), h);
    }
    vizCtx.globalAlpha = 1;
  };

  draw();
}

function stopViz() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function openViz(open) {
  if (!vizPanel || !vizBtn) return;
  vizOn = !!open;
  vizPanel.classList.toggle("show", vizOn);
  vizPanel.setAttribute("aria-hidden", String(!vizOn));
  vizBtn.classList.toggle("on", vizOn);
  vizBtn.setAttribute("aria-expanded", String(vizOn));
  if (!vizOn) stopViz();
  else if (analyser) startViz();
  persistState();
}

function openEq(open) {
  if (!eqPanel || !eqBtn) return;
  const on = !!open;
  eqPanel.classList.toggle("show", on);
  eqPanel.setAttribute("aria-hidden", String(!on));
  eqBtn.classList.toggle("on", on);
  eqBtn.setAttribute("aria-expanded", String(on));
  persistState();
}

function setEqEnabled(on) {
  eqEnabled = !!on;
  if (eqEnableBtn) {
    eqEnableBtn.classList.toggle("on", eqEnabled);
    eqEnableBtn.setAttribute("aria-pressed", String(eqEnabled));
    eqEnableBtn.textContent = eqEnabled ? "EQ: On" : "EQ: Off";
  }
  applyEqToGraph();
  persistState();
}

function resetEq() {
  if (!eq_pre) return;
  eq_pre.value = "0";
  eq_60.value = "0";
  eq_170.value = "0";
  eq_350.value = "0";
  eq_1000.value = "0";
  eq_3500.value = "0";
  syncEqLabels();
  applyEqSettings();
  persistState();
}

// ===== Core API: playTrack(track) =====
// track object is expected to have:
// { title, mp3, wav?, artist?, projectTitle? }
async function playTrack(track) {
  if (!track || !track.mp3) return;

  // Find and set active index if possible
  if (typeof track.__libIndex === "number") {
    __ACTIVE_INDEX__ = track.__libIndex;
  } else {
    // fallback: match by mp3
    const idx = __LIBRARY__.findIndex(t => t.mp3 === track.mp3);
    __ACTIVE_INDEX__ = idx;
  }

  if (shuffleMode !== "off") buildQueueFromCurrent();

  audio.src = safeUrl(track.mp3);

  titleEl.textContent = track.title || "—";

  if (downloadMp3) downloadMp3.href = safeUrl(track.mp3);
  if (downloadMp3) downloadMp3.setAttribute("download", (track.title || "track") + ".mp3");

  if (downloadWav) {
    if (track.wav) {
      downloadWav.href = safeUrl(track.wav);
      downloadWav.setAttribute("download", (track.title || "track") + ".wav");
      downloadWav.style.display = "";
    } else {
      // hide if no wav for this track
      downloadWav.href = "#";
      downloadWav.style.display = "none";
    }
  }

  try {
    await ensureAudioGraph();
    await audio.play();
    playPauseBtn.textContent = "Pause";
    player.hidden = false;
    isPlaying = true;
    if (vizOn) startViz();
  } catch (e) {
    // keep UI usable even if autoplay blocked
    playPauseBtn.textContent = "Play";
    isPlaying = false;
    console.warn("play() failed:", e);
  }
}

// ===== Allow ui.js to set global library =====
function setLibrary(flattenedTracks) {
  __LIBRARY__ = Array.isArray(flattenedTracks) ? flattenedTracks : [];
}

// ===== Navigation =====
function nextTrack() {
  if (!__LIBRARY__.length) return;

  if (shuffleMode !== "off") {
    if (!queue.length) buildQueueFromCurrent();
    queuePos++;

    // If artist shuffle has no candidates, queue will be just [current]
    if (queue.length <= 1) {
      if (repeatMode === "all") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      audio.pause();
      isPlaying = false;
      playPauseBtn.textContent = "Play";
      return;
    }

    if (queuePos >= queue.length) {
      if (repeatMode === "all") {
        buildQueueFromCurrent();
        queuePos = 0;
      } else {
        audio.pause();
        isPlaying = false;
        playPauseBtn.textContent = "Play";
        return;
      }
    }

    const idx = queue[queuePos];
    playTrack(__LIBRARY__[idx]);
    return;
  }

  let idx = __ACTIVE_INDEX__ + 1;
  if (idx >= __LIBRARY__.length) {
    if (repeatMode === "all") idx = 0;
    else {
      audio.pause();
      isPlaying = false;
      playPauseBtn.textContent = "Play";
      return;
    }
  }

  playTrack(__LIBRARY__[idx]);
}

function prevTrack() {
  if (!__LIBRARY__.length) return;

  // standard behavior: if >3s into track, restart
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  if (shuffleMode !== "off") {
    if (!queue.length) buildQueueFromCurrent();
    queuePos = Math.max(0, queuePos - 1);
    const idx = queue[queuePos];
    playTrack(__LIBRARY__[idx]);
    return;
  }

  let idx = __ACTIVE_INDEX__ - 1;
  if (idx < 0) {
    if (repeatMode === "all") idx = __LIBRARY__.length - 1;
    else idx = 0;
  }

  playTrack(__LIBRARY__[idx]);
}

// ===== Play/Pause (keeps your original behavior) =====
playPauseBtn.addEventListener("click", async () => {
  if (!audio.src) return;

  if (isPlaying) {
    audio.pause();
    playPauseBtn.textContent = "Play";
    isPlaying = false;
  } else {
    try {
      await ensureAudioGraph();
      await audio.play();
      playPauseBtn.textContent = "Pause";
      isPlaying = true;
      if (vizOn) startViz();
    } catch (e) {
      console.warn("play() failed:", e);
      playPauseBtn.textContent = "Play";
      isPlaying = false;
    }
  }
});

// ===== Optional controls wiring (only if the elements exist) =====
if (prevBtn) prevBtn.addEventListener("click", () => prevTrack());
if (nextBtn) nextBtn.addEventListener("click", () => nextTrack());

if (shuffleAllBtn) shuffleAllBtn.addEventListener("click", () => {
  setShuffleMode(shuffleMode === "all" ? "off" : "all");
});

if (shuffleArtistBtn) shuffleArtistBtn.addEventListener("click", () => {
  setShuffleMode(shuffleMode === "artist" ? "off" : "artist");
});

if (repeatBtn) repeatBtn.addEventListener("click", () => cycleRepeat());

if (vizBtn && vizPanel) vizBtn.addEventListener("click", () => openViz(!vizPanel.classList.contains("show")));
if (eqBtn && eqPanel) eqBtn.addEventListener("click", () => openEq(!eqPanel.classList.contains("show")));

if (eqEnableBtn) eqEnableBtn.addEventListener("click", () => setEqEnabled(!eqEnabled));
if (eqResetBtn) eqResetBtn.addEventListener("click", () => resetEq());

if (vol) {
  vol.addEventListener("input", () => {
    audio.volume = clamp(parseFloat(vol.value), 0, 1);
    persistState();
  });
  audio.addEventListener("volumechange", () => {
    vol.value = String(audio.volume);
  });
}

// EQ sliders
const eqInputs = [eq_pre, eq_60, eq_170, eq_350, eq_1000, eq_3500].filter(Boolean);
eqInputs.forEach(inp => {
  inp.addEventListener("input", () => {
    syncEqLabels();
    applyEqSettings();
    persistState();
  });
});

// Audio ended => next (if repeat all or shuffle)
audio.addEventListener("ended", () => {
  if (repeatMode === "one") return; // native loop handles it
  if (repeatMode === "all" || shuffleMode !== "off") nextTrack();
  else {
    isPlaying = false;
    playPauseBtn.textContent = "Play";
    stopViz();
  }
});

// ===== Init persisted state =====
loadState();
if (vol) vol.value = String(audio.volume);
applyShuffleUI();
applyRepeatUI();
syncEqLabels();

// restore panels
if (vizOn && vizPanel) openViz(true);
if (eqPanel && localStorage.getItem(LS.EQ_OPEN) === "1") openEq(true);
setEqEnabled(eqEnabled);

// Expose minimal API for ui.js (global)
window.ManeitPlayer = {
  playTrack,
  setLibrary
};
