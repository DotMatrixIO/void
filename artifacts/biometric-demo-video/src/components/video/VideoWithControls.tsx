// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from '@/lib/video/useSceneControls';

const PROGRESS_TICK_MS = 80;
const AUTO_HIDE_MS = 2000;
const AUDIO_SEEK_EPSILON_SEC = 0.2;

// Cumulative start time (seconds) of each scene + total runtime, derived from
// the same SCENE_DURATIONS the player advances on. Used to keep the music
// track aligned with the scene timeline (loop reset + drift correction) and to
// drive the continuous progress bar.
const SCENE_START_SEC: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const ms of Object.values(SCENE_DURATIONS)) {
    out.push(acc / 1000);
    acc += ms;
  }
  return out;
})();
const TOTAL_MS = Object.values(SCENE_DURATIONS).reduce((a, b) => a + b, 0);

// Map a 0..1 position on the timeline to the scene that contains it. Playback is
// scene-based (each scene is a self-contained animation with no time offset), so
// seeking lands on the start of the scene under the clicked point.
function fractionToIndex(fraction: number): number {
  const ms = Math.max(0, Math.min(1, fraction)) * TOTAL_MS;
  let idx = 0;
  for (let i = 0; i < SCENE_START_SEC.length; i++) {
    if (ms >= SCENE_START_SEC[i] * 1000) idx = i;
    else break;
  }
  return idx;
}

const MUSIC_SRC = `${import.meta.env.BASE_URL}audio/music.mp3`;

interface ControlBarProps {
  visible: boolean;
  paused: boolean;
  muted: boolean;
  progress: number;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onSeek: (fraction: number) => void;
  onScrubEnd: () => void;
}

