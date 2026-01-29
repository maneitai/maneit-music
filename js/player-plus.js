/* Maneit Music — Player Plus (addon)
   Hooks into your existing page and adds:
   - Global Shuffle (All)
   - Shuffle by Artist (track.artist if present, else project title)
   - Repeat Off/One/All
   - Prev/Next
   - Volume (persist)
   - Visualizer (Web Audio API)
   - Equalizer: preamp + 5 bands (persist), enable/disable, reset

   Assumptions:
   - Your page already renders projects/tracks from data/tracks.json
   - Your player has <audio id="audio"> and your usual controls
   - You add the extra buttons/panels with IDs listed at bottom.
*/

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Existing (must exist)
  const projectsEl = $("projectsList");
  const audio = $("audio");
  const audioError = $("audioError");

  const titleEl = $("player-title");
  const playPauseBtn = $("playPause");
  const downloadMp3 = $("downloadMp3");

  const progress = $("progress");
  const timeNowEl = $("time-now");
  const timeTotalEl = $("time-total");

  if (!projectsEl || !audio) return;

  // New controls (expected)
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const shuffleAllBtn = $("shuffleAllBtn");
  const shuffleArtistBtn = $("shuffleArtistBtn");
  const repeatBtn = $("repeatBtn");
  const vizBtn = $("vizBtn");
  const eqBtn = $("eqBtn");
  const vol = $("vol");

  const vizPanel = $("vizPanel");
  const vizCanvas = document.getElementById("viz");
  const vizCtx = vizCanvas ? vizCanvas.getContext("2d") : null;

  const eqPanel = $("eqPanel");
  const eqEnableBtn = $("eqEnableBtn");
  const eqResetBtn = $("eqResetBtn");

  const eq_pre = $("eq_pre");
  const eq_60 = $("eq_60");
  const eq_170 = $("eq_170");
  const eq_350 = $("eq_350");
  const eq_1000 = $("eq_1000");
  const eq_3500 = $("eq_3500");

  const val_pre = $("val_pre");
  const val_60 = $("val_60");
  const val_170 = $("val_170");
  const val_350 = $("val_350");
  const val_1000 = $("val_1000");
  const val_3500 = $("val_3500");

  // ===== Storage =====
  const LS = {
    VOL: "maneit_music_vol_plus_v1",
    SHUFFLE_MODE: "maneit_music_shuffle_mode_plus_v1", // off|all|artist
    REPEAT: "maneit_music_repeat_plus_v1",             // off|one|all
    VIZ_ON: "maneit_music_viz_on_plus_v1",
    EQ_PANEL: "maneit_music_eq_panel_plus_v1",
    EQ_ENABLED: "maneit_music_eq_enabled_plus_v1",
    EQ_PRE: "maneit_music_eq_pre_plus_v1",
    EQ_60: "maneit_music_eq_60_plus_v1",
    EQ_170: "maneit_music_eq_170_plus_v1",
    EQ_350: "maneit_music_eq_350_plus_v1",
    EQ_1000: "maneit_music_eq_1000_plus_v1",
    EQ_3500: "maneit_music_eq_3500_plus_v1"
  };

  // ===== State =====
  let library = [];          // flattened from DOM
  let activeLibIndex = -1;

  let shuffleMode = "off";   // off|all|artist
  let repeatMode = "off";    // off|one|all

  let queue = [];
  let queuePos = 0;

  // Web Audio graph
  let audioCtx = null;
  let analyser = null;
  let srcNode = null;
  let rafId = 0;
  let vizOn = false;

  // EQ nodes
  let eqEnabled = true;
  let preGain = null;
  let eqNodes = { f60:null, f170:null, f350:null, f1000:null, f3500:null };

  // ===== Utils =====
  function clamp(n, a, b){ return Math.min(b, Math.max(a, n)); }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function safeUrl(path) {
    try { return encodeURI(path); } catch { return path; }
  }

  function showError(msg) {
    if (!audioError) return;
    audioError.style.display = "block";
    audioError.innerHTML = `<strong>AUDIO ERROR</strong>\n${msg}`;
  }

  function clearError() {
    if (!audioError) return;
    audioError.style.display = "none";
    audioError.textContent = "";
  }

  function fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function setMiniOn(btn, on){
    if (!btn) return;
    btn.classList.toggle("on", !!on);
    btn.setAttribute("aria-pressed", String(!!on));
  }

  // ===== Persist =====
  function persist() {
    try {
      localStorage.setItem(LS.VOL, String(audio.volume));
      localStorage.setItem(LS.SHUFFLE_MODE, shuffleMode);
      localStorage.setItem(LS.REPEAT, repeatMode);
      localStorage.setItem(LS.VIZ_ON, vizOn ? "1" : "0");

      if (eqPanel) localStorage.setItem(LS.EQ_PANEL, eqPanel.classList.contains("show") ? "1" : "0");
      localStorage.setItem(LS.EQ_ENABLED, eqEnabled ? "1" : "0");

      if (eq_pre) localStorage.setItem(LS.EQ_PRE, String(eq_pre.value));
      if (eq_60) localStorage.setItem(LS.EQ_60, String(eq_60.value));
      if (eq_170) localStorage.setItem(LS.EQ_170, String(eq_170.value));
      if (eq_350) localStorage.setItem(LS.EQ_350, String(eq_350.value));
      if (eq_1000) localStorage.setItem(LS.EQ_1000, String(eq_1000.value));
      if (eq_3500) localStorage.setItem(LS.EQ_3500, String(eq_3500.value));
    } catch {}
  }

  function loadPersist() {
    try {
      const v = parseFloat(localStorage.getItem(LS.VOL));
      if (isFinite(v)) audio.volume = clamp(v, 0, 1);

      const sm = localStorage.getItem(LS.SHUFFLE_MODE);
      if (sm === "off" || sm === "all" || sm === "artist") shuffleMode = sm;

      const rm = localStorage.getItem(LS.REPEAT);
      if (rm === "off" || rm === "one" || rm === "all") repeatMode = rm;

      vizOn = localStorage.getItem(LS.VIZ_ON) === "1";

      if (eq_pre)  { const x = localStorage.getItem(LS.EQ_PRE);   if (x !== null) eq_pre.value = x; }
      if (eq_60)   { const x = localStorage.getItem(LS.EQ_60);    if (x !== null) eq_60.value = x; }
      if (eq_170)  { const x = localStorage.getItem(LS.EQ_170);   if (x !== null) eq_170.value = x; }
      if (eq_350)  { const x = localStorage.getItem(LS.EQ_350);   if (x !== null) eq_350.value = x; }
      if (eq_1000) { const x = localStorage.getItem(LS.EQ_1000);  if (x !== null) eq_1000.value = x; }
      if (eq_3500) { const x = localStorage.getItem(LS.EQ_3500);  if (x !== null) eq_3500.value = x; }

      eqEnabled = localStorage.getItem(LS.EQ_ENABLED) !== "0";
    } catch {}
  }

  // ===== Repeat =====
  function applyRepeatUI(){
    if (!repeatBtn) return;
    repeatBtn.dataset.mode = repeatMode;
    repeatBtn.textContent =
      repeatMode === "off" ? "Repeat: Off" :
      repeatMode === "one" ? "Repeat: One" :
      "Repeat: All";
    audio.loop = (repeatMode === "one");
  }

  function cycleRepeat(){
    const order = ["off", "one", "all"];
    repeatMode = order[(order.indexOf(repeatMode) + 1) % order.length];
    applyRepeatUI();
    persist();
  }

  // ===== Shuffle =====
  function currentArtistKey(){
    const t = library[activeLibIndex];
    if (!t) return null;
    return (t.artist || t.projectTitle || "").trim().toLowerCase() || null;
  }

  function buildQueueFromCurrent(){
    if (!library.length || activeLibIndex < 0) return;

    let candidates = [];

    if (shuffleMode === "all") {
      candidates = library.map((_, i) => i).filter(i => i !== activeLibIndex);
    } else if (shuffleMode === "artist") {
      const key = currentArtistKey();
      candidates = library
        .map((it, i) => ({ it, i }))
        .filter(x => x.i !== activeLibIndex)
        .filter(x => ((x.it.artist || x.it.projectTitle || "").trim().toLowerCase()) === key)
        .map(x => x.i);
    } else {
      queue = [];
      queuePos = 0;
      return;
    }

    fisherYates(candidates);
    queue = [activeLibIndex, ...candidates];
    queuePos = 0;
  }

  function setShuffleMode(mode){
    shuffleMode = mode; // off|all|artist
    setMiniOn(shuffleAllBtn, shuffleMode === "all");
    setMiniOn(shuffleArtistBtn, shuffleMode === "artist");

    if (shuffleMode !== "off") buildQueueFromCurrent();
    else { queue = []; queuePos = 0; }

    persist();
  }

  // ===== Web Audio: EQ + analyser =====
  function dbToGain(db){ return Math.pow(10, db / 20); }
  function disconnectSafe(node){ try { node.disconnect(); } catch {} }

  function applyEqSettings(){
    if (!audioCtx) return;
    const preDb = parseFloat(eq_pre ? eq_pre.value : "0");
    if (preGain) preGain.gain.value = dbToGain(isFinite(preDb) ? preDb : 0);

    if (eqNodes.f60 && eq_60) eqNodes.f60.gain.value = parseFloat(eq_60.value);
    if (eqNodes.f170 && eq_170) eqNodes.f170.gain.value = parseFloat(eq_170.value);
    if (eqNodes.f350 && eq_350) eqNodes.f350.gain.value = parseFloat(eq_350.value);
    if (eqNodes.f1000 && eq_1000) eqNodes.f1000.gain.value = parseFloat(eq_1000.value);
    if (eqNodes.f3500 && eq_3500) eqNodes.f3500.gain.value = parseFloat(eq_3500.value);
  }

  function applyEqToGraph(){
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

  async function ensureAudioGraph(){
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

  // ===== Visualizer =====
  function startViz(){
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

  function stopViz(){
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function openViz(open){
    if (!vizPanel) return;
    vizOn = !!open;
    vizPanel.classList.toggle("show", vizOn);
    vizPanel.setAttribute("aria-hidden", String(!vizOn));
    if (vizBtn) {
      vizBtn.classList.toggle("on", vizOn);
      vizBtn.setAttribute("aria-expanded", String(vizOn));
    }
    if (!vizOn) stopViz();
    else if (analyser) startViz();
    persist();
  }

  function openEq(open){
    if (!eqPanel) return;
    const on = !!open;
    eqPanel.classList.toggle("show", on);
    eqPanel.setAttribute("aria-hidden", String(!on));
    if (eqBtn) {
      eqBtn.classList.toggle("on", on);
      eqBtn.setAttribute("aria-expanded", String(on));
    }
    persist();
  }

  function setEqEnabled(on){
    eqEnabled = !!on;
    if (eqEnableBtn) {
      eqEnableBtn.classList.toggle("on", eqEnabled);
      eqEnableBtn.setAttribute("aria-pressed", String(eqEnabled));
      eqEnableBtn.textContent = eqEnabled ? "EQ: On" : "EQ: Off";
    }
    applyEqToGraph();
    persist();
  }

  function setDbLabel(el, v){
    if (!el) return;
    const n = Math.round(parseFloat(v) * 10) / 10;
    el.textContent = `${n} dB`;
  }

  function syncEqLabels(){
    if (eq_pre) setDbLabel(val_pre, eq_pre.value);
    if (eq_60) setDbLabel(val_60, eq_60.value);
    if (eq_170) setDbLabel(val_170, eq_170.value);
    if (eq_350) setDbLabel(val_350, eq_350.value);
    if (eq_1000) setDbLabel(val_1000, eq_1000.value);
    if (eq_3500) setDbLabel(val_3500, eq_3500.value);
  }

  function resetEq(){
    if (!eq_pre) return;
    eq_pre.value = "0";
    eq_60.value = "0";
    eq_170.value = "0";
    eq_350.value = "0";
    eq_1000.value = "0";
    eq_3500.value = "0";
    syncEqLabels();
    applyEqSettings();
    persist();
  }

  // ===== Build library from already-rendered DOM =====
  function rebuildLibraryFromDOM(){
    library = [];
    activeLibIndex = -1;
    queue = [];
    queuePos = 0;

    const projectSections = projectsEl.querySelectorAll(".project");
    let libCounter = 0;

    projectSections.forEach(section => {
      const titleNode = section.querySelector(".project-title");
      const projectTitle = titleNode ? titleNode.textContent.trim() : "Project";

      const rows = section.querySelectorAll(".track");
      rows.forEach(row => {
        const tTitleEl = row.querySelector(".track-title");
        const title = tTitleEl ? tTitleEl.textContent.trim() : "Untitled";

        const actions = row.querySelector(".track-actions");
        const playBtn = actions ? actions.querySelector("button") : null;
        const mp3Link = actions ? actions.querySelector("a") : null;
        const mp3 = mp3Link ? mp3Link.getAttribute("href") : null;

        // OPTIONAL: if you later add data-artist on row, we’ll use it
        const artist = row.getAttribute("data-artist") || null;

        library.push({
          libIndex: libCounter,
          title,
          mp3,
          artist,
          projectTitle,
          rowEl: row,
          playBtnEl: playBtn
        });

        // Capture click to mark active index before your original handler runs
        if (playBtn) {
          playBtn.addEventListener("click", () => {
            activeLibIndex = libCounter;
            if (shuffleMode !== "off") buildQueueFromCurrent();
          }, { capture: true });
        }

        libCounter++;
      });
    });
  }

  // ===== Playback navigation (does not destroy your existing logic) =====
  async function playByLibraryIndex(idx){
    const t = library[idx];
    if (!t || !t.mp3) return;

    activeLibIndex = idx;
    if (shuffleMode !== "off") buildQueueFromCurrent();

    clearError();

    // Update your footer title & download
    if (titleEl) titleEl.textContent = t.title || "—";
    if (downloadMp3) {
      downloadMp3.href = safeUrl(t.mp3);
      downloadMp3.setAttribute("download", (t.title || "track") + ".mp3");
    }

    // Mark row UI
    library.forEach(x => x.rowEl?.classList.remove("is-playing"));
    if (t.rowEl) t.rowEl.classList.add("is-playing");
    library.forEach(x => { if (x.playBtnEl) x.playBtnEl.textContent = "Play"; });
    if (t.playBtnEl) t.playBtnEl.textContent = "Pause";

    audio.src = safeUrl(t.mp3);

    try {
      await ensureAudioGraph();
      await audio.play();
      if (playPauseBtn) playPauseBtn.textContent = "Pause";
      if (vizOn) startViz();
    } catch (e) {
      if (playPauseBtn) playPauseBtn.textContent = "Play";
      showError(`play() failed.\n${String(e)}\n\nURL:\n${audio.src}`);
    }
  }

  function nextTrack(){
    if (!library.length) return;

    if (shuffleMode !== "off") {
      if (!queue.length) buildQueueFromCurrent();
      queuePos++;

      if (queue.length <= 1) {
        if (repeatMode === "all") {
          audio.currentTime = 0;
          audio.play().catch(()=>{});
          return;
        }
        audio.pause();
        return;
      }

      if (queuePos >= queue.length) {
        if (repeatMode === "all") {
          buildQueueFromCurrent();
          queuePos = 0;
        } else {
          audio.pause();
          return;
        }
      }
      playByLibraryIndex(queue[queuePos]);
      return;
    }

    let idx = activeLibIndex + 1;
    if (idx >= library.length) {
      if (repeatMode === "all") idx = 0;
      else { audio.pause(); return; }
    }
    playByLibraryIndex(idx);
  }

  function prevTrack(){
    if (!library.length) return;

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (shuffleMode !== "off") {
      if (!queue.length) buildQueueFromCurrent();
      queuePos = Math.max(0, queuePos - 1);
      playByLibraryIndex(queue[queuePos]);
      return;
    }

    let idx = activeLibIndex - 1;
    if (idx < 0) {
      if (repeatMode === "all") idx = library.length - 1;
      else idx = 0;
    }
    playByLibraryIndex(idx);
  }

  // ===== Wire controls =====
  function wireControls(){
    if (prevBtn) prevBtn.addEventListener("click", () => prevTrack());
    if (nextBtn) nextBtn.addEventListener("click", () => nextTrack());

    if (shuffleAllBtn) shuffleAllBtn.addEventListener("click", () => {
      setShuffleMode(shuffleMode === "all" ? "off" : "all");
    });

    if (shuffleArtistBtn) shuffleArtistBtn.addEventListener("click", () => {
      setShuffleMode(shuffleMode === "artist" ? "off" : "artist");
    });

    if (repeatBtn) repeatBtn.addEventListener("click", () => cycleRepeat());

    if (vizBtn) vizBtn.addEventListener("click", () => openViz(!(vizPanel && vizPanel.classList.contains("show"))));
    if (eqBtn) eqBtn.addEventListener("click", () => openEq(!(eqPanel && eqPanel.classList.contains("show"))));

    if (eqEnableBtn) eqEnableBtn.addEventListener("click", () => setEqEnabled(!eqEnabled));
    if (eqResetBtn) eqResetBtn.addEventListener("click", () => resetEq());

    if (vol) {
      vol.addEventListener("input", () => {
        audio.volume = clamp(parseFloat(vol.value), 0, 1);
        persist();
      });
    }

    audio.addEventListener("volumechange", () => {
      if (vol) vol.value = String(audio.volume);
    });

    const eqInputs = [eq_pre, eq_60, eq_170, eq_350, eq_1000, eq_3500].filter(Boolean);
    eqInputs.forEach(inp => {
      inp.addEventListener("input", () => {
        syncEqLabels();
        applyEqSettings();
        persist();
      });
    });

    audio.addEventListener("play", async () => {
      await ensureAudioGraph();
      if (vizOn) startViz();
    });

    audio.addEventListener("ended", () => {
      if (repeatMode === "one") return;
      if (repeatMode === "all" || shuffleMode !== "off") nextTrack();
    });

    // Optional: keep time UI synced if needed
    audio.addEventListener("loadedmetadata", () => {
      if (timeTotalEl) timeTotalEl.textContent = fmtTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (timeNowEl) timeNowEl.textContent = fmtTime(audio.currentTime);
      const d = audio.duration || 0;
      if (progress && d > 0) progress.value = String(Math.round((audio.currentTime / d) * 1000));
    });
  }

  // ===== Init =====
  loadPersist();

  if (vol) vol.value = String(audio.volume);

  applyRepeatUI();
  setMiniOn(shuffleAllBtn, shuffleMode === "all");
  setMiniOn(shuffleArtistBtn, shuffleMode === "artist");

  syncEqLabels();
  setEqEnabled(eqEnabled);

  if (vizOn) openViz(true);
  if (localStorage.getItem(LS.EQ_PANEL) === "1") openEq(true);

  wireControls();

  // Observe project list re-render (tracks.json loads async)
  const obs = new MutationObserver(() => rebuildLibraryFromDOM());
  obs.observe(projectsEl, { childList: true, subtree: true });

  rebuildLibraryFromDOM();
})();
