/* ==========================================================
   MANEIT MUSIC — ui.js (v3)
   - Renders into #projectsList
   - Adds artist/projectTitle metadata for Shuffle: Artist
   ========================================================== */

(() => {
  "use strict";

  const TRACKS_URL = "data/tracks.json";
  const projectsEl = document.getElementById("projectsList");
  if (!projectsEl) return;

  function safeUrl(path) {
    try {
      const s = String(path || "").trim();
      return encodeURI(s.replace(/([^:]\/)\/+/g, "$1"));
    } catch {
      return path;
    }
  }

  async function loadTracks() {
    const res = await fetch(`${TRACKS_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${TRACKS_URL}`);
    return await res.json();
  }

  function render(data) {
    projectsEl.innerHTML = "";

    const projects = (data && Array.isArray(data.projects)) ? data.projects : [];
    if (!projects.length) {
      projectsEl.innerHTML = "<div class='project'><div class='muted mono'>No projects found.</div></div>";
      return;
    }

    const lib = [];
    let idx = 0;

    projects.forEach(project => {
      const section = document.createElement("section");
      section.className = "project";

      const projectTitle = project.title || project.id || "Project";
      section.innerHTML = `<h3 class="project-title">${projectTitle}</h3>`;

      (project.tracks || []).forEach(track => {
        const row = document.createElement("div");
        row.className = "track";

        const left = document.createElement("span");
        left.className = "track-title";
        left.textContent = track.title || "Untitled";

        const actions = document.createElement("div");
        actions.className = "track-actions";

        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.textContent = "Play";

        const mp3 = track.mp3 || null;
        const wav = track.wav || null;

        const item = {
          __index: idx,
          title: track.title || "Untitled",
          mp3,
          wav,
          artist: track.artist || projectTitle,
          projectTitle,
          rowEl: row,
          playBtnEl: playBtn
        };

        playBtn.addEventListener("click", () => {
          if (!window.ManeitPlayer || typeof window.ManeitPlayer.playTrack !== "function") return;
          window.ManeitPlayer.playTrack(item);
        });

        const dl = document.createElement("a");
        dl.textContent = "MP3";
        dl.href = safeUrl(mp3 || wav || "#");
        dl.setAttribute("download", (item.title || "track") + (mp3 ? ".mp3" : ".wav"));

        actions.appendChild(playBtn);
        actions.appendChild(dl);

        row.appendChild(left);
        row.appendChild(actions);
        section.appendChild(row);

        projectsEl.appendChild(section);

        lib.push(item);
        idx++;
      });
    });

    if (window.ManeitPlayer && typeof window.ManeitPlayer.setLibrary === "function") {
      window.ManeitPlayer.setLibrary(lib);
    }
  }

  (async () => {
    try {
      const data = await loadTracks();
      render(data);
    } catch (e) {
      projectsEl.innerHTML =
        "<div class='project'><div class='mono muted'>Failed to load data/tracks.json</div>" +
        "<div class='mono muted' style='margin-top:8px; opacity:.8;'>" + String(e.message || e) + "</div></div>";
      console.error(e);
    }
  })();
})();
