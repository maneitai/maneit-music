/* ==========================================================
   MANEIT MUSIC — player.js (v1 SOUND-FIRST)
   - Uses your existing DOM (#player, #audio, controls)
   - ALWAYS plays with normal <audio> (no WebAudio yet)
   - Fixes double slashes safely
   - Exposes ManeitPlayer.playTrack(track)
   ========================================================== */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const player = $("player");
  const audio = $("audio");

  const titleEl = $("player-title");
  const playPauseBtn = $("playPause");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");

  const downloadMp3 = $("downloadMp3");

  const progress = $("progress");
  const timeNowEl = $("time-now");
  const timeTotalEl = $("time-total");

  const vol = $("vol");
  const audioError = $("audioError");

  const LS_VOL = "maneit_music_vol_public_v1";

  let library = [];
  let activeIndex = -1;
  let isPlaying = false;
  let activeRow = null;
  let activePlayBtn = null;

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
      // preserve https:// but remove accidental double slashes elsewhere
      return encodeURI(s.replace(/([^:]\/)\/+/g, "$1"));
    } catch {
      return path;
    }
  }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  function setActiveUI(track) {
    // deactivate previous
    if (activeRow) activeRow.classList.remove("is-playing");
    if (activePlayBtn) activePlayBtn.textContent = "Play";

    activeRow = track.rowEl || null;
    activePlayBtn = track.playBtnEl || null;

    if (activeRow) activeRow.classList.add("is-playing");
    if (activePlayBtn) activePlayBtn.textContent = "Pause";

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

    // MUST set before src when cross-origin
    audio.crossOrigin = "anonymous";
    audio.muted = false;
    if (!isFinite(audio.volume) || audio.volume <= 0) audio.volume = 0.9;

    const src = t.mp3 || t.wav;
    const url = safeUrl(src);

    setActiveUI(t);

    audio.src = url;

    try {
      await audio.play();
      isPlaying = true;
      playPauseBtn.textContent = "Pause";
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

    if (activePlayBtn) activePlayBtn.textContent = "Play";
    if (activeRow) activeRow.classList.remove("is-playing");
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
      if (activePlayBtn) activePlayBtn.textContent = "Pause";
      if (activeRow) activeRow.classList.add("is-playing");
    }).catch(e => {
      isPlaying = false;
      playPauseBtn.textContent = "Play";
      showError(`play() failed.\n${String(e)}\n\nURL:\n${audio.src}`);
    });
  }

  function next() {
    if (!library.length) return;
    let i = activeIndex + 1;
    if (i >= library.length) i = 0;
    playIndex(i);
  }

  function prev() {
    if (!library.length) return;

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    let i = activeIndex - 1;
    if (i < 0) i = library.length - 1;
    playIndex(i);
  }

  // Progress / time
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
    isPlaying = false;
    playPauseBtn.textContent = "Play";
    next();
  });

  audio.addEventListener("error", () => {
    const code = audio.error ? audio.error.code : "unknown";
    showError(`Audio element error. code=${code}\n\nURL:\n${audio.src}`);
  });

  // Wire buttons
  playPauseBtn.addEventListener("click", togglePlayPause);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  // Volume restore
  try {
    const v = parseFloat(localStorage.getItem(LS_VOL));
    if (isFinite(v)) audio.volume = clamp(v, 0, 1);
  } catch {}
  vol.value = String(audio.volume || 0.9);

  vol.addEventListener("input", () => {
    audio.volume = clamp(parseFloat(vol.value), 0, 1);
    try { localStorage.setItem(LS_VOL, String(audio.volume)); } catch {}
  });
  audio.addEventListener("volumechange", () => {
    vol.value = String(audio.volume);
  });

  // Expose API for ui.js
  window.ManeitPlayer = {
    setLibrary(items) {
      library = Array.isArray(items) ? items : [];
    },
    playTrack(track) {
      // track must have __index (set by ui.js)
      if (!track || typeof track.__index !== "number") return Promise.resolve();
      return playIndex(track.__index);
    }
  };
})();
