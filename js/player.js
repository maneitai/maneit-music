/* ==========================================================
   MANEIT MUSIC — player.js (v2)
   - Shuffle: All / Artist
   - Repeat: Off / One / All
   - 10-band EQ + Preamp (31Hz → 16kHz, ±12dB)
   - CORS-safe: WebAudio only if allowed; sound ALWAYS works
   ========================================================== */

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // UI elems
  const player = $("player");
  const audio = $("audio");

  const titleEl = $("player-title");
  const playPauseBtn = $("playPause");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");

  const shuffleAllBtn = $("shuffleAllBtn");
  const shuffleArtistBtn = $("shuffleArtistBtn");
  const repeatBtn = $("repeatBtn");

  const eqBtn = $("eqBtn");
  const eqPanel = $("eqPanel");
  const eqEnableBtn = $("eqEnableBtn");
  const eqResetBtn = $("eqResetBtn");

  const downloadMp3 = $("downloadMp3");

  const progress = $("progress");
  const timeNowEl = $("time-now");
  const timeTotalEl = $("time-total");

  const vol = $("vol");
  const audioError = $("audioError");

  // EQ sliders
  const eq_pre = $("eq_pre");
  const eq_31 = $("eq_31");
  const eq_62 = $("eq_62");
  const eq_125 = $("eq_125");
  const eq_250 = $("eq_250");
  const eq_500 = $("eq_500");
  const eq_1000 = $("eq_1000");
  const eq_2000 = $("eq_2000");
  const eq_4000 = $("eq_4000");
  const eq_8000 = $("eq_8000");
  const eq_16000 = $("eq_16000");

  const val_pre = $("val_pre");
  const val_31 = $("val_31");
  const val_62 = $("val_62");
  const val_125 = $("val_125");
  const val_250 = $("val_250");
  const val_500 = $("val_500");
  const val_1000 = $("val_1000");
  const val_2000 = $("val_2000");
  const val_4000 = $("val_4000");
  const val_8000 = $("val_8000");
  const val_16000 = $("val_16000");

  // Storage keys
  const LS = {
    VOL: "maneit_music_vol_v3",
    SHUFFLE: "maneit_music_shuffle_v3", // off|all|artist
    REPEAT: "maneit_music_repeat_v3",   // off|one|all
    EQ_OPEN: "maneit_music_eq_open_v3",
    EQ_ENABLED: "maneit_music_eq_enabled_v3",
    EQ_PRE: "maneit_music_eq_pre_v3",
    EQ_31: "maneit_music_eq_31_v3",
    EQ_62: "maneit_music_eq_62_v3",
    EQ_125: "maneit_music_eq_125_v3",
    EQ_250: "maneit_music_eq_250_v3",
    EQ_500: "maneit_music_eq_500_v3",
    EQ_1000: "maneit_music_eq_1000_v3",
    EQ_2000: "maneit_music_eq_2000_v3",
    EQ_4000: "maneit_music_eq_4000_v3",
    EQ_8000: "maneit_music_eq_8000_v3",
    EQ_16000: "maneit_music_eq_16000_v3"
  };

  // State
  let library = [];
  let activeIndex = -1;
  let isPlaying = false;

  let shuffleMode = "off"; // off|all|artist
  let repeatMode = "off";  // off|one|all

  let queue = [];
  let queuePos = 0;

  // WebAudio/EQ state
  let audioCtx = null;
  let srcNode = null;
  let preGain = null;
  let filters = []; // 10 filters
  let eqEnabled = true;
  let webAudioAllowed = false; // only true if CORS check passes for current track

  // Helpers
  function showError(msg) {
    if (!audioError) return;
    audioError.style.display = "block";
    audioError.innerHTML = `<strong>AUDIO</strong>\n${msg}`;
  }
  function clearError() {
    if (!audioError) return;
    audioError.style.display = "none";
    audioError.textContent = "";
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function safeUrl(path) {
    try {
      const s = String(path || "").trim();
      return encodeURI(s.replace(/([^:]\/)\/+/g, "$1"));
    } catch {
      return path;
    }
  }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function dbToGain(db) { return Math.pow(10, (db || 0) / 20); }

  async function corsAllowsWebAudio(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        headers: { "Range": "bytes=0-0" }
      });
      return res && (res.status === 206 || res.status === 200);
    } catch {
      return false;
    }
  }

  function currentTrack() {
    return (activeIndex >= 0 && activeIndex < library.length) ? library[activeIndex] : null;
  }

  function currentArtistKey() {
    const t = currentTrack();
    if (!t) return null;
    return String(t.artist || t.projectTitle || "").trim().toLowerCase() || null;
  }

  function fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildQueueFromCurrent() {
    if (!library.length || activeIndex < 0) return;

    let candidates = [];
    if (shuffleMode === "all") {
      candidates = library.map((_, i) => i).filter(i => i !== activeIndex);
    } else if (shuffleMode === "artist") {
      const key = currentArtistKey();
      candidates = library
        .map((it, i) => ({ it, i }))
        .filter(x => x.i !== activeIndex)
        .filter(x => String(x.it.artist || x.it.projectTitle || "").trim().toLowerCase() === key)
        .map(x => x.i);
    } else {
      queue = [];
      queuePos = 0;
      return;
    }

    fisherYates(candidates);
    queue = [activeIndex, ...candidates];
    queuePos = 0;
  }

  function applyShuffleUI() {
    shuffleAllBtn.classList.toggle("on", shuffleMode === "all");
    shuffleArtistBtn.classList.toggle("on", shuffleMode === "artist");
    shuffleAllBtn.setAttribute("aria-pressed", String(shuffleMode === "all"));
    shuffleArtistBtn.setAttribute("aria-pressed", String(shuffleMode === "artist"));
  }

  function applyRepeatUI() {
    repeatBtn.dataset.mode = repeatMode;
    repeatBtn.textContent =
      repeatMode === "off" ? "Repeat: Off" :
      repeatMode === "one" ? "Repeat: One" :
      "Repeat: All";
    audio.loop = (repeatMode === "one");
  }

  function setShuffleMode(mode) {
    shuffleMode = mode;
    try { localStorage.setItem(LS.SHUFFLE, shuffleMode); } catch {}
    applyShuffleUI();
    if (shuffleMode !== "off") buildQueueFromCurrent();
    else { queue = []; queuePos = 0; }
  }

  function cycleRepeat() {
    const order = ["off", "one", "all"];
    repeatMode = order[(order.indexOf(repeatMode) + 1) % order.length];
    try { localStorage.setItem(LS.REPEAT, repeatMode); } catch {}
    applyRepeatUI();
  }

  // EQ UI helpers
  const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const eqSliders = [eq_31, eq_62, eq_125, eq_250, eq_500, eq_1000, eq_2000, eq_4000, eq_8000, eq_16000];
  const eqVals = [val_31, val_62, val_125, val_250, val_500, val_1000, val_2000, val_4000, val_8000, val_16000];

  function setEqLabel(el, v) {
    const n = Math.round(parseFloat(v) * 10) / 10;
    el.textContent = `${n} dB`;
  }

  function syncEqLabels() {
    setEqLabel(val_pre, eq_pre.value);
    for (let i = 0; i < eqSliders.length; i++) setEqLabel(eqVals[i], eqSliders[i].value);
  }

  function persistEq() {
    try {
      localStorage.setItem(LS.EQ_ENABLED, eqEnabled ? "1" : "0");
      localStorage.setItem(LS.EQ_PRE, String(eq_pre.value));
      localStorage.setItem(LS.EQ_31, String(eq_31.value));
      localStorage.setItem(LS.EQ_62, String(eq_62.value));
      localStorage.setItem(LS.EQ_125, String(eq_125.value));
      localStorage.setItem(LS.EQ_250, String(eq_250.value));
      localStorage.setItem(LS.EQ_500, String(eq_500.value));
      localStorage.setItem(LS.EQ_1000, String(eq_1000.value));
      localStorage.setItem(LS.EQ_2000, String(eq_2000.value));
      localStorage.setItem(LS.EQ_4000, String(eq_4000.value));
      localStorage.setItem(LS.EQ_8000, String(eq_8000.value));
      localStorage.setItem(LS.EQ_16000, String(eq_16000.value));
    } catch {}
  }

  function loadEq() {
    try {
      const v = localStorage.getItem(LS.EQ_PRE); if (v != null) eq_pre.value = v;
      const k = [
        [LS.EQ_31, eq_31],[LS.EQ_62, eq_62],[LS.EQ_125, eq_125],[LS.EQ_250, eq_250],[LS.EQ_500, eq_500],
        [LS.EQ_1000, eq_1000],[LS.EQ_2000, eq_2000],[LS.EQ_4000, eq_4000],[LS.EQ_8000, eq_8000],[LS.EQ_16000, eq_16000],
      ];
      k.forEach(([key, el]) => {
        const s = localStorage.getItem(key);
        if (s != null) el.value = s;
      });

      eqEnabled = localStorage.getItem(LS.EQ_ENABLED) !== "0";
    } catch {}
    syncEqLabels();
  }

  function setEqEnabled(on) {
    eqEnabled = !!on;
    eqEnableBtn.classList.toggle("on", eqEnabled);
    eqEnableBtn.setAttribute("aria-pressed", String(eqEnabled));
    eqEnableBtn.textContent = eqEnabled ? "EQ: On" : "EQ: Off";
    persistEq();
    reconnectAudioGraph();
  }

  function resetEq() {
    eq_pre.value = "0";
    eqSliders.forEach(s => s.value = "0");
    syncEqLabels();
    persistEq();
    applyEqSettings();
  }

  function openEq(open) {
    const shouldOpen = !!open;

    // if WebAudio isn't allowed, keep EQ closed and show locked state
    if (shouldOpen && !webAudioAllowed) {
      eqBtn.classList.add("locked");
      eqBtn.textContent = "EQ: Locked (CORS)";
      showError("EQ locked: enable CORS headers on the MP3 host to use WebAudio EQ.");
      return;
    }

    eqPanel.classList.toggle("show", shouldOpen);
    eqPanel.setAttribute("aria-hidden", String(!shouldOpen));
    eqBtn.setAttribute("aria-expanded", String(shouldOpen));
    eqBtn.classList.toggle("on", shouldOpen);
    try { localStorage.setItem(LS.EQ_OPEN, shouldOpen ? "1" : "0"); } catch {}
  }

  async function ensureAudioGraph() {
    if (!webAudioAllowed) return false;

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch {} }

    // Create source ONLY when allowed (prevents silent-output bug)
    if (!srcNode) srcNode = audioCtx.createMediaElementSource(audio);

    if (!preGain) {
      preGain = audioCtx.createGain();
      preGain.gain.value = dbToGain(parseFloat(eq_pre.value));
    }

    if (!filters.length) {
      filters = EQ_FREQS.map((hz, i) => {
        const f = audioCtx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = hz;
        f.Q.value = 1.0;
        f.gain.value = parseFloat(eqSliders[i].value);
        return f;
      });
    }

    reconnectAudioGraph();
    applyEqSettings();
    return true;
  }

  function disconnectSafe(node) { try { node.disconnect(); } catch {} }

  function reconnectAudioGraph() {
    if (!audioCtx || !srcNode) return;

    // Disconnect chain
    disconnectSafe(srcNode);
    if (preGain) disconnectSafe(preGain);
    filters.forEach(disconnectSafe);

    // Connect
    if (webAudioAllowed && eqEnabled && preGain && filters.length) {
      srcNode.connect(preGain);
      let last = preGain;
      for (const f of filters) { last.connect(f); last = f; }
      last.connect(audioCtx.destination);
    } else if (webAudioAllowed) {
      srcNode.connect(audioCtx.destination);
    }
  }

  function applyEqSettings() {
    if (!webAudioAllowed) return;
    if (preGain) preGain.gain.value = dbToGain(parseFloat(eq_pre.value) || 0);
    for (let i = 0; i < filters.length; i++) {
      filters[i].gain.value = parseFloat(eqSliders[i].value) || 0;
    }
  }

  function setActiveUI(track) {
    // row highlight
    library.forEach(t => t.rowEl && t.rowEl.classList.remove("is-playing"));
    library.forEach(t => t.playBtnEl && (t.playBtnEl.textContent = "Play"));

    if (track.rowEl) track.rowEl.classList.add("is-playing");
    if (track.playBtnEl) track.playBtnEl.textContent = "Pause";

    titleEl.textContent = track.title || "—";

    const src = track.mp3 || track.wav || "#";
    downloadMp3.href = safeUrl(src);
    downloadMp3.setAttribute("download", (track.title || "track") + (track.mp3 ? ".mp3" : ".wav"));

    player.hidden = false;
  }

  async function playIndex(i) {
    const t = library[i];
    if (!t) return;

    clearError();
    activeIndex = i;

    // Always normal audio playback works
    audio.crossOrigin = "anonymous";
    audio.muted = false;
    if (!isFinite(audio.volume) || audio.volume <= 0) audio.volume = 0.9;

    const src = t.mp3 || t.wav;
    const url = safeUrl(src);

    setActiveUI(t);

    // Determine whether WebAudio is allowed for THIS file
    webAudioAllowed = await corsAllowsWebAudio(url);

    // Update EQ button state based on allowed
    if (webAudioAllowed) {
      eqBtn.classList.remove("locked");
      eqBtn.textContent = "EQ";
    } else {
      eqBtn.classList.add("locked");
      eqBtn.textContent = "EQ: Locked (CORS)";
      // close panel if open
      openEq(false);
    }

    audio.src = url;

    try {
      // If allowed, build graph before play (safe)
      if (webAudioAllowed) await ensureAudioGraph();

      await audio.play();
      isPlaying = true;
      playPauseBtn.textContent = "Pause";

      // rebuild queue for shuffles
      if (shuffleMode !== "off") buildQueueFromCurrent();

    } catch (e) {
      isPlaying = false;
      playPauseBtn.textContent = "Play";
      showError(`play() failed.\n${String(e)}\n\nURL:\n${url}`);
    }
  }

  function pause() {
    audio.pause();
    isPlaying = false;
    playPauseBtn.textContent = "Play";

    const t = currentTrack();
    if (t?.playBtnEl) t.playBtnEl.textContent = "Play";
    if (t?.rowEl) t.rowEl.classList.remove("is-playing");
  }

  function togglePlayPause() {
    if (!audio.src) return;

    if (isPlaying) {
      pause();
      return;
    }

    audio.play().then(() => {
      isPlaying = true;
      playPauseBtn.textContent = "Pause";
      const t = currentTrack();
      if (t?.playBtnEl) t.playBtnEl.textContent = "Pause";
      if (t?.rowEl) t.rowEl.classList.add("is-playing");
    }).catch(e => showError(`play() failed.\n${String(e)}\n\nURL:\n${audio.src}`));
  }

  function next() {
    if (!library.length) return;

    if (shuffleMode !== "off") {
      if (!queue.length) buildQueueFromCurrent();
      queuePos++;

      if (queue.length <= 1) {
        if (repeatMode === "all") { audio.currentTime = 0; audio.play().catch(()=>{}); return; }
        pause(); return;
      }

      if (queuePos >= queue.length) {
        if (repeatMode === "all") { buildQueueFromCurrent(); queuePos = 0; }
        else { pause(); return; }
      }

      playIndex(queue[queuePos]);
      return;
    }

    let i = activeIndex + 1;
    if (i >= library.length) {
      if (repeatMode === "all") i = 0;
      else { pause(); return; }
    }
    playIndex(i);
  }

  function prev() {
    if (!library.length) return;

    if (audio.currentTime > 3) { audio.currentTime = 0; return; }

    if (shuffleMode !== "off") {
      if (!queue.length) buildQueueFromCurrent();
      queuePos = Math.max(0, queuePos - 1);
      playIndex(queue[queuePos]);
      return;
    }

    let i = activeIndex - 1;
    if (i < 0) i = (repeatMode === "all") ? library.length - 1 : 0;
    playIndex(i);
  }

  // Progress + time
  let scrubbing = false;

  audio.addEventListener("loadedmetadata", () => {
    timeTotalEl.textContent = fmtTime(audio.duration);
    timeNowEl.textContent = fmtTime(0);
    progress.value = "0";
  });

  audio.addEventListener("timeupdate", () => {
    if (scrubbing) return;
    timeNowEl.textContent = fmtTime(audio.currentTime);
    const d = audio.duration || 0;
    progress.value = d > 0 ? String(Math.round((audio.currentTime / d) * 1000)) : "0";
  });

  progress.addEventListener("pointerdown", () => { scrubbing = true; });
  progress.addEventListener("pointerup", () => { scrubbing = false; });

  progress.addEventListener("input", () => {
    const d = audio.duration || 0;
    if (d <= 0) return;
    const v = Number(progress.value) / 1000;
    timeNowEl.textContent = fmtTime(v * d);
  });

  progress.addEventListener("change", () => {
    const d = audio.duration || 0;
    if (d <= 0) return;
    audio.currentTime = (Number(progress.value) / 1000) * d;
  });

  audio.addEventListener("ended", () => {
    if (repeatMode === "one") return; // native loop
    if (repeatMode === "all" || shuffleMode !== "off") { next(); return; }
    isPlaying = false;
    playPauseBtn.textContent = "Play";
  });

  audio.addEventListener("error", () => {
    const code = audio.error ? audio.error.code : "unknown";
    showError(`Audio element error. code=${code}\n\nURL:\n${audio.src}`);
  });

  // Wire buttons
  playPauseBtn.addEventListener("click", togglePlayPause);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  shuffleAllBtn.addEventListener("click", () => setShuffleMode(shuffleMode === "all" ? "off" : "all"));
  shuffleArtistBtn.addEventListener("click", () => setShuffleMode(shuffleMode === "artist" ? "off" : "artist"));
  repeatBtn.addEventListener("click", cycleRepeat);

  eqBtn.addEventListener("click", () => openEq(!eqPanel.classList.contains("show")));
  eqEnableBtn.addEventListener("click", () => setEqEnabled(!eqEnabled));
  eqResetBtn.addEventListener("click", resetEq);

  // Volume restore
  try {
    const v = parseFloat(localStorage.getItem(LS.VOL));
    if (isFinite(v)) audio.volume = clamp(v, 0, 1);
  } catch {}
  vol.value = String(audio.volume || 0.9);

  vol.addEventListener("input", () => {
    audio.volume = clamp(parseFloat(vol.value), 0, 1);
    try { localStorage.setItem(LS.VOL, String(audio.volume)); } catch {}
  });
  audio.addEventListener("volumechange", () => { vol.value = String(audio.volume); });

  // EQ wire
  const eqInputs = [eq_pre, ...eqSliders];
  eqInputs.forEach(inp => {
    inp.addEventListener("input", () => {
      syncEqLabels();
      persistEq();
      applyEqSettings();
    });
  });

  // Restore modes + EQ state
  (function restoreState() {
    try {
      const sm = localStorage.getItem(LS.SHUFFLE);
      if (sm === "off" || sm === "all" || sm === "artist") shuffleMode = sm;

      const rm = localStorage.getItem(LS.REPEAT);
      if (rm === "off" || rm === "one" || rm === "all") repeatMode = rm;

      const open = localStorage.getItem(LS.EQ_OPEN) === "1";
      if (open) openEq(true);

    } catch {}

    applyShuffleUI();
    applyRepeatUI();

    loadEq();
    setEqEnabled(eqEnabled);
  })();

  // Public API for ui.js
  window.ManeitPlayer = {
    setLibrary(items) {
      library = Array.isArray(items) ? items : [];
    },
    playTrack(track) {
      if (!track || typeof track.__index !== "number") return Promise.resolve();
      return playIndex(track.__index);
    }
  };
})();
