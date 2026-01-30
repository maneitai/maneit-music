/* ==========================================================
   MANEIT MUSIC — PLAYER (CORS-proof)
   Goal:
   - ALWAYS get sound
   - ONLY enable WebAudio (EQ/Viz) if CORS is confirmed OK
   ========================================================== */

(() => {
  "use strict";

  const safeUrl = (path) => {
    try {
      const s = String(path || "").trim();
      return encodeURI(s.replace(/([^:]\/)\/+/g, "$1"));
    } catch {
      return path;
    }
  };

  const audioEl = document.getElementById("audio") || (() => {
    const a = document.createElement("audio");
    a.id = "audio";
    a.preload = "metadata";
    document.body.appendChild(a);
    return a;
  })();

  // Make sure it’s not muted / volume zero
  audioEl.muted = false;
  if (!isFinite(audioEl.volume) || audioEl.volume <= 0) audioEl.volume = 0.9;

  let audioCtx = null;
  let srcNode = null;
  let webAudioEnabled = false;

  function emitMode() {
    window.dispatchEvent(new CustomEvent("maneit:audiomode", {
      detail: { webaudio: webAudioEnabled }
    }));
  }

  // We test CORS WITHOUT downloading the full file:
  // Try a tiny range request (0-0). If CORS blocks, fetch throws.
  async function corsAllowsWebAudio(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        headers: { "Range": "bytes=0-0" }
      });
      // If server doesn’t support Range it might return 200; still OK.
      return res && (res.status === 206 || res.status === 200);
    } catch (e) {
      return false;
    }
  }

  async function enableWebAudioIfAllowed() {
    if (webAudioEnabled) return true;

    // Create context
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Resume if needed (must be after a user gesture; play click counts)
    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch {}
    }

    // Create node ONLY when we are sure CORS is OK
    if (!srcNode) {
      srcNode = audioCtx.createMediaElementSource(audioEl);
    }

    // Minimal pass-through (your EQ/Viz can hook here later)
    try { srcNode.disconnect(); } catch {}
    try { srcNode.connect(audioCtx.destination); } catch {}

    webAudioEnabled = true;
    emitMode();
    return true;
  }

  async function playUrl(rawUrl) {
    const url = safeUrl(rawUrl);

    // Important: set BEFORE src
    audioEl.crossOrigin = "anonymous";

    // Set src and play normally FIRST (this guarantees sound)
    audioEl.src = url;

    try {
      await audioEl.play();
    } catch (e) {
      console.warn("play() failed:", e);
      // Still continue; user can press play again
    }

    // Now check if CORS allows WebAudio
    const ok = await corsAllowsWebAudio(url);

    if (ok) {
      // Safe to enable WebAudio (EQ/Viz)
      try {
        await enableWebAudioIfAllowed();
      } catch (e) {
        // If anything weird happens, stay in normal mode (sound continues)
        console.warn("WebAudio enable failed; staying normal:", e);
        webAudioEnabled = false;
        emitMode();
      }
    } else {
      // Stay normal audio (sound works, EQ/Viz off)
      webAudioEnabled = false;
      emitMode();
    }
  }

  // Expose API
  window.ManeitPlayer = window.ManeitPlayer || {};
  window.ManeitPlayer.playUrl = playUrl;

  // Debug helper (optional)
  window.ManeitPlayer._debug = () => ({
    src: audioEl.src,
    muted: audioEl.muted,
    volume: audioEl.volume,
    webAudioEnabled,
    ctxState: audioCtx ? audioCtx.state : "none"
  });

  emitMode();
})();
