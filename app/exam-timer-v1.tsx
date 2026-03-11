"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import {
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Settings,
  Play,
  Pause,
  Square,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────────
interface Part {
  id: number;
  name: string;
  duration: number;
  subEnabled: boolean;
  subInterval: number;
}

// ── Bell sound via Web Audio API ──────────────────────────────────────────────
function createBellSound(
  ctx: AudioContext | null,
  frequency = 880,
  duration = 1.5,
  volume = 0.6,
) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.type = "sine";
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playBell(ctx: AudioContext | null, type = "part", volume = 0.6) {
  if (!ctx) return;
  if (type === "sub") {
    createBellSound(ctx, 660, 0.8, 0.4 * volume);
  } else if (type === "end") {
    [0, 0.4, 0.8].forEach((delay) => {
      setTimeout(
        () => createBellSound(ctx, 523, 1.2, 0.6 * volume),
        delay * 1000,
      );
    });
  } else if (type === "volume") {
    // Short beep for volume change feedback
    createBellSound(ctx, 440, 0.1, 0.3 * volume);
  } else {
    createBellSound(ctx, 880, 1.5, 0.6 * volume);
    setTimeout(() => createBellSound(ctx, 660, 1.0, 0.4 * volume), 400);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

function formatTime(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// ── Default parts ─────────────────────────────────────────────────────────────
const DEFAULT_PARTS: Part[] = [
  { id: 1, name: "Part A", duration: 50, subEnabled: false, subInterval: 0 },
  { id: 2, name: "Part B", duration: 200, subEnabled: true, subInterval: 30 },
];

let nextId = 3;

// ── Main Component ────────────────────────────────────────────────────────────
export default function ExamTimerV1() {
  const { theme, setTheme } = useTheme();
  const [phase, setPhase] = useState<"setup" | "running" | "ended">("setup");
  const [parts, setParts] = useState<Part[]>(DEFAULT_PARTS);
  const [brandingMsg, setBrandingMsg] = useState(
    "ABC Tuition Centre — Excellence in Education",
  );
  const [currentPartIdx, setCurrentPartIdx] = useState(0);
  const [secsLeft, setSecsLeft] = useState(0);
  const [nextSubAt, setNextSubAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [showSetup, setShowSetup] = useState(false);
  const [endFlash, setEndFlash] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const secsRef = useRef(0);
  const subRef = useRef(0);
  const partIdxRef = useRef(0);
  const partsRef = useRef(parts);
  const pausedRef = useRef(false);
  const volumeRef = useRef(volume);

  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
    }
    return audioCtxRef.current;
  }, []);

  const endExam = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    setPhase("ended");
    setEndFlash(true);
    playBell(audioCtxRef.current, "end", volumeRef.current);
    setTimeout(() => setEndFlash(false), 3000);
  }, []);

  const advancePart = useCallback(
    (idx: number) => {
      const ps = partsRef.current;
      if (idx >= ps.length) {
        endExam();
        return;
      }
      const part = ps[idx];
      const secs = part.duration * 60;
      partIdxRef.current = idx;
      secsRef.current = secs;
      setCurrentPartIdx(idx);
      setSecsLeft(secs);
      // sub timer
      const sub =
        part.subEnabled && part.subInterval > 0 ? part.subInterval * 60 : 0;
      subRef.current = sub > 0 ? secs - sub : 0;
      setNextSubAt(subRef.current);
      playBell(audioCtxRef.current, "part", volumeRef.current);
    },
    [endExam],
  );

  const startTimer = useCallback(() => {
    getAudioCtx(); // unlock audio
    setPhase("running");
    setPaused(false);
    pausedRef.current = false;
    partIdxRef.current = 0;
    setCurrentPartIdx(0);
    const ps = partsRef.current;
    const secs = ps[0].duration * 60;
    secsRef.current = secs;
    setSecsLeft(secs);
    const sub =
      ps[0].subEnabled && ps[0].subInterval > 0 ? ps[0].subInterval * 60 : 0;
    subRef.current = sub > 0 ? secs - sub : 0;
    setNextSubAt(subRef.current);

    lastTickRef.current = performance.now();

    tickRef.current = setInterval(() => {
      if (pausedRef.current) return;
      const now = performance.now();
      if (!lastTickRef.current) return;
      const elapsed = Math.round((now - lastTickRef.current) / 1000);
      if (elapsed < 1) return;
      lastTickRef.current += elapsed * 1000;

      secsRef.current -= elapsed;

      // sub-bell check
      if (subRef.current > 0 && secsRef.current <= subRef.current) {
        const part = partsRef.current[partIdxRef.current];
        playBell(audioCtxRef.current, "sub", volumeRef.current);
        const subInterval = part.subInterval * 60;
        subRef.current -= subInterval;
        if (subRef.current < 0) subRef.current = 0;
        setNextSubAt(subRef.current);
      }

      if (secsRef.current <= 0) {
        const nextIdx = partIdxRef.current + 1;
        if (nextIdx >= partsRef.current.length) {
          endExam();
        } else {
          advancePart(nextIdx);
        }
        return;
      }

      setSecsLeft(secsRef.current);
    }, 250);
  }, [getAudioCtx, advancePart, endExam]);

  const reset = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    setPhase("setup");
    setPaused(false);
    setEndFlash(false);
  }, []);

  const togglePause = useCallback(() => {
    if (paused) {
      lastTickRef.current = performance.now();
      pausedRef.current = false;
      setPaused(false);
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  }, [paused]);

  // Handle volume change with sound feedback
  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    // Play a short beep to give feedback
    playBell(audioCtxRef.current, "volume", newVolume);
  }, []);

  // Parts editor helpers
  const addPart = () => {
    setParts((p) => [
      ...p,
      {
        id: nextId++,
        name: `Part ${String.fromCharCode(64 + p.length + 1)}`,
        duration: 60,
        subEnabled: false,
        subInterval: 0,
      },
    ]);
  };

  const removePart = (id: number) =>
    setParts((p) => p.filter((x) => x.id !== id));

  const updatePart = (id: number, field: keyof Part, value: unknown) =>
    setParts((p) => p.map((x) => (x.id === id ? { ...x, [field]: value } : x)));

  const currentPart = parts[currentPartIdx];
  const totalExamMins = parts.reduce((a, b) => a + Number(b.duration), 0);
  const progress = currentPart
    ? ((currentPart.duration * 60 - secsLeft) / (currentPart.duration * 60)) *
      100
    : 0;

  // ── ENDED ────────────────────────────────────────────────────────────────────
  if (phase === "ended") {
    return (
      <div
        className={cn(
          "min-h-screen flex flex-col items-center justify-center font-mono transition-colors duration-500 p-8",
          endFlash ? "bg-red-600" : "bg-zinc-950 dark:bg-black",
        )}
      >
        <div className="text-white dark:text-white text-4xl md:text-6xl lg:text-8xl font-black text-center tracking-wider leading-tight">
          TIME IS OVER
        </div>
        <div className="text-red-500 dark:text-red-500 text-xl md:text-3xl lg:text-5xl mt-4 text-center tracking-widest">
          PLEASE STOP WRITING
        </div>
        <button
          onClick={reset}
          className="mt-8 bg-green-500 hover:bg-green-600 text-black font-bold py-3 px-8 rounded-md transition-colors"
        >
          ← New Exam
        </button>
        {brandingMsg && (
          <div className="mt-8 text-center text-xs tracking-widest text-zinc-500 uppercase border-t border-zinc-800 pt-4 px-4">
            {brandingMsg}
          </div>
        )}
      </div>
    );
  }

  // ── RUNNING ──────────────────────────────────────────────────────────────────
  if (phase === "running") {
    const subSecsLeft = nextSubAt > 0 ? secsLeft - nextSubAt : 0;
    const showSub =
      currentPart?.subEnabled && currentPart?.subInterval > 0 && nextSubAt > 0;

    return (
      <div
        className={cn(
          "min-h-screen flex flex-col text-zinc-200 dark:text-zinc-200 font-mono relative overflow-hidden",
          "bg-zinc-950 dark:bg-black",
        )}
      >
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none z-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.15)_2px,rgba(0,0,0,0.15)_4px)]" />

        {/* Header bar */}
        <div className="flex justify-between items-center p-4 md:p-8 border-b border-zinc-800 dark:border-zinc-800 relative z-10">
          <div className="text-xs tracking-widest text-zinc-500 uppercase">
            EXAM IN PROGRESS
          </div>
          <div className="flex gap-3 items-center">
            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2 rounded-md border border-zinc-800 hover:bg-zinc-800 transition-colors"
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <VolumeX size={16} className="text-zinc-500" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-20 accent-green-500"
                title="Volume"
              />
              <Volume2 size={16} className="text-zinc-500" />
            </div>

            <button
              onClick={() => setShowSetup((s) => !s)}
              className="p-2 rounded-md border border-zinc-800 hover:bg-zinc-800 transition-colors"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={togglePause}
              className="p-2 rounded-md border border-zinc-800 hover:bg-zinc-800 transition-colors"
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button
              onClick={reset}
              className="p-2 rounded-md border border-red-900 hover:bg-red-900/30 text-red-500 transition-colors"
            >
              <Square size={18} />
            </button>
          </div>
        </div>

        {/* Part tabs */}
        <div className="flex gap-0 px-4 md:px-8 relative z-10 border-b border-zinc-900 dark:border-zinc-900">
          {parts.map((p, i) => (
            <div
              key={p.id}
              className={cn(
                "px-5 py-3 text-xs tracking-widest uppercase transition-all",
                i === currentPartIdx
                  ? "text-green-500 border-b-2 border-green-500"
                  : "text-zinc-600",
              )}
            >
              {p.name}
              {i < currentPartIdx ? " ✓" : ""}
            </div>
          ))}
        </div>

        {/* Main display */}
        <div className="flex-1 flex flex-col items-center justify-center relative z-10 p-8">
          {paused && (
            <div className="text-amber-500 text-lg md:text-xl tracking-widest mb-4 animate-pulse">
              ⏸ PAUSED
            </div>
          )}

          <div className="text-zinc-500 text-lg md:text-xl tracking-widest uppercase mb-2">
            {currentPart?.name}
          </div>

          {/* Giant clock */}
          <div
            className={cn(
              "text-6xl md:text-8xl lg:text-[10rem] font-black tracking-tight leading-none tabular-nums transition-all duration-500",
              secsLeft <= 60
                ? "text-red-500 drop-shadow-[0_0_40px_rgba(239,68,68,0.5)]"
                : secsLeft <= 300
                  ? "text-amber-500 drop-shadow-[0_0_40px_rgba(245,158,11,0.5)]"
                  : "text-green-500 drop-shadow-[0_0_40px_rgba(34,197,94,0.5)]",
            )}
          >
            {formatTime(secsLeft)}
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-xl h-1 bg-zinc-900 rounded-full mt-8 overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-1000 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Sub-timer */}
          {showSub && (
            <div className="mt-8 text-center">
              <div className="text-xs tracking-widest text-zinc-600 mb-1">
                NEXT INTERVAL BELL
              </div>
              <div className="text-2xl md:text-4xl text-zinc-500 tracking-wider">
                {formatTime(Math.max(0, subSecsLeft))}
              </div>
            </div>
          )}

          {/* Next part */}
          {currentPartIdx < parts.length - 1 && (
            <div className="mt-6 text-xs tracking-widest text-zinc-600">
              NEXT → {parts[currentPartIdx + 1].name} (
              {parts[currentPartIdx + 1].duration} min)
            </div>
          )}
        </div>

        {/* Branding - Larger marketing banner */}
        {brandingMsg && (
          <div className="relative z-10 text-center py-6 border-t border-zinc-900 bg-zinc-950/80 dark:bg-black/80">
            <div className="text-sm md:text-lg tracking-widest text-zinc-400 uppercase font-medium">
              {brandingMsg}
            </div>
          </div>
        )}

        {/* Mini settings overlay */}
        {showSetup && (
          <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-900 dark:bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full">
              <div className="text-zinc-500 text-xs tracking-widest mb-4">
                QUICK SETTINGS
              </div>
              <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-2">
                Branding Message
                <input
                  value={brandingMsg}
                  onChange={(e) => setBrandingMsg(e.target.value)}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-200 text-sm"
                />
              </label>
              <button
                onClick={() => setShowSetup(false)}
                className="mt-4 w-full bg-green-500 hover:bg-green-600 text-black font-bold py-2 px-4 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── SETUP ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 font-mono text-zinc-800 dark:text-zinc-200 p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header with Theme Toggle */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
            title="Toggle Theme"
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        {/* Logo */}
        <div className="text-center mb-12">
          <div className="text-3xl md:text-5xl font-black tracking-wider text-green-600 dark:text-green-500">
            EXAM TIMER
          </div>
          <div className="text-xs tracking-[0.4em] text-zinc-500 mt-1">
            CLASSROOM EDITION
          </div>
        </div>

        {/* Parts config */}
        <div className="mb-8">
          <div className="text-xs tracking-widest text-green-600 dark:text-green-500 uppercase border-b border-zinc-300 dark:border-zinc-800 pb-2 mb-4">
            Exam Structure
          </div>
          <div className="text-xs text-zinc-500 tracking-wider mb-4">
            TOTAL: {totalExamMins} MIN ({Math.floor(totalExamMins / 60)}h{" "}
            {totalExamMins % 60}m)
          </div>

          {parts.map((part, i) => (
            <div
              key={part.id}
              className="border border-zinc-300 dark:border-zinc-800 rounded-lg p-5 mb-3 bg-white dark:bg-zinc-900 relative"
            >
              <div className="flex flex-wrap gap-4 items-end">
                <label className="flex flex-col gap-1 text-xs text-zinc-500 uppercase tracking-wider">
                  Part Name
                  <input
                    value={part.name}
                    onChange={(e) =>
                      updatePart(part.id, "name", e.target.value)
                    }
                    className="w-32 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500 uppercase tracking-wider">
                  Duration (min)
                  <input
                    type="number"
                    min={1}
                    value={part.duration}
                    onChange={(e) =>
                      updatePart(part.id, "duration", Number(e.target.value))
                    }
                    className="w-24 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-wider pb-1">
                  <input
                    type="checkbox"
                    checked={part.subEnabled}
                    onChange={(e) =>
                      updatePart(part.id, "subEnabled", e.target.checked)
                    }
                    className="accent-green-500 w-4 h-4"
                  />
                  <span>Interval Bells</span>
                </label>
                {part.subEnabled && (
                  <label className="flex flex-col gap-1 text-xs text-zinc-500 uppercase tracking-wider">
                    Every (min)
                    <input
                      type="number"
                      min={1}
                      value={part.subInterval || ""}
                      onChange={(e) =>
                        updatePart(
                          part.id,
                          "subInterval",
                          Number(e.target.value),
                        )
                      }
                      className="w-20 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded px-3 py-2 text-sm"
                    />
                  </label>
                )}
              </div>

              {parts.length > 1 && (
                <button
                  onClick={() => removePart(part.id)}
                  className="absolute top-3 right-3 bg-transparent border-none text-zinc-400 hover:text-red-500 cursor-pointer text-lg transition-colors"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ))}

          <button
            onClick={addPart}
            className="w-full border border-dashed border-zinc-400 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 py-3 cursor-pointer rounded text-xs tracking-widest uppercase transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Add Part
          </button>
        </div>

        {/* Branding - Larger marketing banner */}
        <div className="mb-8">
          <div className="text-xs tracking-widest text-green-600 dark:text-green-500 uppercase border-b border-zinc-300 dark:border-zinc-800 pb-2 mb-4">
            Marketing Banner
          </div>
          <input
            value={brandingMsg}
            onChange={(e) => setBrandingMsg(e.target.value)}
            placeholder="Your tuition centre name or message…"
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded px-4 py-3 text-sm"
          />
          {/* Preview of larger banner */}
          <div className="mt-4 p-6 bg-gradient-to-r from-green-600/10 to-emerald-600/10 dark:from-green-500/10 dark:to-emerald-500/10 rounded-lg border border-green-500/20">
            <div className="text-center">
              <div className="text-lg md:text-xl tracking-widest text-zinc-600 dark:text-zinc-400 uppercase font-medium">
                {brandingMsg || "Your Banner Message"}
              </div>
            </div>
          </div>
        </div>

        {/* Volume with sound feedback */}
        <div className="mb-10">
          <div className="text-xs tracking-widest text-green-600 dark:text-green-500 uppercase border-b border-zinc-300 dark:border-zinc-800 pb-2 mb-4">
            Bell Volume (adjust for sound preview)
          </div>
          <div className="flex items-center gap-4">
            <VolumeX size={20} className="text-zinc-400" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="flex-1 accent-green-500 h-2 bg-zinc-300 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer"
            />
            <Volume2 size={20} className="text-zinc-400" />
            <span className="text-xs text-zinc-500 w-12">
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>

        {/* Start */}
        <button
          onClick={startTimer}
          className="w-full bg-green-600 hover:bg-green-700 text-black font-bold py-4 px-8 rounded-lg text-lg tracking-widest uppercase transition-colors flex items-center justify-center gap-3"
        >
          <Play size={24} /> Start Exam
        </button>
      </div>

      {/* Fixed bottom marketing banner - Larger */}
      {brandingMsg && (
        <div className="fixed bottom-0 left-0 right-0 py-6 px-4 bg-zinc-200 dark:bg-zinc-900 border-t border-zinc-300 dark:border-zinc-800">
          <div className="text-center">
            <div className="text-sm md:text-lg tracking-widest text-zinc-600 dark:text-zinc-400 uppercase font-medium">
              {brandingMsg}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
