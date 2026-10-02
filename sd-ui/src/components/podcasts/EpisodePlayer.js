"use client";

import { useEffect, useRef, useState } from "react";
import { HiPause, HiPlay } from "react-icons/hi2";

/**
 * Play an episode where it is listed: one button, how far in, how long.
 *
 * The browser's own audio control was the only media affordance on the page,
 * and it looks like a form field. This is the same <audio> underneath, with
 * a control that reads as a player: a round play button, a bar you can drag
 * or step with the arrow keys, and the time. A machine reading nobody has
 * approved says so beside it, as before, because "hear how it currently
 * sounds" is a different offer from "listen to the episode".
 *
 * Only one plays at a time: starting one pauses any other on the page.
 */
function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function EpisodePlayer({ src, title, durationSeconds = null, isDraft = false, size = "md" }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [length, setLength] = useState(Number(durationSeconds) || 0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    const onTime = () => setNow(el.currentTime);
    const onMeta = () => { if (Number.isFinite(el.duration)) setLength(el.duration); };
    const onEnd = () => setPlaying(false);
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onError = () => { setFailed(true); setPlaying(false); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("error", onError);
    };
  }, []);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      document.querySelectorAll("audio.pod-player__audio").forEach((other) => { if (other !== el) other.pause(); });
      el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  }

  function seek(event) {
    const el = audio.current;
    const value = Number(event.target.value);
    if (el && Number.isFinite(value)) { el.currentTime = value; setNow(value); }
  }

  const share = length ? Math.min(100, (now / length) * 100) : 0;
  return (
    <div className={`pod-player is-${size}${playing ? " is-playing" : ""}`}>
      <audio ref={audio} className="pod-player__audio" src={src} preload="none" />
      <button type="button" className="pod-player__btn" onClick={toggle} aria-label={`${playing ? "Pause" : "Play"} ${title}`} disabled={failed}>
        {playing ? <HiPause size={size === "lg" ? 22 : 18} aria-hidden /> : <HiPlay size={size === "lg" ? 22 : 18} aria-hidden className="pod-player__play" />}
      </button>
      <div className="pod-player__track">
        <input
          type="range"
          className="pod-player__range"
          min="0"
          max={length || 0}
          step="1"
          value={Math.min(now, length || 0)}
          onChange={seek}
          aria-label={`Position in ${title}`}
          aria-valuetext={`${clock(now)} of ${clock(length)}`}
          disabled={!length || failed}
          style={{ "--pod-progress": `${share}%` }}
        />
        <span className="pod-player__time">
          {failed ? "The audio could not be loaded" : `${clock(now)} / ${length ? clock(length) : "–:––"}`}
          {isDraft && !failed ? <span className="pod-player__draft">Machine reading, not yet approved</span> : null}
        </span>
      </div>
    </div>
  );
}
