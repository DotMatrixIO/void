// SPDX-License-Identifier: AGPL-3.0-or-later
import { getAudioContext, registerBeforeAudioClose } from "./sounds";

type Waveform = OscillatorType | "noise";

interface Note {
  freq: number;
  duration: number;
  wave?: Waveform;
  gain?: number;
}

interface Track {
  notes: Note[];
  loopDuration: number;
}

interface ChiptuneDefinition {
  name: string;
  bpm: number;
  tracks: Track[];
  masterGain?: number;
}

let currentNodes: { sources: (OscillatorNode | AudioBufferSourceNode)[]; gains: GainNode[]; master: GainNode } | null = null;
let loopTimer: number | null = null;
let fadeOutTimer: number | null = null;
let currentTrackId: string | null = null;
let activeMasterGain = 0.5;

const FADE_IN = 1.5;
const FADE_OUT = 1.5;

const MUSIC_KEY = "2bit_music_enabled";

let musicEnabled = false;
try {
  musicEnabled = localStorage.getItem(MUSIC_KEY) === "1";
} catch {}

function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.ceil(sampleRate * duration);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function scheduleTrackNotes(
  ctx: AudioContext,
  track: Track,
  masterGain: GainNode,
  startTime: number,
  sources: (OscillatorNode | AudioBufferSourceNode)[],
  gains: GainNode[]
): void {
  let time = startTime;
  for (const note of track.notes) {
    if (note.freq === 0) {
      time += note.duration;
      continue;
    }

    const noteGain = ctx.createGain();
    const vol = note.gain ?? 0.15;
    noteGain.gain.setValueAtTime(vol, time);
    noteGain.gain.setValueAtTime(vol, time + note.duration * 0.7);
    noteGain.gain.exponentialRampToValueAtTime(0.001, time + note.duration * 0.95);
    noteGain.connect(masterGain);
    gains.push(noteGain);

    if (note.wave === "noise") {
      const noiseBuffer = createNoiseBuffer(ctx, note.duration);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const bpf = ctx.createBiquadFilter();
      bpf.type = "highpass";
      bpf.frequency.value = note.freq;
      noise.connect(bpf);
      bpf.connect(noteGain);
      noise.start(time);
      noise.stop(time + note.duration);
      sources.push(noise);
    } else {
      const osc = ctx.createOscillator();
      osc.type = (note.wave as OscillatorType) || "square";
      osc.frequency.setValueAtTime(note.freq, time);
      osc.connect(noteGain);
      osc.start(time);
      osc.stop(time + note.duration);
      sources.push(osc);
    }

    time += note.duration;
  }
}

function s(beat: number, bpm: number): number {
  return (60 / bpm) * beat;
}

function n(freq: number, beats: number, bpm: number, wave?: Waveform, gain?: number): Note {
  return { freq, duration: s(beats, bpm), wave, gain };
}

function rest(beats: number, bpm: number): Note {
  return { freq: 0, duration: s(beats, bpm) };
}

const C3 = 130.81, D3 = 146.83, E3 = 164.81, F3 = 174.61, G3 = 196.00, A3 = 220.00, B3 = 246.94;
const C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23, G4 = 392.00, A4 = 440.00, B4 = 493.88;
const C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00, B5 = 987.77;
const C6 = 1046.50;
const Bb3 = 233.08, Eb4 = 311.13, Ab4 = 415.30, Bb4 = 466.16;
const Eb3 = 155.56, Ab3 = 207.65;
const Gb4 = 369.99, Db4 = 277.18, Db5 = 554.37, Ab5 = 830.61, Eb5 = 622.25, Bb5 = 932.33;
const Gb3 = 185.00, Db3 = 138.59;

