/* ==========================================================
   MANEIT MUSIC — PLAYER (v5)
   - Docked bottom player (never blocks playlists)
   - 10-band EQ full range + preamp (±12 dB)
   - Shuffle (all/artist), repeat (off/one/all), prev/next
   - Robust URL handling (fixes accidental //)
   - Emits nowplaying events for UI
   ========================================================== */

(() => {
  "use strict";

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, String(v));
    }
    for (const c of children) n.appendChild(c);
    return n;
  };

  // preserve https:// but normalize accidental extra slashes elsewhere
  function safeUrl(path) {
    try {
      const s = String(path || "").trim();
      const normalized = s.replace(/([^:]\/)\/+/g, "$1");
      return encodeURI(normalized);
    } catch {
      return path;
    }
  }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ---------- LocalStorage ----------
  const LS = {
    VOL: "maneit_music_vol_v5",
    SHUFFLE: "maneit_music_shuffle_v5", // off|all|artist
    REPEAT: "maneit_music_repeat_v5",   // off|one|all
    EQ_OPEN: "maneit_music_eq_open_v5", // 0|1
    EQ_ENABLED: "maneit_music_eq_enabled_v5", // 0|1
    EQ_PRE: "maneit_music_eq_pre_v5",
    EQ_BANDS: "maneit_music_eq_bands_v5" // JSON array
  };

  // ---------- Global playlist state (fed by ui.js) ----------
  let __LIBRARY__ = [];       // flattened tracks
  let __ACTIVE_INDEX__ = -1;  // index in __LIBRARY__

  let shuffleMode = "off";    // off | all | artist
  let repeatMode = "off";     // off | one | all

  let queue = [];
  let queuePos = 0;

  // ---------- Web Audio / EQ ----------
  const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_MIN = -12;
  const EQ_MAX = 12;

  let audioCtx = null;
  let srcNode = null;
  let preGain = null;
  let analyser = null; // reserved (if you re-add viz later)
  let eqEnabled = true;

  // band nodes array aligned to EQ_FREQS
  let eqBands = [];

  async function ensureAudioGraph(audioEl) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch {} }

    if (!srcNode) {
      try { srcNode = audioCtx.createMediaElementSource(audioEl); }
      catch (e) { console.warn("createMediaElementSource failed:", e); return; }
    }

    if (!preGain) {
      preGain = audioCtx.createGain();
      preGain.gain.value = dbToGain(getPreDb());
    }

    if (!eqBands.length) {
      eqBands = EQ_FREQS.map((hz, i) => {
        const f = audioCtx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = hz;
        f.Q.value = 1.0;
        f.gain.value = getBandDb(i);
        return f;
      });
    }

    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
    }

    reconnectGraph();
  }

  function disconnectSafe(node) { try { node.disconnect(); } catch {} }
  function dbToGain(db) { return Math.pow(10, db / 20); }

  function reconnectGraph() {
    if (!audioCtx || !srcNode || !preGain) return;

    // disconnect everything cleanly
    disconnectSafe(srcNode);
    disconnectSafe(preGain);
    eqBands.forEach(disconnectSafe);
    disconnectSafe(analyser);

    // Connect to destination
    if (eqEnabled) {
      srcNode.connect(preGain);
      let last = preGain;
      for (const b of eqBands) { last.connect(b); last = b; }
      last.connect(audioCtx.destination);
    } else {
      srcNode.connect(audioCtx.destination);
    }
  }

  function setEqEnabled(on) {
    eqEnabled = !!on;
    try { localStorage.setItem(LS.EQ_ENABLED, eqEnabled ? "1" : "0"); } catch {}
    reconnectGraph();
    renderEqHeader();
  }

  function setPreDb(db) {
    const v = clamp(db, EQ_MIN, EQ_MAX);
    try { localStorage.setItem(LS.EQ_PRE, String(v)); } catch {}
    if (preGain) preGain.gain.value = dbToGain(v);
    renderEqHeader();
  }

  function setBandDb(i, db) {
    const v = clamp(db, EQ_MIN, EQ_MAX);
    const arr = getBandsArray();
    arr[i] = v;
    try { localStorage.setItem(LS.EQ_BANDS, JSON.stringify(arr)); } catch {}
    if (eqBands[i]) eqBands[i].gain.value = v;
  }

  function getPreDb() {
    try {
      const s = localStorage.getItem(LS.EQ_PRE);
      const n = parseFloat(s);
      return isFinite(n) ? clamp(n, EQ_MIN, EQ_MAX) : 0;
    } catch { return 0; }
  }

  function getBandsArray() {
    try {
      const s = localStorage.getItem(LS.EQ_BANDS);
      const arr = JSON.parse(s || "null");
      if (Array.isArray(arr) && arr.length === EQ_FREQS.length) {
        return arr.map(x => clamp(parseFloat(x), EQ_MIN, EQ_MAX));
      }
    } catch {}
    return Array(EQ_FREQS.length).fill(0);
  }

  function getBandDb(i) {
    const arr = getBandsArray();
    return isFinite(arr[i]) ? clamp(arr[i], EQ_MIN, EQ_MAX) : 0;
  }

  // ---------- Player UI (injected) ----------
  let audioEl;
  let rootEl;
  let titleEl, playBtn, prevBtn, nextBtn, shuffleAllBtn, shuffleArtistBtn, repeatBtn;
  let timeEl, durEl, seekEl, volEl, dlBtn;
  let eqToggleBtn, eqPanelEl;
  let eqPreEl, eqPreValEl, eqEnabledBtn, eqResetBtn;
  let eqBandRows = [];

  function ensurePlayerDom() {
    // Audio element
    audioEl = document.getElementById("audio");
    if (!audioEl) {
      audioEl = el("audio", { id: "audio", preload: "metadata" });
      document.body.appendChild(audioEl);
    }

    // Root container
    rootEl = document.getElementById("maneit-player");
    if (!rootEl) {
      rootEl = el("div", { id: "maneit-player" });
      document.body.appendChild(rootEl);
    }

    // Inject base styles (keeps playlists clickable)
    if (!document.getElementById("maneit-player-style")) {
      const style = el("style", { id: "maneit-player-style", html: `
        :root { --maneit-player-h: 140px; }
        #maneit-player {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          z-index: 9999;
          background: rgba(10,12,16,0.92);
          backdrop-filter: blur(10px);
          border-top: 1px solid rgba(255,255,255,0.08);
          padding: 12px 14px;
          color: #e8edf7;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }
        #maneit-player .row { display:flex; align-items:center; gap:10px; }
        #maneit-player .title { font-weight: 650; letter-spacing: .2px; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
        #maneit-player .btn {
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.06);
          color: inherit;
          cursor: pointer;
          user-select: none;
        }
        #maneit-player .btn.on { border-color: rgba(110,231,255,0.55); box-shadow: 0 0 0 2px rgba(110,231,255,0.15) inset; }
        #maneit-player .btn:disabled { opacity: .45; cursor: not-allowed; }
        #maneit-player .mini { padding: 6px 9px; border-radius: 999px; font-size: 12px; }
        #maneit-player .grow { flex: 1; min-width: 0; }
        #maneit-player .meta { opacity:.85; font-size: 12px; }
        #maneit-player input[type="range"] { width: 100%; }
        #maneit-player .seek { display:flex; align-items:center; gap:10px; margin-top:10px; }
        #maneit-player .seek .time { width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
        #maneit-player .seek .dur { width: 44px; text-align: left; font-variant-numeric: tabular-nums; opacity:.85; }
        #maneit-eq {
          margin-top: 12px;
          padding: 12px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.04);
          display: none;
        }
        #maneit-eq.show { display: block; }
        #maneit-eq .eq-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px; }
        #maneit-eq .eq-grid { display:grid; grid-template-columns: 90px 1fr 60px; gap:10px; align-items:center; }
        #maneit-eq .hz { font-size: 12px; opacity:.85; }
        #maneit-eq .val { font-size: 12px; text-align:right; font-variant-numeric: tabular-nums; opacity:.9; }
        #maneit-eq input[type="range"] { height: 26px; }
      `});
      document.head.appendChild(style);
    }

    // Build UI if empty
    if (!rootEl.dataset.ready) {
      rootEl.dataset.ready = "1";
      rootEl.innerHTML = "";

      titleEl = el("div", { class: "title grow", id: "player-title" }, []);
      titleEl.textContent = "—";

      playBtn = el("button", { class: "btn", id: "playPause", type: "button" }); playBtn.textContent = "Play";
      prevBtn = el("button", { class: "btn mini", id: "prevBtn", type: "button" }); prevBtn.textContent = "Prev";
      nextBtn = el("button", { class: "btn mini", id: "nextBtn", type: "button" }); nextBtn.textContent = "Next";

      shuffleAllBtn = el("button", { class: "btn mini", id: "shuffleAllBtn", type: "button" }); shuffleAllBtn.textContent = "Shuffle: All";
      shuffleArtistBtn = el("button", { class: "btn mini", id: "shuffleArtistBtn", type: "button" }); shuffleArtistBtn.textContent = "Shuffle: Artist";

      repeatBtn = el("button", { class: "btn mini", id: "repeatBtn", type: "button" }); repeatBtn.textContent = "Repeat: Off";

      eqToggleBtn = el("button", { class: "btn mini", id: "eqBtn", type: "button" }); eqToggleBtn.textContent = "EQ";

      dlBtn = el("a", { class: "btn mini", id: "downloadMp3", href: "#", download: "track.mp3" });
      dlBtn.textContent = "Download";

      volEl = el("input", { id: "vol", type: "range", min: "0", max: "1", step: "0.01", value: "0.85" });

      const topRow = el("div", { class: "row" }, [
        titleEl,
        prevBtn, playBtn, nextBtn,
        shuffleAllBtn, shuffleArtistBtn, repeatBtn,
        eqToggleBtn,
        dlBtn
      ]);

      const volRow = el("div", { class: "row", style: "margin-top:10px;" }, [
        el("div", { class: "meta", style: "width:60px;" }, [document.createTextNode("Volume")]),
        el("div", { class: "grow" }, [volEl])
      ]);

      timeEl = el("div", { class: "time", id: "tNow" }); timeEl.textContent = "0:00";
      durEl = el("div", { class: "dur", id: "tDur" }); durEl.textContent = "0:00";
      seekEl = el("input", { id: "seek", type: "range", min: "0", max: "1000", step: "1", value: "0" });

      const seekRow = el("div", { class: "seek" }, [timeEl, seekEl, durEl]);

      // EQ panel
      eqPanelEl = el("div", { id: "maneit-eq" });
      eqPanelEl.appendChild(el("div", { class: "eq-head" }, [
        el("div", { class: "meta" }, [document.createTextNode("10-Band EQ (31Hz → 16kHz)")]),
        el("div", { class: "row" }, [])
      ]));

      rootEl.appendChild(topRow);
      rootEl.appendChild(volRow);
      rootEl.appendChild(seekRow);
      rootEl.appendChild(eqPanelEl);

      buildEqUi();

      // Measure + expose height for UI padding
      requestAnimationFrame(() => syncPlayerHeight());
      window.addEventListener("resize", () => syncPlayerHeight());
    }

    // re-bind refs after innerHTML build
    titleEl = document.getElementById("player-title");
    playBtn = document.getElementById("playPause");
    prevBtn = document.getElementById("prevBtn");
    nextBtn = document.getElementById("nextBtn");
    shuffleAllBtn = document.getElementById("shuffleAllBtn");
    shuffleArtistBtn = document.getElementById("shuffleArtistBtn");
    repeatBtn = document.getElementById("repeatBtn");
    eqToggleBtn = document.getElementById("eqBtn");
    dlBtn = document.getElementById("downloadMp3");
    volEl = document.getElementById("vol");
    timeEl = document.getElementById("tNow");
    durEl = document.getElementById("tDur");
    seekEl = document.getElementById("seek");
    eqPanelEl = document.getElementById("maneit-eq");
  }

  function syncPlayerHeight() {
    if (!rootEl) return;
    const h = rootEl.getBoundingClientRect().height || 140;
    document.documentElement.style.setProperty("--maneit-player-h", `${Math.ceil(h)}px`);
    // Tell UI it can re-pad
    window.dispatchEvent(new CustomEvent("maneit:playerheight", { detail: { height: Math.ceil(h) } }));
  }

  // ---------- EQ UI ----------
  function buildEqUi() {
    if (!eqPanelEl) return;

    // clear
    eqPanelEl.innerHTML = "";

    const head = el("div", { class: "eq-head" });
    const left = el("div", { class: "meta" });
    left.textContent = "10-Band EQ (31Hz → 16kHz)";

    eqEnabledBtn = el("button", { class: "btn mini", type: "button", id: "eqEnableBtn" });
    eqResetBtn = el("button", { class: "btn mini", type: "button", id: "eqResetBtn" });
    eqResetBtn.textContent = "Reset";

    head.appendChild(left);
    head.appendChild(el("div", { class: "row" }, [eqEnabledBtn, eqResetBtn]));
    eqPanelEl.appendChild(head);

    // Preamp row
    const preRow = el("div", { class: "eq-grid" });
    preRow.appendChild(el("div", { class: "hz" }, [document.createTextNode("Preamp")]));
    eqPreEl = el("input", { id: "eq_pre", type: "range", min: String(EQ_MIN), max: String(EQ_MAX), step: "0.5", value: String(getPreDb()) });
    preRow.appendChild(eqPreEl);
    eqPreValEl = el("div", { class: "val", id: "val_pre" });
    preRow.appendChild(eqPreValEl);
    eqPanelEl.appendChild(preRow);

    // Band rows
    eqBandRows = [];
    const bandVals = getBandsArray();

    EQ_FREQS.forEach((hz, i) => {
      const row = el("div", { class: "eq-grid" });
      row.appendChild(el("div", { class: "hz" }, [document.createTextNode(hz >= 1000 ? `${hz / 1000}kHz` : `${hz}Hz`)]));
      const slider = el("input", {
        type: "range",
        min: String(EQ_MIN),
        max: String(EQ_MAX),
        step: "0.5",
        value: String(bandVals[i]),
        "data-band": String(i)
      });
      const val = el("div", { class: "val" });
      row.appendChild(slider);
      row.appendChild(val);
      eqPanelEl.appendChild(row);
      eqBandRows.push({ slider, val, hz, i });
    });

    // wire
    eqPreEl.addEventListener("input", () => {
      const v = parseFloat(eqPreEl.value);
      setPreDb(v);
      renderEqHeader();
      syncEqLabels();
    });

    eqEnabledBtn.addEventListener("click", () => setEqEnabled(!eqEnabled));
    eqResetBtn.addEventListener("click", () => {
      setPreDb(0);
      try { localStorage.setItem(LS.EQ_BANDS, JSON.stringify(Array(EQ_FREQS.length).fill(0))); } catch {}
      eqBandRows.forEach(r => { r.slider.value = "0"; setBandDb(r.i, 0); });
      syncEqLabels();
    });

    eqBandRows.forEach(r => {
      r.slider.addEventListener("input", () => {
        const v = parseFloat(r.slider.value);
        setBandDb(r.i, v);
        syncEqLabels();
      });
    });

    // restore open state
    const open = (() => { try { return localStorage.getItem(LS.EQ_OPEN) === "1"; } catch { return false; } })();
    eqPanelEl.classList.toggle("show", open);

    // restore enabled state
    try { eqEnabled = localStorage.getItem(LS.EQ_ENABLED) !== "0"; } catch { eqEnabled = true; }
    renderEqHeader();
    syncEqLabels();
  }

  function syncEqLabels() {
    if (eqPreValEl && eqPreEl) eqPreValEl.textContent = `${Number(eqPreEl.value).toFixed(1)} dB`;
    eqBandRows.forEach(r => { r.val.textContent = `${Number(r.slider.value).toFixed(1)} dB`; });
  }

  function renderEqHeader() {
    if (!eqEnabledBtn) return;
    eqEnabledBtn.classList.toggle("on", !!eqEnabled);
    eqEnabledBtn.textContent = eqEnabled ? "EQ: On" : "EQ: Off";
  }

  // ---------- Shuffle/Repeat ----------
  function fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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

  function applyShuffleUI() {
    if (!shuffleAllBtn || !shuffleArtistBtn) return;
    shuffleAllBtn.classList.toggle("on", shuffleMode === "all");
    shuffleArtistBtn.classList.toggle("on", shuffleMode === "artist");
  }

  function applyRepeatUI() {
    if (!repeatBtn) return;
    repeatBtn.dataset.mode = repeatMode;
    repeatBtn.textContent =
      repeatMode === "off" ? "Repeat: Off" :
      repeatMode === "one" ? "Repeat: One" :
      "Repeat: All";
    audioEl.loop = (repeatMode === "one");
  }

  function setShuffleMode(mode) {
    shuffleMode = mode; // off|all|artist
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

  function restoreModes() {
    try {
      const sm = localStorage.getItem(LS.SHUFFLE);
      if (sm === "off" || sm === "all" || sm === "artist") shuffleMode = sm;
      const rm = localStorage.getItem(LS.REPEAT);
      if (rm === "off" || rm === "one" || rm === "all") repeatMode = rm;
    } catch {}
    applyShuffleUI();
    applyRepeatUI();
  }

  // ---------- Core playback ----------
  let isPlaying = false;
  let isSeeking = false;

  async function playTrack(track) {
    if (!track) return;

    // pick playable source
    const src = track.mp3 || track.wav;
    if (!src) return;

    // update active index
    if (typeof track.__libIndex === "number") __ACTIVE_INDEX__ = track.__libIndex;
    else __ACTIVE_INDEX__ = __LIBRARY__.findIndex(t => (t.mp3 || t.wav) === (track.mp3 || track.wav));

    if (shuffleMode !== "off") buildQueueFromCurrent();

    audioEl.src = safeUrl(src);

    titleEl.textContent = track.title || "—";

    // download points to mp3 if present, otherwise wav
    const dl = track.mp3 || track.wav;
    dlBtn.href = safeUrl(dl);
    dlBtn.setAttribute("download", (track.title || "track") + (track.mp3 ? ".mp3" : ".wav"));

    // ensure audio graph (EQ)
    await ensureAudioGraph(audioEl);

    try {
      await audioEl.play();
      isPlaying = true;
      playBtn.textContent = "Pause";
    } catch (e) {
      // autoplay blocked or load issue
      isPlaying = false;
      playBtn.textContent = "Play";
      console.warn("play() failed:", e);
      throw e;
    }

    // notify UI
    window.dispatchEvent(new CustomEvent("maneit:nowplaying", { detail: { track } }));
  }

  function nextTrack() {
    if (!__LIBRARY__.length) return;

    if (shuffleMode !== "off") {
      if (!queue.length) buildQueueFromCurrent();
      queuePos++;

      // artist shuffle can have no candidates
      if (queue.length <= 1) {
        if (repeatMode === "all") {
          audioEl.currentTime = 0;
          audioEl.play().catch(() => {});
          return;
        }
        audioEl.pause();
        isPlaying = false;
        playBtn.textContent = "Play";
        return;
      }

      if (queuePos >= queue.length) {
        if (repeatMode === "all") {
          buildQueueFromCurrent();
          queuePos = 0;
        } else {
          audioEl.pause();
          isPlaying = false;
          playBtn.textContent = "Play";
          return;
        }
      }

      const idx = queue[queuePos];
      playTrack(__LIBRARY__[idx]).catch(() => {});
      return;
    }

    let idx = __ACTIVE_INDEX__ + 1;
    if (idx >= __LIBRARY__.length) {
      if (repeatMode === "all") idx = 0;
      else {
        audioEl.pause();
        isPlaying = false;
        playBtn.textContent = "Play";
        return;
      }
    }

    playTrack(__LIBRARY__[idx]).catch(() => {});
  }

  function prevTrack() {
    if (!__LIBRARY__.length) return;

    if (audioEl.currentTime > 3) {
      audioEl.currentTime = 0;
      return;
    }

    if (shuffleMode !== "off") {
      if (!queue.length) buildQueueFromCurrent();
      queuePos = Math.max(0, queuePos - 1);
      const idx = queue[queuePos];
      playTrack(__LIBRARY__[idx]).catch(() => {});
      return;
    }

    let idx = __ACTIVE_INDEX__ - 1;
    if (idx < 0) idx = (repeatMode === "all") ? (__LIBRARY__.length - 1) : 0;
    playTrack(__LIBRARY__[idx]).catch(() => {});
  }

  function setLibrary(flattenedTracks) {
    __LIBRARY__ = Array.isArray(flattenedTracks) ? flattenedTracks : [];
  }

  // ---------- Wire UI ----------
  function restoreVolume() {
    try {
      const v = parseFloat(localStorage.getItem(LS.VOL));
      if (isFinite(v)) audioEl.volume = clamp(v, 0, 1);
    } catch {}
    volEl.value = String(audioEl.volume);
  }

  function persistVolume() {
    try { localStorage.setItem(LS.VOL, String(audioEl.volume)); } catch {}
  }

  function toggleEqPanel() {
    const open = !eqPanelEl.classList.contains("show");
    eqPanelEl.classList.toggle("show", open);
    try { localStorage.setItem(LS.EQ_OPEN, open ? "1" : "0"); } catch {}
    // height changed -> re-pad playlists
    requestAnimationFrame(() => syncPlayerHeight());
  }

  function wire() {
    playBtn.addEventListener("click", async () => {
      if (!audioEl.src) return;
      if (isPlaying) {
        audioEl.pause();
        isPlaying = false;
        playBtn.textContent = "Play";
      } else {
        try {
          await ensureAudioGraph(audioEl);
          await audioEl.play();
          isPlaying = true;
          playBtn.textContent = "Pause";
        } catch (e) {
          isPlaying = false;
          playBtn.textContent = "Play";
        }
      }
    });

    prevBtn.addEventListener("click", () => prevTrack());
    nextBtn.addEventListener("click", () => nextTrack());

    shuffleAllBtn.addEventListener("click", () => setShuffleMode(shuffleMode === "all" ? "off" : "all"));
    shuffleArtistBtn.addEventListener("click", () => setShuffleMode(shuffleMode === "artist" ? "off" : "artist"));
    repeatBtn.addEventListener("click", () => cycleRepeat());

    eqToggleBtn.addEventListener("click", () => toggleEqPanel());

    volEl.addEventListener("input", () => {
      audioEl.volume = clamp(parseFloat(volEl.value), 0, 1);
      persistVolume();
    });
    audioEl.addEventListener("volumechange", () => { volEl.value = String(audioEl.volume); });

    // Seek
    seekEl.addEventListener("input", () => {
      isSeeking = true;
      const pct = parseFloat(seekEl.value) / 1000;
      const t = (audioEl.duration || 0) * pct;
      timeEl.textContent = fmtTime(t);
    });
    seekEl.addEventListener("change", () => {
      const pct = parseFloat(seekEl.value) / 1000;
      const t = (audioEl.duration || 0) * pct;
      if (isFinite(t)) audioEl.currentTime = t;
      isSeeking = false;
    });

    // Time update
    audioEl.addEventListener("timeupdate", () => {
      if (!isSeeking) {
        timeEl.textContent = fmtTime(audioEl.currentTime);
        if (isFinite(audioEl.duration) && audioEl.duration > 0) {
          const pct = audioEl.currentTime / audioEl.duration;
          seekEl.value = String(Math.round(pct * 1000));
        }
      }
    });

    audioEl.addEventListener("loadedmetadata", () => {
      durEl.textContent = fmtTime(audioEl.duration);
      syncPlayerHeight();
    });

    audioEl.addEventListener("ended", () => {
      if (repeatMode === "one") return; // native loop handles it
      if (repeatMode === "all" || shuffleMode !== "off") nextTrack();
      else {
        isPlaying = false;
        playBtn.textContent = "Play";
      }
    });
  }

  // ---------- Init ----------
  function init() {
    ensurePlayerDom();
    restoreVolume();
    restoreModes();

    // restore EQ enabled
    try { eqEnabled = localStorage.getItem(LS.EQ_ENABLED) !== "0"; } catch { eqEnabled = true; }
    renderEqHeader();

    wire();
    syncEqLabels();
    reconnectGraph(); // harmless pre-connect

    // expose API
    window.ManeitPlayer = {
      playTrack,
      setLibrary,
      getPlayerHeight: () => Math.ceil((rootEl?.getBoundingClientRect().height || 140))
    };
  }

  init();
})();
