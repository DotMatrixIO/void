// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { GoldCanvas } from './GoldCanvas';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene6 } from './video_scenes/Scene6';

export const SCENE_DURATIONS: Record<string, number> = {
  intro: 3000,
  scan: 8000,
  caption1: 4500,
  caption2: 4500,
  endCard: 9300,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  intro: Scene1,
  scan: Scene2,
  caption1: Scene3,
  caption2: Scene4,
  endCard: Scene6,
};

/* AI-generated talking webcam clip: 24s (8s×3 loop) of a person speaking
   with natural head motion (nods, tilts, lip movement). Both panes use
   the same source file to prove it is the same feed.
   VP9/WebM used for Chromium headless recording compatibility. */
const VIDEO_SRC = `${import.meta.env.BASE_URL}images/webcam-talking.webm`;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  paused = false,
  onSceneChange,
  onVideoEnd,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  paused?: boolean;
  onSceneChange?: (sceneKey: string) => void;
  onVideoEnd?: () => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused, onVideoEnd });

  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);
  const freezeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* The scenes are authored on a fixed 1280×720 canvas (every font size and
     offset is an absolute pixel value tuned for that frame). The stage below is
     fluid — full-screen on desktop, but only a few hundred pixels wide inside
     the landing-page embed or on a phone. Rendering the fixed-px content into a
     narrow stage leaves text oversized: the V[]ID wordmark wraps, the LIVE badge
     collides with captions, and overlays overflow. Measuring the stage and
     uniformly scaling a 1280×720 canvas to fit keeps every proportion identical
     to the 1280×720 recording at any size. */
  const STAGE_W = 1280;
  const STAGE_H = 720;
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / STAGE_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Freeze both video panes 3.5 s into the scan scene (scan-analysis
     moment), then resume at 6.5 s (scan complete). Every other scene
     ensures both clips are playing. When paused=true, scheduled play()
     calls must not fire. */
  useEffect(() => {
    clearTimeout(freezeTimerRef.current);
    clearTimeout(resumeTimerRef.current);

    if (currentSceneKey === 'scan') {
      freezeTimerRef.current = setTimeout(() => {
        leftVideoRef.current?.pause();
        rightVideoRef.current?.pause();
      }, 3500);
      resumeTimerRef.current = setTimeout(() => {
        if (!paused) {
          void leftVideoRef.current?.play().catch(() => {});
          void rightVideoRef.current?.play().catch(() => {});
        }
      }, 6500);
    } else {
      if (!paused) {
        void leftVideoRef.current?.play().catch(() => {});
        void rightVideoRef.current?.play().catch(() => {});
      }
    }

    return () => {
      clearTimeout(freezeTimerRef.current);
      clearTimeout(resumeTimerRef.current);
    };
  }, [currentSceneKey, paused]);

  /* Also pause/resume the webcam videos when paused prop toggles. */
  useEffect(() => {
    if (paused) {
      leftVideoRef.current?.pause();
      rightVideoRef.current?.pause();
    } else {
      void leftVideoRef.current?.play().catch(() => {});
      void rightVideoRef.current?.play().catch(() => {});
    }
  }, [paused]);

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    /* Outer wrapper fills the viewport with letterbox bars; the inner stage is
       locked to 16:9 and centered, so portrait phones never squeeze the video. */
    <div className="w-full h-screen overflow-hidden bg-[#14110D] flex items-center justify-center">
      <div
        ref={stageRef}
        className="relative overflow-hidden bg-[#14110D]"
        style={{
          width: 'min(100vw, calc(100vh * 16 / 9))',
          height: 'min(100vh, calc(100vw * 9 / 16))',
        }}
      >
      {/* Fixed 1280×720 canvas scaled uniformly to fill the fluid stage above,
          so the pixel-tuned scenes never overflow or wrap at small embed sizes. */}
      <div
        className="absolute top-0 left-0 font-mono text-[#F0A500]"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          visibility: scale ? 'visible' : 'hidden',
        }}
      >
      {/* Split-pane background — visible for all scenes except endCard.
          z-0 bounds the GOLD canvas (z-1) inside this stacking context so the
          foreground scenes below sit above it on BOTH panes. */}
      <AnimatePresence>
        {sceneIndex < 4 && (
          <motion.div
            key="split-panes"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 flex z-0"
          >
            {/* ── LEFT PANE: normal webcam video clip ── */}
            <div className="w-1/2 h-full relative overflow-hidden border-r border-[#C4850A]/40">
              {/* Animated portrait video — sinusoidal camera-pan gives natural talking motion */}
              <video
                ref={leftVideoRef}
                src={VIDEO_SRC}
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
              {/* Speech brightness flicker — simulates lip/jaw movement on top of video */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{ mixBlendMode: 'soft-light' }}
                animate={{
                  opacity: [0, 0.12, 0, 0.18, 0.06, 0.14, 0, 0.09, 0.2, 0, 0.07, 0.15, 0],
                  background: [
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.6) 0%, transparent 70%)',
                    'radial-gradient(ellipse 55% 25% at 52% 74%, rgba(255,220,150,0.8) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.3) 0%, transparent 70%)',
                    'radial-gradient(ellipse 65% 32% at 48% 73%, rgba(255,220,150,0.9) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.2) 0%, transparent 70%)',
                    'radial-gradient(ellipse 58% 28% at 51% 72%, rgba(255,220,150,0.7) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.1) 0%, transparent 70%)',
                    'radial-gradient(ellipse 62% 31% at 50% 73%, rgba(255,220,150,0.8) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 49% 72%, rgba(255,220,150,0.5) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.0) 0%, transparent 70%)',
                    'radial-gradient(ellipse 64% 33% at 50% 71%, rgba(255,220,150,0.6) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.9) 0%, transparent 70%)',
                    'radial-gradient(ellipse 60% 30% at 50% 72%, rgba(255,220,150,0.0) 0%, transparent 70%)',
                  ],
                }}
                transition={{
                  duration: 3.6,
                  repeat: Infinity,
                  ease: 'linear',
                  times: [0, 0.08, 0.17, 0.25, 0.33, 0.42, 0.5, 0.58, 0.67, 0.75, 0.83, 0.92, 1],
                }}
              />
              {/* Webcam noise grain */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.08\'/%3E%3C/svg%3E")',
                  opacity: 0.5,
                  mixBlendMode: 'overlay',
                }}
              />
              {/* Scan-line CRT overlay */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(to bottom, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)',
                }}
              />
              <div className="absolute top-6 left-6 bg-[#14110D]/80 px-3 py-1.5 text-xs tracking-[0.2em] text-[#F0A500] border border-[#F0A500]/20 uppercase z-10">
                NORMAL WEBCAM
              </div>
              <div className="absolute top-6 right-6 flex items-center gap-1.5 z-10">
                <motion.div
                  className="w-2 h-2 rounded-full bg-[#CC2200]"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
                <span className="text-xs text-[#CC2200] tracking-widest font-bold">REC</span>
              </div>
            </div>

            {/* ── RIGHT PANE: same video clip through VOID GOLD WebGL2 shader ── */}
            <div className="w-1/2 h-full relative overflow-hidden">
              {/* Source video — same source file as the left pane, proving it is
                  the same feed. Full-size so Chromium delivers decoded frames;
                  the GOLD canvas sits on top and is the only visible output. */}
              <video
                ref={rightVideoRef}
                src={VIDEO_SRC}
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 0 }}
              />
              {/* Exact VOID GOLD WebGL2 shader — duotone luminance mapping with
                  Gaussian blur, radial mosaic, temporal warp, and Bayer dither.
                  Same GLSL as artifacts/void-client/src/lib/mediaPipeline.ts mode 1.
                  Renders on top of the source video, replacing its raw appearance. */}
              <GoldCanvas
                videoRef={rightVideoRef}
                className="absolute inset-0 w-full h-full"
                style={{ zIndex: 1 }}
              />
              {/* Amber heat-map glow pulse */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse 70% 80% at 50% 40%, rgba(196,133,10,0.12) 0%, transparent 70%)',
                }}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* Scanline — shader output aesthetic */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(to bottom, transparent, transparent 3px, rgba(196,133,10,0.06) 3px, rgba(196,133,10,0.06) 4px)',
                }}
                animate={{ y: [0, -60] }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              />
              <div className="absolute top-6 left-6 bg-[#14110D]/80 px-3 py-1.5 text-xs tracking-[0.2em] text-[#F0A500] border border-[#F0A500]/20 uppercase z-10">
                V<span style={{ fontFeatureSettings: '"liga" 0', fontVariantLigatures: 'none', fontSize: 'inherit', lineHeight: 'inherit', letterSpacing: '0.12em', margin: '0 0.04em' }}>[]</span>ID
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LIVE indicator — visible only during the live-camera scenes (sceneIndex < 4).
          Scene6 renders its own LIVE indicator for the dramatic end-card transition. */}
      {sceneIndex < 4 && (
        <div className="absolute top-6 right-6 flex items-center gap-1.5 z-40 pointer-events-none">
          <motion.div
            className="w-2 h-2 rounded-full bg-[#F0A500]"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2.4, repeat: Infinity }}
          />
          <span className="text-xs text-[#F0A500] tracking-widest font-bold">LIVE</span>
        </div>
      )}

      {/* Foreground Scenes — z-30 keeps every overlay box (left AND right pane)
          above the GOLD canvas, which paints at z-1 inside the z-0 split-panes. */}
      <div className="absolute inset-0 z-30 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>
      </div>
      </div>
      </div>
    </div>
  );
}
