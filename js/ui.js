/* ============================= */
/* MANEIT MUSIC — UI (v3.1)      */
/* Builds projects + track rows  */
/* Adds Play + MP3 + WAV         */
/* Feeds global library to player*/
/* ============================= */

const TRACKS_URL = "data/tracks.json";

function toProjects(data) {
  // Prefer native "projects"
  if (data && Array.isArray(data.projects)) return data.projects;

  // Support "artists" schema by converting it
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

function getContainer() {
  const el = document.getElementById("projects");
  return el || null;
}

fetch(`${TRACKS_URL}?v=${Date.now()}`, { cache: "no-store" })
  .then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${TRACKS_URL}`);
    return res.json();
  })
  .then(data => {
    const container = getContainer();
    if (!container) throw new Error(`Missing #projects container in HTML`);

    container.innerHTML = "";

    const projects = toProjects(data);

    if (!projects.length) {
      container.innerHTML = `
        <div class="project">
          <div class="mono muted">No projects found.</div>
          <div class="mono muted" style="margin-top:8px; opacity:.8;">
            tracks.json must contain either <code>{"projects":[...]}</code> or <code>{"artists":[...]}</code>
          </div>
        </div>
      `;
      return;
    }

    const flattened = [];
    let libIndex = 0;

    projects.forEach(project => {
      const section = document.createElement("section");
      section.className = "project";

      const projectTitle = project.title || project.id || "Project";
      section.innerHTML = `<h3 class="project-title">${projectTitle}</h3>`;

      (project.tracks || []).forEach(track => {
        const row = document.createElement("div");
        row.className = "track";

        const artist = (track.artist || projectTitle || "").trim();
        row.setAttribute("data-artist", artist);

        const title = track.title || "Untitled";
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

        row.innerHTML = `
          <span class="track-title">${title}</span>
          <div class="track-actions">
            <button type="button" ${mp3 ? "" : "disabled"}>${mp3 ? "Play" : "Missing"}</button>
            <a class="dl-mp3" href="${mp3 ? encodeURI(mp3) : "#"}" download="${title}.mp3">MP3</a>
            ${wav ? `<a class="dl-wav" href="${encodeURI(wav)}" download="${title}.wav">WAV</a>` : ``}
          </div>
        `;

        const btn = row.querySelector("button");
        btn.onclick = () => {
          if (!tObj.mp3) return;
          if (window.ManeitPlayer && typeof window.ManeitPlayer.playTrack === "function") {
            window.ManeitPlayer.playTrack(tObj);
          } else if (typeof playTrack === "function") {
            playTrack(tObj);
          } else {
            console.warn("Player API not found (window.ManeitPlayer.playTrack missing).");
          }
        };

        section.appendChild(row);
        libIndex++;
      });

      container.appendChild(section);
    });

    if (window.ManeitPlayer && typeof window.ManeitPlayer.setLibrary === "function") {
      window.ManeitPlayer.setLibrary(flattened);
    }
  })
  .catch(err => {
    const container = getContainer();
    if (!container) return;
    container.innerHTML = `
      <div class="project">
        <div class="mono muted">Failed to load ${TRACKS_URL}</div>
        <div class="mono muted" style="margin-top:8px; opacity:.8;">${String(err.message || err)}</div>
      </div>
    `;
  });
