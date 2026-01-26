/* ============================= */
/* MANEIT MUSIC — UI */
/* ============================= */

fetch("/data/tracks.json")
  .then(res => res.json())
  .then(data => {
    const container = document.getElementById("projects");

    data.projects.forEach(project => {
      const section = document.createElement("section");
      section.className = "project";

      section.innerHTML = `<h3 class="project-title">${project.title}</h3>`;

      project.tracks.forEach(track => {
        const row = document.createElement("div");
        row.className = "track";

        row.innerHTML = `
          <span class="track-title">${track.title}</span>
          <div class="track-actions">
            <button>Play</button>
          </div>
        `;

        row.querySelector("button").onclick = () => playTrack(track);
        section.appendChild(row);
      });

      container.appendChild(section);
    });
  });
