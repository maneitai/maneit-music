/* ==========================================================
   MANEIT MUSIC — UI (v5)
   - Renders projects + tracks
   - Keeps playlists fully clickable (pads for docked player)
   - Uses ManeitPlayer.playTrack + ManeitPlayer.setLibrary
   - Robust tracks.json loading (cache bust)
   - Highlights now playing
   ========================================================== */

(() => {
  "use strict";

  const TRACKS_URL = "data/tracks.json";

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

  function pickContainer() {
    return document.getElementById("projects") || document.body;
  }

  function ensureUiStyle() {
    if (document.getElementById("maneit-ui-style")) return;
    const style = el("style", {
      id: "maneit-ui-style",
      html: `
        #projects { padding-bottom: calc(var(--maneit-player-h, 140px) + 24px); }
        .project { margin-top: 18px; padding: 16px; border-radius: 18px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
        .project-title { margin: 0 0 10px; font-weight: 700; letter-spacing: .3px; }
        .track { display:flex; align-items:center; justify-content:space-between; gap:12px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.06); }
        .track:first-of-type { border-top: 0; }
        .track-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .track-actions { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .track button { padding: 8px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); color: inherit; cursor: pointer; }
        .track button:disabled { opacity:.45; cursor:not-allowed; }
        .track a { opacity:.85; text-decoration:none; border-bottom: 1px solid rgba(255,255,255,0.12); }
        .track.active { border-top-color: rgba(110,231,255,0.35); }
        .track.active .track-title { font-weight: 700; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .muted { opacity:.8; }
      `
    });
    document.head.appendChild(style);
  }

  function normalizeData(data) {
    // Expect { projects: [...] } for your current UI.
    if (data && Array.isArray(data.projects)) return data.projects;
    // Optional fallback if someone later uses { artists: [...] }
    if (data && Array.isArray(data.artists)) {
      return data.artists.map(a => ({
        id: a.id || (a.name || "").toLowerCase(),
        title: a.name || a.id || "Artist",
        tracks: Array.isArray(a.tracks) ? a.tracks.map(t => ({
          title: t.title || "Untitled",
          artist: a.name || a.id || "Artist",
          mp3: t.mp3,
          wav: t.wav
        })) : []
      }));
    }
    return [];
  }

  function applyPlayerPadding() {
    const c = pickContainer();
    // If container is body, do nothing special.
    const h = (window.ManeitPlayer && typeof window.ManeitPlayer.getPlayerHeight === "function")
      ? window.ManeitPlayer.getPlayerHeight()
      : 140;
    document.documentElement.style.setProperty("--maneit-player-h", `${h}px`);
    if (c && c.id === "projects") {
      c.style.paddingBottom = `calc(${h}px + 24px)`;
    }
  }

  async function loadTracks() {
    const url = `${TRACKS_URL}?v=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${TRACKS_URL}`);
    return await res.json();
  }

  function titleFromFilename(urlOrPath) {
    try {
      const s = String(urlOrPath || "");
      const leaf = s.split("/").pop() || "";
      const noExt = leaf.replace(/\.(mp3|wav)$/i, "");
      // remove artist prefix if present
      return noExt.replace(/^[a-z0-9]+-/, "").replace(/-/g, " ");
    } catch {
      return "Untitled";
    }
  }

  function render(projects) {
    ensureUiStyle();
    const container = pickContainer();

    if (!container) return;
    container.innerHTML = "";

    if (!projects.length) {
      container.innerHTML = `
        <div class="project">
          <div class="mono muted">No projects found.</div>
          <div class="mono muted" style="margin-top:8px;">Expected <code>{"projects":[...]}</code> in data/tracks.json</div>
        </div>
      `;
      return;
    }

    const flattened = [];
    let libIndex = 0;

    projects.forEach(project => {
      const section = el("section", { class: "project" });
      const projectTitle = project.title || project.id || "Project";
      section.appendChild(el("h3", { class: "project-title" }, [document.createTextNode(projectTitle)]));

      (project.tracks || []).forEach(track => {
        const title = track.title || titleFromFilename(track.mp3 || track.wav) || "Untitled";
        const artist = (track.artist || projectTitle || "").trim();
        const mp3 = track.mp3 || null;
        const wav = track.wav || null;

        const tObj = {
          title,
          mp3,
          wav,
          artist,
          projectTitle,
          __libIndex: libIndex
        };

        flattened.push(tObj);

        const row = el("div", { class: "track", "data-lib": String(libIndex) });

        const left = el("span", { class: "track-title" }, [document.createTextNode(title)]);
        const actions = el("div", { class: "track-actions" });

        const play = el("button", { type: "button" });
        play.textContent = (mp3 || wav) ? "Play" : "Missing";
        if (!(mp3 || wav)) play.disabled = true;

        play.addEventListener("click", () => {
          if (!window.ManeitPlayer || typeof window.ManeitPlayer.playTrack !== "function") {
            console.warn("ManeitPlayer.playTrack missing");
            return;
          }
          window.ManeitPlayer.playTrack(tObj).catch(() => {});
        });

        const dlHref = mp3 || wav || "#";
        const dl = el("a", { href: dlHref, download: `${title}${mp3 ? ".mp3" : ".wav"}` }, [document.createTextNode("DL")]);

        actions.appendChild(play);
        actions.appendChild(dl);

        row.appendChild(left);
        row.appendChild(actions);
        section.appendChild(row);

        libIndex++;
      });

      container.appendChild(section);
    });

    // Feed library to player (for next/prev/shuffle)
    if (window.ManeitPlayer && typeof window.ManeitPlayer.setLibrary === "function") {
      window.ManeitPlayer.setLibrary(flattened);
    }

    applyPlayerPadding();
  }

  function wireNowPlayingHighlight() {
    window.addEventListener("maneit:nowplaying", (ev) => {
      const t = ev.detail?.track;
      if (!t || typeof t.__libIndex !== "number") return;

      document.querySelectorAll(".track.active").forEach(n => n.classList.remove("active"));
      const row = document.querySelector(`.track[data-lib="${t.__libIndex}"]`);
      if (row) row.classList.add("active");
    });

    window.addEventListener("maneit:playerheight", () => applyPlayerPadding());
    window.addEventListener("resize", () => applyPlayerPadding());
  }

  async function init() {
    try {
      wireNowPlayingHighlight();
      const data = await loadTracks();
      const projects = normalizeData(data);
      render(projects);
    } catch (err) {
      const container = pickContainer();
      if (container) {
        container.innerHTML = `
          <div class="project">
            <div class="mono muted">Failed to load data/tracks.json</div>
            <div class="mono muted" style="margin-top:8px;">${String(err.message || err)}</div>
          </div>
        `;
      }
      console.error(err);
    }
  }

  init();
})();
