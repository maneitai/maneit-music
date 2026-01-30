/* ==========================================================
   MANEIT MUSIC — player.js (v3)
   - Shuffle: All / Artist
   - Repeat: Off / One / All
   - 10-band EQ + Preamp (31Hz → 16kHz, ±12dB)
   - Presets dropdown (~15) + Bass Boost toggle
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

  const presetSelect = $("presetSelect");
  const bassBtn = $("bassBtn");

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
    VOL: "maneit_music_vol_v4",
    SHUFFLE: "maneit_music_shuffle_v4", // off|all|artist
    REPEAT: "maneit_music_repeat_v4",   // off|one|all
    EQ_OPEN: "maneit_music_eq_open_v4",
    EQ_ENABLED: "maneit_music_eq_enabled_v4",
    PRESET: "maneit_music_preset_v4",
    BASS: "maneit_music_bassboost_v4", // 0|1
    EQ_PRE: "maneit_music_eq_pre_v4",
    EQ_31: "maneit_music_eq_31_v4",
    EQ_62: "maneit_music_eq_62_v4",
    EQ_125: "maneit_music_eq_125_v4",
    EQ_250: "maneit_music_eq_250_v4",
    EQ_500: "maneit_music_eq_500_v4",
    EQ_1000: "maneit_music_eq_1000_v4",
    EQ_2000: "maneit_music_eq_2000_v4",
    EQ_4000: "maneit_music_eq_4000_v4",
    EQ_8000: "maneit_music_eq_8000_v4",
    EQ_16000: "maneit_music_eq_16000_v4"
  };

  // State
  let library = [];
  let activeIndex = -1;
  let isPlaying = false;

  let shuffleMode = "off"; // off|all|artist
  let repeatMode = "off";  // off|one|all

  let queue = [];
  let queuePos = 0;

  // Presets state
  let presetKey = "custom";
  let bassBoostOn = false;

  // WebAudio/EQ state
  let audioCtx = null;
  let srcNode = null;
  let preGain = null;
  let filters = []; // 10 filters
  let eqEnabled = true;
  let webAudioAllowed = false; // true if CORS check passes for current track

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
    presetKey = "custom";
    setPresetSelect("custom");

    eq_pre.value = "0";
    eqSliders.forEach(s => s.value = "0");
    bassBoostOn = false;
    updateBassBtn();

    syncEqLabels();
    persistEq();
    savePresetState();
    applyEqSettings();
  }

  function openEq(open) {
    const shouldOpen = !!open;

    if (shouldOpen && !webAudioAllowed) {
      setEqLocked(true);
      showError("EQ locked: enable CORS headers on the MP3 host to use WebAudio EQ.");
      return;
    }

    eqPanel.classList.toggle("show", shouldOpen);
    eqPanel.setAttribute("aria-hidden", String(!shouldOpen));
    eqBtn.setAttribute("aria-expanded", String(shouldOpen));
    eqBtn.classList.toggle("on", shouldOpen);
    try { localStorage.setItem(LS.EQ_OPEN, shouldOpen ? "1" : "0"); } catch {}
  }

  function setEqLocked(locked) {
    // Lock/unlock EQ + presets UI
    const lock = !!locked;
    eqBtn.classList.toggle("locked", lock);
    presetSelect.disabled = lock;
    bassBtn.disabled = lock;

    if (lock) {
      eqBtn.textContent = "EQ: Locked (CORS)";
      bassBtn.classList.remove("on");
      bassBtn.setAttribute("aria-pressed", "false");
    } else {
      eqBtn.textContent = "EQ";
    }
  }

  // ===== Presets =====
  // gains array is [31,62,125,250,500,1k,2k,4k,8k,16k]
  const PRESETS = {
    flat:              { name: "Flat (Reference)", pre: 0.0,  gains: [0,0,0,0,0,0,0,0,0,0] },

    rap_808:           { name: "Rap / 808 (Clean Punch)", pre: -2.5, gains: [4.5,3.0,1.5,0,-0.5,-0.5,0.5,1.5,1.0,0.5] },
    trap_sub:          { name: "Trap (Sub + Snap)", pre: -3.0, gains: [5.5,3.5,1.0,-0.5,-1.0,0.5,1.5,2.0,1.0,0.0] },
    hagle_vocal:       { name: "Hagle / Norwegian Rap (Vocal Forward)", pre: -2.0, gains: [3.0,2.0,0.5,-0.5,-1.0,1.5,2.0,2.0,1.0,0.5] },

    eurodance:         { name: "Eurodance (Bright + Tight)", pre: -2.0, gains: [2.0,1.5,0.5,0.0,-0.5,1.0,2.5,3.0,2.0,1.0] },

    house:             { name: "House (Warm Groove)", pre: -2.0, gains: [3.0,2.0,1.0,0.0,-0.5,0.5,1.0,1.5,1.0,0.5] },
    deep_house:        { name: "Deep House (Warm + Smooth)", pre: -2.5, gains: [3.5,2.5,1.5,0.5,0.0,-0.5,0.0,0.8,0.8,0.5] },
    techno:            { name: "Techno (Mid Drive)", pre: -2.5, gains: [2.5,2.0,1.0,0.0,-0.5,1.0,2.0,1.5,1.0,0.5] },

    hardstyle:         { name: "Hardstyle (Kick + Bite)", pre: -4.0, gains: [5.0,3.0,0.0,-1.0,-1.0,1.0,2.5,3.0,1.5,0.5] },
    happy_hardstyle:   { name: "Happy Hardstyle (Bright + Pump)", pre: -4.0, gains: [4.5,2.5,0.0,-0.5,-0.5,1.5,3.0,3.5,2.0,1.0] },

    dnb:               { name: "DnB (Sub + Air)", pre: -3.0, gains: [4.5,3.0,1.0,-0.5,-1.0,0.5,1.5,2.5,2.0,1.0] },
    dubstep:           { name: "Dubstep (Wobble Weight)", pre: -4.0, gains: [6.0,3.5,0.0,-1.0,-1.5,0.5,1.0,2.0,1.5,0.5] },

    pop_clean:         { name: "Pop (Clean + Gloss)", pre: -2.0, gains: [2.0,1.0,0.0,0.0,0.0,1.0,2.0,2.0,1.5,1.0] },
    metal:             { name: "Metal (Crunch + Clarity)", pre: -3.0, gains: [2.0,1.0,0.0,0.5,1.0,1.5,2.0,1.0,0.0,0.0] },

    voice:             { name: "Voice / Podcast (Clear Speech)", pre: -1.5, gains: [-2.0,-1.0,0.0,1.0,2.0,2.5,2.0,1.0,0.0,-0.5] },
    night:             { name: "Night (Low Volume, Loudness-ish)", pre: -3.0, gains: [3.5,2.0,0.5,-0.5,-1.0,1.0,2.0,1.0,0.5,0.0] }
  };

  // Bass boost offsets (adds on top of preset/slider)
  // We keep it mild and also lower preamp to avoid clipping.
  function bassOffsets() {
    // +3dB @31, +2dB @62, +1dB @125, +0.5 @250
    return [3.0, 2.0, 1.0, 0.5, 0,0,0,0,0,0];
  }
  function bassPreComp() {
    // reduce preamp when bass boost is on
    return -2.0;
  }

  function fillPresetDropdown() {
    // Build options once
    presetSelect.innerHTML = "";
    const optCustom = document.createElement("option");
    optCustom.value = "custom";
    optCustom.textContent = "Preset: Custom";
    presetSelect.appendChild(optCustom);

    // Group-ish order
    const order = [
      "flat",
      "rap_808","trap_sub","hagle_vocal",
      "eurodance",
      "house","deep_house","techno",
      "hardstyle","happy_hardstyle",
      "dnb","dubstep",
      "pop_clean","metal",
      "voice","night"
    ];

    order.forEach(key => {
      const p = PRESETS[key];
      if (!p) return;
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `Preset: ${p.name}`;
      presetSelect.appendChild(opt);
    });
  }

  function setPresetSelect(key) {
    presetSelect.value = key;
  }

  function savePresetState() {
    try {
      localStorage.setItem(LS.PRESET, presetKey);
      localStorage.setItem(LS.BASS, bassBoostOn ? "1" : "0");
    } catch {}
  }

  function loadPresetState() {
    try {
      const p = localStorage.getItem(LS.PRESET);
      if (p) presetKey = p;
      bassBoostOn = localStorage.getItem(LS.BASS) === "1";
    } catch {}
  }

  function updateBassBtn() {
    bassBtn.classList.toggle("on", bassBoostOn);
    bassBtn.setAttribute("aria-pressed", bassBoostOn ? "true" : "false");
  }

  function applyPresetToSliders(key) {
    const p = PRESETS[key];
    if (!p) return;

    presetKey = key;
    setPresetSelect(key);

    const offsets = bassBoostOn ? bassOffsets() : Array(10).fill(0);
    const preAdj = bassBoostOn ? bassPreComp() : 0;

    // write slider values
    const basePre = p.pre + preAdj;
    eq_pre.value = String(clamp(basePre, -12, 12));

    for (let i = 0; i < 10; i++) {
      const v = (p.gains[i] || 0) + offsets[i];
      eqSliders[i].value = String(clamp(v, -12, 12));
    }

    syncEqLabels();
    persistEq();
    savePresetState();
    applyEqSettings();
  }

  function readSlidersAsCustom() {
    // User touched sliders manually -> custom
    presetKey = "custom";
    setPresetSelect("custom");
    savePresetState();
  }

  // ===== WebAudio graph =====
  async function ensureAudioGraph() {
    if (!webAudioAllowed) return false;

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch {} }

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

    disconnectSafe(srcNode);
    if (preGain) disconnectSafe(preGain);
    filters.forEach(disconnectSafe);

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

    if (webAudioAllowed) {
      setEqLocked(false);
    } else {
      setEqLocked(true);
      openEq(false);
    }

    audio.src = url;

    try {
      if (webAudioAllowed) await ensureAudioGraph();
      await audio.play();
      isPlaying = true;
      playPauseBtn.textContent = "Pause";

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

    if (isPlaying) { pause(); return; }

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
    if (repeatMode === "one") return;
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

  // EQ wire: manual move -> custom preset
  const eqInputs = [eq_pre, ...eqSliders];
  eqInputs.forEach(inp => {
    inp.addEventListener("input", () => {
      syncEqLabels();
      persistEq();
      applyEqSettings();
      readSlidersAsCustom();
    });
  });

  // Preset UI wire
  presetSelect.addEventListener("change", () => {
    const k = presetSelect.value;
    if (k === "custom") {
      presetKey = "custom";
      savePresetState();
      return;
    }
    applyPresetToSliders(k);
  });

  bassBtn.addEventListener("click", () => {
    if (bassBtn.disabled) return;
    bassBoostOn = !bassBoostOn;
    updateBassBtn();
    savePresetState();

    // Re-apply preset if any, otherwise just add offsets on top of current slider values (simple)
    if (presetKey !== "custom" && PRESETS[presetKey]) {
      applyPresetToSliders(presetKey);
    } else {
      // Custom: apply bass offsets directly to current slider values + preamp comp
      const off = bassOffsets();
      const preC = bassBoostOn ? bassPreComp() : 0;
      const preBase = parseFloat(eq_pre.value) || 0;
      eq_pre.value = String(clamp(preBase + preC, -12, 12));

      for (let i = 0; i < 10; i++) {
        const base = parseFloat(eqSliders[i].value) || 0;
        const add = bassBoostOn ? off[i] : -off[i];
        eqSliders[i].value = String(clamp(base + add, -12, 12));
      }
      syncEqLabels();
      persistEq();
      applyEqSettings();
      readSlidersAsCustom();
    }
  });

  // Restore modes + EQ state + preset state
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

    // fill presets + load state
    fillPresetDropdown();
    loadPresetState();
    setPresetSelect(presetKey);
    updateBassBtn();

    // EQ slider state
    loadEq();
    setEqEnabled(eqEnabled);

    // If a preset is selected (not custom), enforce it on sliders at load
    if (presetKey !== "custom" && PRESETS[presetKey]) {
      applyPresetToSliders(presetKey);
    } else {
      savePresetState();
    }
  })();

  // Public API for ui.js
  window.ManeitPlayer = {
    setLibrary(items) { library = Array.isArray(items) ? items : []; },
    playTrack(track) {
      if (!track || typeof track.__index !== "number") return Promise.resolve();
      return playIndex(track.__index);
    }
  };
})();
