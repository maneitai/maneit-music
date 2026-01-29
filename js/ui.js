/* ============================= */
/* MANEIT MUSIC — UI (v3)        */
/* Builds projects + track rows  */
/* Adds Play + MP3 + WAV         */
/* Feeds global library to player*/
/* ============================= */

fetch("data/tracks.json")
  .then(res => res.json())
  .then(data => {
    const container = document.getElementById("projects");
    container.innerHTML = "";

    const flattened = [];
    let libIndex = 0;

    (data.projects || []).forEach(project => {
      const section = document.createElement("section");
      section.className = "project";

      const projectTitle = project.title || project.id || "Project";
      section.innerHTML = `<h3 class="project-title">${projectTitle}</h3>`;

      (project.tracks || []).forEach(track => {
        const row = document.createElement("div");
        row.className = "track";

        // artist support (for shuffle-by-artist)
        // prefer explicit track.artist; else fall back to project title
        const artist = (track.artist || projectTitle || "").trim();
        row.setAttribute("data-artist", artist);

        const title = track.title || "Untitled";
        const mp3 = track.mp3 || null;
        const wav = track.wav || null;

        // stash metadata used by player
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
            <button type="button">Play</button>
            <a class="dl-mp3" href="${mp3 ? encodeURI(mp3) : "#"}" download="${title}.mp3">MP3</a>
            ${wav ? `<a class="dl-wav" href="${encodeURI(wav)}" download="${title}.wav">WAV</a>` : ``}
          </div>
        `;

        const btn = row.querySelector("button");
        btn.onclick = () => {
          if (!tObj.mp3) return;
          // Use the player API if present
          if (window.ManeitPlayer && typeof window.ManeitPlayer.playTrack === "function") {
            window.ManeitPlayer.playTrack(tObj);
          } else if (typeof playTrack === "function") {
            // fallback if someone moved things around
            playTrack(tObj);
          }
        };

        section.appendChild(row);
        libIndex++;
      });

      container.appendChild(section);
    });

    // Feed the flattened library to the player
    if (window.ManeitPlayer && typeof window.ManeitPlayer.setLibrary === "function") {
      window.ManeitPlayer.setLibrary(flattened);
    }
  })
  .catch(err => {
    const container = document.getElementById("projects");
    container.innerHTML = `
      <div class="project">
        <div class="mono muted">Failed to load data/tracks.json</div>
        <div class="mono muted" style="margin-top:8px; opacity:.8;">${String(err.message || err)}</div>
      </div>
    `;
  });