function ControlBar({
  visible,
  paused,
  muted,
  progress,
  onTogglePause,
  onToggleMute,
  onSeek,
  onScrubEnd,
}: ControlBarProps) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const fractionFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return (clientX - rect.left) / rect.width;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onSeek(fractionFromClientX(e.clientX));
    },
    [fractionFromClientX, onSeek],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      onSeek(fractionFromClientX(e.clientX));
    },
    [fractionFromClientX, onSeek],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      onScrubEnd();
    },
    [onScrubEnd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const curIdx = fractionToIndex(progress);
      const nextIdx = Math.max(
        0,
        Math.min(SCENE_START_SEC.length - 1, curIdx + dir),
      );
      onSeek((SCENE_START_SEC[nextIdx] * 1000) / TOTAL_MS);
      onScrubEnd();
    },
    [progress, onSeek, onScrubEnd],
  );

  return (
    <>
      {/* Hidden-state hairline: a 2px progress line flush to the bottom edge. */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/15 pointer-events-none"
        aria-hidden="true"
      >
        <div className="h-full bg-white/70" style={{ width: `${pct}%` }} />
      </div>

      {/* Visible-state bar: play/pause + thin progress + mute. Height ≤24px. */}
      <div
        className={`absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2 bg-black/55 backdrop-blur-sm transition-all duration-200 ease-out ${
          visible
            ? 'translate-y-0 opacity-100 pointer-events-auto'
            : 'translate-y-full opacity-0 pointer-events-none'
        }`}
        style={{ height: '24px' }}
        aria-hidden={!visible}
      >
        <button
          type="button"
          onClick={onTogglePause}
          tabIndex={visible ? 0 : -1}
          className="flex h-full items-center justify-center text-white/75 hover:text-white transition-colors shrink-0"
          style={{ width: 20 }}
          title={paused ? 'Play' : 'Pause'}
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>

        {/* Seek track: click or drag anywhere along it to jump through the
            timeline. The hit area spans the full bar height for easy targeting;
            the visible rail is a thin line that thickens on hover. */}
        <div
          ref={trackRef}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          tabIndex={visible ? 0 : -1}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="group relative flex-1 h-full flex items-center cursor-pointer touch-none select-none"
          title="Click or drag to seek"
        >
          <div className="relative w-full h-[3px] bg-white/20 rounded-full transition-[height] duration-150 group-hover:h-[5px]">
            <div
              className="absolute inset-y-0 left-0 bg-white/80 rounded-full"
              style={{ width: `${pct}%` }}
            />
            {/* Scrubber handle, revealed on hover/focus. */}
            <div
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          tabIndex={visible ? 0 : -1}
          className="flex h-full items-center justify-center text-white/75 hover:text-white transition-colors shrink-0"
          style={{ width: 20 }}
          title={muted ? 'Unmute music' : 'Mute music'}
          aria-label={muted ? 'Unmute music' : 'Mute music'}
          aria-pressed={!muted}
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;

  // Only autoplay when the landing embed explicitly asks for it via ?autoplay=1
  // (set when the user clicks the poster — a real gesture). On any bare load
  // (opening the app directly, or inside the Replit preview iframe) start paused
  // so the music never plays unprompted on page load.
  const autoplayRequested =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autoplay') === '1';

  const { activeIndex, mountKey, tick, durations, onSceneChange, jumpTo } =
    useSceneControls(SCENE_DURATIONS);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const elapsedRef = useRef(0);
  const seekIdxRef = useRef(-1);

  const [controlsVisible, setControlsVisible] = useState(true);
  // Paused unless the embed requested autoplay (see autoplayRequested above);
  // this prevents the music from auto-starting on a bare page load.
  const [paused, setPaused] = useState(!autoplayRequested);
  // Start unmuted: playback is always user-initiated (autoplay only happens via
  // the gesture-backed ?autoplay=1 poster click), so when it plays it plays with
  // sound. Not muted by default.
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  // The video plays through once and then stops on the final frame (no auto
  // replay). `ended` freezes progress/audio; pressing play restarts from 0.
  const [ended, setEnded] = useState(false);

  // Restart from the beginning. Used by the play button after the video has
  // ended. jumpTo(0) remounts the template (resets its internal hasEnded);
  // the audio align + play effects below realign and resume the track.
  const restart = useCallback(() => {
    setEnded(false);
    setPaused(false);
    seekIdxRef.current = -1;
    jumpTo(0);
  }, [jumpTo]);

  // Hitting play always resumes with sound: any explicit play action (resume
  // from pause, or restart after the video ended) unmutes the music. Pausing
  // leaves the mute state untouched. Initial load still autoplays muted to
  // satisfy the browser autoplay policy.
  const togglePause = useCallback(() => {
    if (ended) {
      setMuted(false);
      restart();
      return;
    }
    if (paused) {
      setMuted(false);
      setPaused(false);
    } else {
      setPaused(true);
    }
  }, [ended, paused, restart]);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // Video reached its final scene. Freeze on the last frame and stop the music.
  const handleVideoEnd = useCallback(() => {
    setEnded(true);
    setProgress(1);
  }, []);

  // Auto-hide: any reveal restarts the ~2s countdown back to hidden.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(
      () => setControlsVisible(false),
      AUTO_HIDE_MS,
    );
  }, []);

  useEffect(() => {
    revealControls();
    return () => window.clearTimeout(hideTimerRef.current);
  }, [revealControls]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse') revealControls();
    },
    [revealControls],
  );
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Touch/pen taps reveal the controls (mouse is handled by move).
      if (e.pointerType !== 'mouse') revealControls();
    },
    [revealControls],
  );

  // Seek to the scene under a 0..1 timeline position. jumpTo remounts the
  // template at that scene; the progress/audio effects below realign from the
  // new activeIndex. Guarded so a drag staying within one scene doesn't trigger
  // repeated remounts.
  const seekToFraction = useCallback(
    (fraction: number) => {
      revealControls();
      setEnded(false);
      const idx = fractionToIndex(fraction);
      if (idx === seekIdxRef.current) return;
      seekIdxRef.current = idx;
      jumpTo(idx);
    },
    [jumpTo, revealControls],
  );

  const endScrub = useCallback(() => {
    seekIdxRef.current = -1;
  }, []);

  // Continuous progress: reset per-scene elapsed on each scene change, then
  // advance only while playing. Overall fraction = (sceneStart + elapsed)/total.
  useEffect(() => {
    elapsedRef.current = 0;
    setProgress((SCENE_START_SEC[activeIndex] * 1000) / TOTAL_MS);
  }, [tick, activeIndex]);

  useEffect(() => {
    if (paused || ended) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      elapsedRef.current += now - last;
      last = now;
      const overallMs = SCENE_START_SEC[activeIndex] * 1000 + elapsedRef.current;
      setProgress(Math.min(1, overallMs / TOTAL_MS));
    }, PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, ended, tick, activeIndex]);

  // Keep the <audio> muted flag in sync with the mute toggle (starts unmuted).
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // Ramp the music volume from 20% at the start to 100% at the end, tracking
  // the overall timeline progress (0..1). Runs on every progress tick for a
  // smooth swell across the video.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const p = Math.max(0, Math.min(1, progress));
    audio.volume = 0.2 + 0.8 * p;
  }, [progress]);

  // Play/pause the music alongside the video. Also pauses when the video has
  // ended (plays through once, no auto replay); restart() clears `ended`.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (paused || ended) {
      audio.pause();
    } else {
      void audio.play().catch(() => {});
    }
  }, [paused, ended]);

  // Align the music to the scene timeline. On restart the active scene resets
  // to index 0 (start = 0), which restarts the track; seeking jumps the track to
  // the target scene's start; small drifts mid-playback are left alone via the
  // epsilon guard.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const expected = SCENE_START_SEC[activeIndex] ?? 0;
    if (Math.abs(audio.currentTime - expected) > AUDIO_SEEK_EPSILON_SEC) {
      audio.currentTime = expected;
    }
  }, [tick, activeIndex]);

  if (!isIframed) return <VideoTemplate />;

  return (
    <div
      className="relative w-full h-screen overflow-hidden bg-[#14110D] cursor-pointer"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onClick={togglePause}
    >
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop={false}
        paused={paused}
        onSceneChange={onSceneChange}
        onVideoEnd={handleVideoEnd}
      />

      <audio ref={audioRef} src={MUSIC_SRC} preload="auto" playsInline />

      {/* Paused indicator (non-interactive). */}
      <div
        className={`absolute inset-0 z-40 flex items-center justify-center pointer-events-none transition-opacity duration-200 ${
          paused ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-black/45 backdrop-blur-sm">
          <Play className="w-8 h-8 text-white/90" />
        </div>
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-50"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <ControlBar
          visible={controlsVisible}
          paused={paused}
          muted={muted}
          progress={progress}
          onTogglePause={togglePause}
          onToggleMute={toggleMute}
          onSeek={seekToFraction}
          onScrubEnd={endScrub}
        />
      </div>
    </div>
  );
}
