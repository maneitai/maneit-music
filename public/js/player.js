/* ============================= */
/* MANEIT MUSIC — PLAYER LOGIC */
/* ============================= */

const audio = document.getElementById("audio");
const player = document.getElementById("player");
const titleEl = document.getElementById("player-title");
const playPauseBtn = document.getElementById("playPause");
const downloadMp3 = document.getElementById("downloadMp3");
const downloadWav = document.getElementById("downloadWav");

let isPlaying = false;

function playTrack(track) {
  audio.src = track.mp3;
  audio.play();

  titleEl.textContent = track.title;
  downloadMp3.href = track.mp3;
  downloadWav.href = track.wav;

  playPauseBtn.textContent = "Pause";
  player.hidden = false;
  isPlaying = true;
}

playPauseBtn.addEventListener("click", () => {
  if (!audio.src) return;

  if (isPlaying) {
    audio.pause();
    playPauseBtn.textContent = "Play";
  } else {
    audio.play();
    playPauseBtn.textContent = "Pause";
  }

  isPlaying = !isPlaying;
});