function lobbyWaltz(): ChiptuneDefinition {
  const bpm = 108;
  const melody: Note[] = [
    n(E5, 1, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm),
    n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1.5, bpm), rest(0.5, bpm),
    n(D5, 1, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm),
    n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1.5, bpm), rest(0.5, bpm),
    n(E5, 1, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(B5, 1, bpm),
    n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 1.5, bpm), rest(0.5, bpm),
    n(G5, 1, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1.5, bpm),
    n(D5, 0.5, bpm), n(E5, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(G3, 1, bpm, "triangle", 0.2),
    n(A3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(E3, 1, bpm, "triangle", 0.2),
    n(F3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(C3, 1, bpm, "triangle", 0.2),
    n(G3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(D3, 1, bpm, "triangle", 0.2),
    n(C3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(G3, 1, bpm, "triangle", 0.2),
    n(A3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(E3, 1, bpm, "triangle", 0.2),
    n(F3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(G3, 1, bpm, "triangle", 0.2),
    n(C3, 1.5, bpm, "triangle", 0.2), rest(0.5, bpm), n(G3, 1, bpm, "triangle", 0.2),
  ];
  const arp: Note[] = [];
  const arpPattern = [C4, E4, G4, E4, C4, E4, G4, E4, A3, C4, E4, C4, A3, C4, E4, C4,
    F3, A3, C4, A3, F3, A3, C4, A3, G3, B3, D4, B3, G3, B3, D4, B3,
    C4, E4, G4, E4, C4, E4, G4, E4, A3, C4, E4, C4, A3, C4, E4, C4,
    F3, A3, C4, A3, G3, B3, D4, B3, C4, E4, G4, E4, C4, E4, G4, E4];
  for (const f of arpPattern) {
    arp.push(n(f, 0.375, bpm, "square", 0.06));
  }
  const totalBeats = 24;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Lobby Waltz", bpm, masterGain: 0.4,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: arp, loopDuration }] };
}

function morningDew(): ChiptuneDefinition {
  const bpm = 90;
  const melody: Note[] = [
    n(G4, 1.5, bpm), n(A4, 0.5, bpm), n(B4, 1, bpm), n(D5, 1, bpm),
    n(C5, 1.5, bpm), rest(0.5, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(E4, 2, bpm), rest(0.5, bpm), n(D4, 0.5, bpm), n(E4, 1, bpm),
    n(G4, 1.5, bpm), n(A4, 0.5, bpm), n(B4, 1, bpm), n(G4, 1, bpm),
    n(A4, 1.5, bpm), n(B4, 0.5, bpm), n(D5, 1, bpm), n(E5, 1, bpm),
    n(D5, 1.5, bpm), rest(0.5, bpm), n(B4, 1, bpm), n(A4, 1, bpm),
    n(G4, 2, bpm), rest(0.5, bpm), n(E4, 0.5, bpm), n(D4, 1, bpm),
    n(C4, 2, bpm), rest(1, bpm), n(D4, 1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 2, bpm, "triangle", 0.18), n(E3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
    n(G3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(C3, 2, bpm, "triangle", 0.18), n(E3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(D3, 2, bpm, "triangle", 0.18),
    n(G3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
  ];
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Morning Dew", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function pixelGarden(): ChiptuneDefinition {
  const bpm = 100;
  const melody: Note[] = [
    n(C5, 0.75, bpm), n(E5, 0.75, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(A5, 1, bpm), n(G5, 0.5, bpm),
    n(F5, 1, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(0.5, bpm),
    n(D5, 0.75, bpm), n(F5, 0.75, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(F5, 1, bpm), n(E5, 0.5, bpm),
    n(D5, 1, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), rest(0.5, bpm),
    n(G5, 0.75, bpm), n(A5, 0.75, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(C5, 1, bpm), n(D5, 0.5, bpm),
    n(E5, 1, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm), rest(0.5, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1.5, bpm, "triangle", 0.2), n(G3, 1, bpm, "triangle", 0.15), n(A3, 1.5, bpm, "triangle", 0.2),
    n(F3, 1.5, bpm, "triangle", 0.2), n(G3, 1, bpm, "triangle", 0.15), n(C3, 1.5, bpm, "triangle", 0.2),
    n(D3, 1.5, bpm, "triangle", 0.2), n(F3, 1, bpm, "triangle", 0.15), n(G3, 1.5, bpm, "triangle", 0.2),
    n(C3, 1.5, bpm, "triangle", 0.2), n(E3, 1, bpm, "triangle", 0.15), n(G3, 1.5, bpm, "triangle", 0.2),
    n(A3, 1.5, bpm, "triangle", 0.2), n(F3, 1, bpm, "triangle", 0.15), n(C3, 1.5, bpm, "triangle", 0.2),
    n(G3, 1.5, bpm, "triangle", 0.2), n(E3, 1, bpm, "triangle", 0.15), n(C3, 1.5, bpm, "triangle", 0.2),
  ];
  const arp: Note[] = [];
  const chords = [[C4,E4,G4],[A3,C4,E4],[F3,A3,C4],[G3,B3,D4],[D4,F4,A4],[G3,B3,D4],[C4,E4,G4],[F3,A3,C4]];
  for (const ch of chords) {
    for (let r = 0; r < 3; r++) for (const f of ch) arp.push(n(f, 0.25, bpm, "square", 0.05));
    arp.push(rest(0.75, bpm));
  }
  const totalBeats = 24;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Pixel Garden", bpm, masterGain: 0.38,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: arp, loopDuration }] };
}

function starfield(): ChiptuneDefinition {
  const bpm = 72;
  const melody: Note[] = [
    n(E5, 2, bpm), n(D5, 1, bpm), n(C5, 1, bpm),
    n(B4, 2, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(A4, 2, bpm), n(C5, 1, bpm), n(B4, 1, bpm),
    n(G4, 3, bpm), rest(1, bpm),
    n(C5, 2, bpm), n(D5, 1, bpm), n(E5, 1, bpm),
    n(D5, 2, bpm), n(C5, 1, bpm), n(A4, 1, bpm),
    n(B4, 2, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(E4, 3, bpm), rest(1, bpm),
  ];
  const pad: Note[] = [];
  const padChords = [[E4,G4,B4],[A3,C4,E4],[F3,A3,C4],[G3,B3,D4],[C4,E4,G4],[D4,F4,A4],[G3,B3,D4],[E3,G3,B3]];
  for (const ch of padChords) {
    for (const f of ch) pad.push(n(f, 4, bpm, "triangle", 0.08));
  }
  const bass: Note[] = [
    n(E3, 4, bpm, "triangle", 0.2), n(A3, 4, bpm, "triangle", 0.2),
    n(F3, 4, bpm, "triangle", 0.2), n(G3, 4, bpm, "triangle", 0.2),
    n(C3, 4, bpm, "triangle", 0.2), n(D3, 4, bpm, "triangle", 0.2),
    n(G3, 4, bpm, "triangle", 0.2), n(E3, 4, bpm, "triangle", 0.2),
  ];
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Starfield", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function teaRoom(): ChiptuneDefinition {
  const bpm = 96;
  const melody: Note[] = [
    n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm),
    n(D5, 1, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), rest(0.5, bpm),
    n(G4, 0.5, bpm), n(A4, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), n(C5, 0.5, bpm),
    n(A4, 1, bpm), n(G4, 0.5, bpm), n(A4, 0.5, bpm), n(G4, 1, bpm), rest(0.5, bpm),
    n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm),
    n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(A4, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1.5, bpm, "triangle", 0.18), n(G3, 0.5, bpm, "triangle", 0.12), n(C3, 1, bpm, "triangle", 0.18),
    n(F3, 1.5, bpm, "triangle", 0.18), n(C3, 0.5, bpm, "triangle", 0.12), n(G3, 1, bpm, "triangle", 0.18),
    n(A3, 1.5, bpm, "triangle", 0.18), n(E3, 0.5, bpm, "triangle", 0.12), n(A3, 1, bpm, "triangle", 0.18),
    n(G3, 1.5, bpm, "triangle", 0.18), n(D3, 0.5, bpm, "triangle", 0.12), n(G3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.18), n(G3, 0.5, bpm, "triangle", 0.12), n(E3, 1, bpm, "triangle", 0.18),
    n(F3, 1.5, bpm, "triangle", 0.18), n(C3, 1, bpm, "triangle", 0.18), n(G3, 0.5, bpm, "triangle", 0.12),
    n(A3, 1.5, bpm, "triangle", 0.18), n(G3, 0.5, bpm, "triangle", 0.12), n(C3, 1, bpm, "triangle", 0.18),
  ];
  const totalBeats = 21;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Tea Room", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function cloudWalk(): ChiptuneDefinition {
  const bpm = 84;
  const melody: Note[] = [
    n(G5, 1.5, bpm), n(E5, 0.5, bpm), n(C5, 1, bpm), n(D5, 1, bpm),
    n(E5, 1.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), n(A4, 1, bpm),
    n(G4, 2, bpm), n(C5, 1, bpm), n(D5, 1, bpm),
    n(E5, 1.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    n(E5, 1.5, bpm), n(D5, 0.5, bpm), n(C5, 2, bpm),
    n(D5, 1, bpm), n(E5, 1, bpm), n(C5, 2, bpm),
    n(A4, 1, bpm), n(G4, 1, bpm), n(C5, 2, bpm),
    n(D5, 1, bpm), n(C5, 1, bpm), n(G4, 2, bpm),
  ];
  const bass: Note[] = [
    n(C3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(A3, 2, bpm, "triangle", 0.18), n(F3, 2, bpm, "triangle", 0.18),
    n(G3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(C3, 2, bpm, "triangle", 0.18), n(A3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(A3, 2, bpm, "triangle", 0.18), n(F3, 2, bpm, "triangle", 0.18),
    n(G3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
  ];
  const arp: Note[] = [];
  const arps = [[C4,E4,G4],[A3,C4,E4],[F3,A3,C4],[G3,B3,D4],[C4,E4,G4],[F3,A3,C4],[A3,C4,E4],[G3,B3,D4]];
  for (const ch of arps) {
    for (let r = 0; r < 4; r++) for (const f of ch) arp.push(n(f, 0.25, bpm, "square", 0.04));
    arp.push(rest(1, bpm));
  }
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Cloud Walk", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: arp, loopDuration }] };
}

function porchSwing(): ChiptuneDefinition {
  const bpm = 115;
  const melody: Note[] = [
    n(E5, 0.75, bpm), n(D5, 0.25, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm),
    n(G5, 0.75, bpm), n(E5, 0.25, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm),
    n(C5, 0.75, bpm), n(D5, 0.25, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm),
    n(G5, 0.75, bpm), n(E5, 0.25, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(E5, 1, bpm),
    n(C5, 0.75, bpm), n(E5, 0.25, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm),
    n(E5, 0.75, bpm), n(D5, 0.25, bpm), n(C5, 0.5, bpm), n(A4, 0.5, bpm), n(G4, 1, bpm),
    n(A4, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1, bpm, "triangle", 0.2), n(G3, 0.5, bpm, "triangle", 0.12), n(E3, 0.5, bpm, "triangle", 0.12), n(C3, 1, bpm, "triangle", 0.2),
    n(F3, 1, bpm, "triangle", 0.2), n(C3, 0.5, bpm, "triangle", 0.12), n(A3, 0.5, bpm, "triangle", 0.12), n(F3, 1, bpm, "triangle", 0.2),
    n(G3, 1, bpm, "triangle", 0.2), n(D3, 0.5, bpm, "triangle", 0.12), n(G3, 0.5, bpm, "triangle", 0.12), n(C3, 1, bpm, "triangle", 0.2),
    n(A3, 1, bpm, "triangle", 0.2), n(E3, 0.5, bpm, "triangle", 0.12), n(C3, 0.5, bpm, "triangle", 0.12), n(G3, 1, bpm, "triangle", 0.2),
    n(F3, 1, bpm, "triangle", 0.2), n(A3, 0.5, bpm, "triangle", 0.12), n(C3, 0.5, bpm, "triangle", 0.12), n(G3, 1, bpm, "triangle", 0.2),
    n(C3, 1, bpm, "triangle", 0.2), n(E3, 0.5, bpm, "triangle", 0.12), n(G3, 0.5, bpm, "triangle", 0.12), n(C3, 1, bpm, "triangle", 0.2),
    n(F3, 1, bpm, "triangle", 0.2), n(G3, 1, bpm, "triangle", 0.2), n(C3, 1, bpm, "triangle", 0.2), rest(1, bpm),
  ];
  const totalBeats = 22;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Porch Swing", bpm, masterGain: 0.38,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function rainyPixels(): ChiptuneDefinition {
  const bpm = 88;
  const arp: Note[] = [];
  const chords = [
    [A3,C4,E4], [F3,A3,C4], [G3,B3,D4], [E3,G3,B3],
    [A3,C4,E4], [D4,F4,A4], [G3,B3,D4], [C4,E4,G4],
  ];
  for (const ch of chords) {
    for (let r = 0; r < 4; r++) {
      for (const f of ch) arp.push(n(f, 0.25, bpm, "square", 0.06));
    }
  }
  const melody: Note[] = [
    rest(2, bpm), n(E5, 1.5, bpm), n(D5, 0.5, bpm),
    n(C5, 2, bpm), n(A4, 1, bpm), n(B4, 1, bpm),
    n(C5, 2, bpm), rest(1, bpm), n(D5, 1, bpm),
    n(E5, 1.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    rest(2, bpm), n(E5, 1.5, bpm), n(C5, 0.5, bpm),
    n(D5, 2, bpm), n(F5, 1, bpm), n(E5, 1, bpm),
    n(D5, 2, bpm), rest(1, bpm), n(B4, 1, bpm),
    n(C5, 2, bpm), n(E5, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(A3, 4, bpm, "triangle", 0.18), n(F3, 4, bpm, "triangle", 0.18),
    n(G3, 4, bpm, "triangle", 0.18), n(E3, 4, bpm, "triangle", 0.18),
    n(A3, 4, bpm, "triangle", 0.18), n(D3, 4, bpm, "triangle", 0.18),
    n(G3, 4, bpm, "triangle", 0.18), n(C3, 4, bpm, "triangle", 0.18),
  ];
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Rainy Pixels", bpm, masterGain: 0.35,
    tracks: [{ notes: arp, loopDuration }, { notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function lateNightSave(): ChiptuneDefinition {
  const bpm = 76;
  const melody: Note[] = [
    n(A4, 2, bpm), n(C5, 1, bpm), n(E5, 1, bpm),
    n(D5, 2, bpm), n(C5, 1, bpm), n(A4, 1, bpm),
    n(G4, 2, bpm), n(A4, 1, bpm), n(C5, 1, bpm),
    n(B4, 3, bpm), rest(1, bpm),
    n(C5, 2, bpm), n(E5, 1, bpm), n(G5, 1, bpm),
    n(F5, 2, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(C5, 2, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(A4, 3, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(A3, 4, bpm, "triangle", 0.2), n(F3, 4, bpm, "triangle", 0.2),
    n(G3, 4, bpm, "triangle", 0.2), n(E3, 4, bpm, "triangle", 0.2),
    n(C3, 4, bpm, "triangle", 0.2), n(D3, 4, bpm, "triangle", 0.2),
    n(F3, 4, bpm, "triangle", 0.2), n(A3, 4, bpm, "triangle", 0.2),
  ];
  const pad: Note[] = [];
  const padNotes = [[A3,C4,E4],[F3,A3,C4],[G3,B3,D4],[E3,G3,B3],[C4,E4,G4],[D4,F4,A4],[F3,A3,C4],[A3,C4,E4]];
  for (const ch of padNotes) {
    for (const f of ch) pad.push(n(f, 4, bpm, "square", 0.03));
  }
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Late Night Save", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: pad, loopDuration }] };
}

function sunnyRoute(): ChiptuneDefinition {
  const bpm = 120;
  const melody: Note[] = [
    n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 1, bpm), n(E5, 0.5, bpm),
    n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(A4, 1, bpm), rest(0.5, bpm),
    n(G4, 0.5, bpm), n(A4, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), n(C5, 0.5, bpm),
    n(A4, 0.5, bpm), n(G4, 0.5, bpm), n(C5, 1, bpm), rest(0.5, bpm),
    n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm), n(E5, 0.5, bpm),
    n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 1, bpm), rest(0.5, bpm),
    n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1, bpm, "triangle", 0.2), n(E3, 0.5, bpm, "triangle", 0.15), n(G3, 0.5, bpm, "triangle", 0.15), n(C3, 1, bpm, "triangle", 0.2),
    n(F3, 1, bpm, "triangle", 0.2), n(A3, 0.5, bpm, "triangle", 0.15), n(C3, 0.5, bpm, "triangle", 0.15), n(F3, 1, bpm, "triangle", 0.2),
    n(G3, 1, bpm, "triangle", 0.2), n(B3, 0.5, bpm, "triangle", 0.15), n(D3, 0.5, bpm, "triangle", 0.15), n(G3, 1, bpm, "triangle", 0.2),
    n(A3, 1, bpm, "triangle", 0.2), n(E3, 0.5, bpm, "triangle", 0.15), n(C3, 0.5, bpm, "triangle", 0.15), n(G3, 1, bpm, "triangle", 0.2),
    n(C3, 1, bpm, "triangle", 0.2), n(G3, 0.5, bpm, "triangle", 0.15), n(E3, 0.5, bpm, "triangle", 0.15), n(C3, 1, bpm, "triangle", 0.2),
    n(F3, 1, bpm, "triangle", 0.2), n(C3, 0.5, bpm, "triangle", 0.15), n(G3, 0.5, bpm, "triangle", 0.15), n(C3, 1, bpm, "triangle", 0.2),
    n(G3, 1.5, bpm, "triangle", 0.2), n(C3, 1.5, bpm, "triangle", 0.2), rest(1, bpm),
  ];
  const totalBeats = 21;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Sunny Route", bpm, masterGain: 0.38,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function fireflyCove(): ChiptuneDefinition {
  const bpm = 92;
  const melody: Note[] = [
    n(E5, 1, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(A4, 1, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(G5, 1, bpm),
    n(A5, 1.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(C5, 2, bpm), rest(1, bpm), n(D5, 1, bpm),
    n(E5, 1, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm), n(E5, 1, bpm),
    n(D5, 1, bpm), n(C5, 0.5, bpm), n(A4, 0.5, bpm), n(G4, 1, bpm), n(A4, 1, bpm),
    n(C5, 1.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(C5, 1, bpm),
    n(A4, 2, bpm), rest(1, bpm), n(G4, 1, bpm),
  ];
  const bass: Note[] = [
    n(A3, 2, bpm, "triangle", 0.18), n(E3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
    n(D3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(C3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(A3, 2, bpm, "triangle", 0.18), n(E3, 2, bpm, "triangle", 0.18),
    n(F3, 2, bpm, "triangle", 0.18), n(C3, 2, bpm, "triangle", 0.18),
    n(D3, 2, bpm, "triangle", 0.18), n(G3, 2, bpm, "triangle", 0.18),
    n(A3, 2, bpm, "triangle", 0.18), n(E3, 2, bpm, "triangle", 0.18),
  ];
  const arp: Note[] = [];
  const chords = [[A3,C4,E4],[F3,A3,C4],[D4,F4,A4],[G3,B3,D4],[A3,C4,E4],[F3,A3,C4],[D4,F4,A4],[E3,G3,B3]];
  for (const ch of chords) {
    for (let r = 0; r < 4; r++) for (const f of ch) arp.push(n(f, 0.25, bpm, "square", 0.04));
    arp.push(rest(1, bpm));
  }
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Firefly Cove", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: arp, loopDuration }] };
}

function tavernLoop(): ChiptuneDefinition {
  const bpm = 126;
  const melody: Note[] = [
    n(G4, 0.5, bpm), n(G4, 0.5, bpm), n(B4, 0.5, bpm), n(D5, 0.5, bpm), n(D5, 1, bpm), n(B4, 0.5, bpm), n(A4, 0.5, bpm),
    n(G4, 0.5, bpm), n(G4, 0.5, bpm), n(B4, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(D5, 0.5, bpm), n(B4, 0.5, bpm),
    n(A4, 0.5, bpm), n(A4, 0.5, bpm), n(B4, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(D5, 0.5, bpm), n(B4, 0.5, bpm),
    n(G4, 1, bpm), n(A4, 0.5, bpm), n(B4, 0.5, bpm), n(G4, 1, bpm), rest(1, bpm),

    n(D5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(G5, 1, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm),
    n(D5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm),
    n(D5, 0.5, bpm), n(B4, 0.5, bpm), n(A4, 0.5, bpm), n(B4, 0.5, bpm), n(D5, 1, bpm), n(B4, 0.5, bpm), n(A4, 0.5, bpm),
    n(G4, 1.5, bpm), n(B4, 0.5, bpm), n(G4, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(B3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(D3, 1, bpm, "triangle", 0.22), n(A3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18), n(G3, 1, bpm, "triangle", 0.22), rest(1, bpm),

    n(G3, 1, bpm, "triangle", 0.22), n(B3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(B3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(D3, 1, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(A3, 0.5, bpm, "triangle", 0.14), n(D3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(G3, 1.5, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Tavern Loop", bpm, masterGain: 0.4,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }] };
}

function rollCall(): ChiptuneDefinition {
  const bpm = 132;
  const melody: Note[] = [
    n(C5, 0.5, bpm), n(C5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(G5, 1, bpm), n(E5, 1, bpm),
    n(D5, 0.5, bpm), n(D5, 0.5, bpm), n(F5, 0.5, bpm), n(A5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    n(E5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), n(E5, 1, bpm),
    n(C5, 1.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),

    n(G5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(C5, 1, bpm),
    n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 1, bpm), n(C5, 1, bpm),
    n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(C5, 1.5, bpm), n(E5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(D3, 1, bpm, "triangle", 0.22), n(A3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(F3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),

    n(C3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];
  const perc: Note[] = [];
  for (let i = 0; i < 32; i++) {
    if (i % 2 === 0) {
      perc.push(n(8000, 0.25, bpm, "noise" as Waveform, 0.04));
      perc.push(rest(0.75, bpm));
    } else {
      perc.push(rest(0.5, bpm));
      perc.push(n(12000, 0.2, bpm, "noise" as Waveform, 0.025));
      perc.push(rest(0.3, bpm));
    }
  }
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Roll Call", bpm, masterGain: 0.38,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: perc, loopDuration }] };
}

function lastRound(): ChiptuneDefinition {
  const bpm = 110;
  const melody: Note[] = [
    n(E4, 1, bpm), n(G4, 0.5, bpm), n(A4, 0.5, bpm), n(C5, 1, bpm), n(B4, 0.5, bpm), n(A4, 0.5, bpm),
    n(G4, 1, bpm), n(E4, 0.5, bpm), n(G4, 0.5, bpm), n(A4, 1, bpm), n(G4, 1, bpm),
    n(E4, 1, bpm), n(G4, 0.5, bpm), n(A4, 0.5, bpm), n(C5, 1, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm),
    n(D5, 1, bpm), n(C5, 0.5, bpm), n(A4, 0.5, bpm), n(G4, 1, bpm), rest(1, bpm),

    n(C5, 1, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 1, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm),
    n(C5, 1, bpm), n(A4, 0.5, bpm), n(G4, 0.5, bpm), n(A4, 1, bpm), n(C5, 1, bpm),
    n(D5, 1, bpm), n(C5, 0.5, bpm), n(A4, 0.5, bpm), n(G4, 1, bpm), n(A4, 0.5, bpm), n(G4, 0.5, bpm),
    n(E4, 1.5, bpm), n(G4, 0.5, bpm), n(E4, 1, bpm), rest(1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(G3, 1.5, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(D3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(A3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18), rest(1, bpm),

    n(C3, 1.5, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(A3, 1.5, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(F3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(G3, 1.5, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];
  const arp: Note[] = [];
  const chords = [
    [C4,E4,G4],[G3,B3,D4],[C4,E4,G4],[G3,B3,D4],
    [A3,C4,E4],[F3,A3,C4],[G3,B3,D4],[C4,E4,G4],
  ];
  for (const ch of chords) {
    for (let r = 0; r < 4; r++) {
      arp.push(n(ch[0], 0.25, bpm, "square", 0.04));
      arp.push(n(ch[1], 0.25, bpm, "square", 0.04));
      arp.push(n(ch[2], 0.25, bpm, "square", 0.04));
      arp.push(n(ch[1], 0.25, bpm, "square", 0.04));
    }
  }
  const totalBeats = 32;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Last Round", bpm, masterGain: 0.38,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: arp, loopDuration }] };
}

function rollCallFast(): ChiptuneDefinition {
  const bpm = 285;

  const v1melody: Note[] = [
    n(C5, 0.5, bpm), n(C5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(G5, 1, bpm), n(E5, 1, bpm),
    n(D5, 0.5, bpm), n(D5, 0.5, bpm), n(F5, 0.5, bpm), n(A5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    n(E5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), n(E5, 1, bpm),
    n(C5, 1.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
    n(G5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(C5, 1, bpm),
    n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 1, bpm), n(C5, 1, bpm),
    n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(C5, 1.5, bpm), n(E5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];

  const v2melody: Note[] = [
    n(E5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm), n(E5, 1, bpm),
    n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), n(D5, 1, bpm),
    n(E5, 1.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), rest(1, bpm),
    n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(G5, 1, bpm),
    n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 1, bpm), n(C5, 1, bpm),
    n(E5, 1.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];

  const v3melody: Note[] = [
    n(G5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(G5, 1, bpm),
    n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), n(D5, 1, bpm),
    n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(C5, 1, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
    n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 1, bpm), n(E5, 1, bpm),
    n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 1, bpm), n(E5, 1, bpm),
    n(C5, 1.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), rest(1, bpm),
  ];

  const v4melody: Note[] = [
    n(C5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(C5, 1, bpm), n(D5, 1, bpm),
    n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 1, bpm), n(D5, 1, bpm),
    n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), n(E5, 1, bpm),
    n(D5, 1.5, bpm), n(C5, 0.5, bpm), n(D5, 1, bpm), rest(1, bpm),
    n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 1, bpm), n(G5, 1, bpm),
    n(A5, 0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), n(D5, 1, bpm),
    n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 1, bpm), n(G5, 1, bpm),
    n(G5, 1, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm), n(C5, 1, bpm), rest(1, bpm),
  ];

  const melody: Note[] = [...v1melody, ...v2melody, ...v3melody, ...v4melody];

  const b1: Note[] = [
    n(C3, 1, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(D3, 1, bpm, "triangle", 0.22), n(A3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(F3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
    n(C3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];

  const b2: Note[] = [
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(A3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(F3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(F3, 0.5, bpm, "triangle", 0.14), n(A3, 1, bpm, "triangle", 0.22), n(F3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), rest(1, bpm),
    n(F3, 1, bpm, "triangle", 0.22), n(A3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(F3, 1, bpm, "triangle", 0.22), n(A3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];

  const b3: Note[] = [
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(A3, 0.5, bpm, "triangle", 0.14), n(F3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(C3, 1, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(E3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(F3, 1.5, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), rest(1, bpm),
    n(D3, 1, bpm, "triangle", 0.22), n(A3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(C3, 1, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(E3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(D3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(C3, 1.5, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];

  const b4: Note[] = [
    n(C3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(A3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(F3, 1, bpm, "triangle", 0.22), n(A3, 0.5, bpm, "triangle", 0.14), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(D3, 1, bpm, "triangle", 0.22), n(G3, 0.5, bpm, "triangle", 0.14), n(D3, 0.5, bpm, "triangle", 0.14), n(A3, 1, bpm, "triangle", 0.22), n(D3, 1, bpm, "triangle", 0.18),
    n(G3, 1.5, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 1, bpm, "triangle", 0.22), rest(1, bpm),
    n(A3, 1, bpm, "triangle", 0.22), n(E3, 0.5, bpm, "triangle", 0.14), n(A3, 0.5, bpm, "triangle", 0.14), n(F3, 1, bpm, "triangle", 0.22), n(C3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(D3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(G3, 1, bpm, "triangle", 0.18),
    n(F3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), n(E3, 1, bpm, "triangle", 0.18),
    n(G3, 1, bpm, "triangle", 0.22), n(C3, 0.5, bpm, "triangle", 0.14), n(G3, 0.5, bpm, "triangle", 0.14), n(C3, 1, bpm, "triangle", 0.22), rest(1, bpm),
  ];

  const bass: Note[] = [...b1, ...b2, ...b3, ...b4];

  const perc: Note[] = [];
  for (let i = 0; i < 128; i++) {
    if (i % 2 === 0) {
      perc.push(n(8000, 0.25, bpm, "noise" as Waveform, 0.05));
      perc.push(rest(0.75, bpm));
    } else {
      perc.push(rest(0.5, bpm));
      perc.push(n(12000, 0.2, bpm, "noise" as Waveform, 0.03));
      perc.push(rest(0.3, bpm));
    }
  }
  const totalBeats = 128;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Roll Call (Fast)", bpm, masterGain: 0.35,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: perc, loopDuration }] };
}

function arcadeFever(): ChiptuneDefinition {
  const bpm = 135;
  const melody: Note[] = [
    n(E5, 0.5, bpm), rest(0.25, bpm), n(E5, 0.25, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm),
    rest(0.5, bpm), n(G5, 0.5, bpm), n(E5, 0.25, bpm), n(D5, 0.25, bpm), n(C5, 0.5, bpm),
    rest(0.25, bpm), n(D5, 0.25, bpm), n(E5, 0.5, bpm), n(G5, 0.5, bpm), n(A5, 0.5, bpm),
    n(G5, 0.5, bpm), rest(0.25, bpm), n(E5, 0.25, bpm), n(D5, 0.5, bpm), n(C5, 0.5, bpm),
    n(E5, 0.5, bpm), rest(0.25, bpm), n(E5, 0.25, bpm), n(A5, 0.5, bpm), n(G5, 0.5, bpm),
    rest(0.5, bpm), n(E5, 0.5, bpm), n(G5, 0.25, bpm), n(A5, 0.25, bpm), n(B5, 0.5, bpm),
    rest(0.25, bpm), n(A5, 0.25, bpm), n(G5, 0.5, bpm), n(E5, 0.5, bpm), n(D5, 0.5, bpm),
    n(C5, 0.5, bpm), rest(0.25, bpm), n(D5, 0.25, bpm), n(E5, 1, bpm),
  ];
  const bass: Note[] = [
    n(C3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(C3, 0.5, bpm, "triangle", 0.15), n(G3, 0.5, bpm, "triangle", 0.15),
    n(A3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(A3, 0.5, bpm, "triangle", 0.15), n(E3, 0.5, bpm, "triangle", 0.15),
    n(F3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(F3, 0.5, bpm, "triangle", 0.15), n(C3, 0.5, bpm, "triangle", 0.15),
    n(G3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(G3, 0.5, bpm, "triangle", 0.15), n(C3, 0.5, bpm, "triangle", 0.15),
    n(C3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(C3, 0.5, bpm, "triangle", 0.15), n(G3, 0.5, bpm, "triangle", 0.15),
    n(A3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(A3, 0.5, bpm, "triangle", 0.15), n(E3, 0.5, bpm, "triangle", 0.15),
    n(F3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(G3, 0.5, bpm, "triangle", 0.15), n(E3, 0.5, bpm, "triangle", 0.15),
    n(C3, 0.5, bpm, "triangle", 0.22), rest(0.5, bpm), n(C3, 1, bpm, "triangle", 0.18),
  ];
  const groove: Note[] = [];
  for (let i = 0; i < 16; i++) {
    groove.push(n(6000, 0.25, bpm, "noise" as Waveform, 0.05));
    groove.push(n(12000, 0.25, bpm, "noise" as Waveform, 0.02));
    groove.push(n(4000, 0.25, bpm, "noise" as Waveform, 0.04));
    groove.push(n(12000, 0.25, bpm, "noise" as Waveform, 0.02));
  }
  const totalBeats = 16;
  const loopDuration = s(totalBeats, bpm);
  return { name: "Arcade Fever", bpm, masterGain: 0.3,
    tracks: [{ notes: melody, loopDuration }, { notes: bass, loopDuration }, { notes: groove, loopDuration }] };
}

export const START_TRACKS: Record<string, () => ChiptuneDefinition> = {
  "lobby-waltz": lobbyWaltz,
  "morning-dew": morningDew,
  "pixel-garden": pixelGarden,
  "starfield": starfield,
  "tea-room": teaRoom,
  "cloud-walk": cloudWalk,
  "porch-swing": porchSwing,
  "rainy-pixels": rainyPixels,
  "late-night-save": lateNightSave,
  "sunny-route": sunnyRoute,
  "firefly-cove": fireflyCove,
  "tavern-loop": tavernLoop,
  "roll-call": rollCall,
  "last-round": lastRound,
  "roll-call-fast": rollCallFast,
};

const ALL_TRACKS: Record<string, () => ChiptuneDefinition> = {
  ...START_TRACKS,
  "arcade-fever": arcadeFever,
};

export type TrackName = string;

function startPlayback(def: ChiptuneDefinition, id: string): void {
  stopTrackImmediate();

  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  currentTrackId = id;
  activeMasterGain = def.masterGain ?? 0.5;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(activeMasterGain, ctx.currentTime + FADE_IN);
  master.connect(ctx.destination);

  function scheduleLoop() {
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    const gains: GainNode[] = [];
    const now = ctx.currentTime;
    for (const track of def.tracks) {
      scheduleTrackNotes(ctx, track, master, now, sources, gains);
    }
    currentNodes = { sources, gains, master };
    const loopMs = def.tracks[0].loopDuration * 1000;
    loopTimer = window.setTimeout(scheduleLoop, loopMs - 50);
  }

  scheduleLoop();
}

function stopTrackImmediate(): void {
  if (fadeOutTimer !== null) {
    clearTimeout(fadeOutTimer);
    fadeOutTimer = null;
  }
  if (loopTimer !== null) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  if (currentNodes) {
    const nodes = currentNodes;
    for (const src of nodes.sources) {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
    }
    for (const g of nodes.gains) {
      try { g.disconnect(); } catch {}
    }
    try { nodes.master.disconnect(); } catch {}
    currentNodes = null;
  }
  currentTrackId = null;
}

// Stop music nodes and timers before sounds.ts closes the
// AudioContext, otherwise the loop timer would schedule against a
// closed context.
registerBeforeAudioClose(() => {
  stopTrackImmediate();
});

export function playTrack(name: TrackName): void {
  const factory = ALL_TRACKS[name];
  if (!factory) return;
  const def = factory();
  startPlayback(def, name);
}

export function stopTrack(): void {
  if (!currentNodes) return;
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const nodes = currentNodes;
  nodes.master.gain.cancelScheduledValues(now);
  nodes.master.gain.setValueAtTime(nodes.master.gain.value, now);
  nodes.master.gain.linearRampToValueAtTime(0, now + FADE_OUT);

  const savedId = currentTrackId;
  fadeOutTimer = window.setTimeout(() => {
    if (currentTrackId === savedId) {
      stopTrackImmediate();
    }
  }, FADE_OUT * 1000 + 100);
}

export function setMusicEnabled(enabled: boolean): void {
  musicEnabled = enabled;
  try {
    localStorage.setItem(MUSIC_KEY, enabled ? "1" : "0");
  } catch {}
}

export function isMusicEnabled(): boolean {
  return musicEnabled;
}

export function isTrackPlaying(): boolean {
  return currentTrackId !== null;
}

export function getStartTrackList(): { id: string; name: string }[] {
  return Object.entries(START_TRACKS).map(([id, factory]) => ({ id, name: factory().name }));
}
