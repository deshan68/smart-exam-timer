"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = "setup" | "running" | "ended";
type BellType = "part" | "sub" | "end";
type ThemeMode = "dark" | "light";

interface ExamPart {
  id: number;
  name: string;
  duration: number;
  subEnabled: boolean;
  subInterval: number;
}

// ── Audio helpers ─────────────────────────────────────────────────────────────
function createBellSound(
  ctx: AudioContext,
  frequency: number = 880,
  duration: number = 1.5,
  vol: number = 0.6,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.type = "sine";
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playBell(
  ctx: AudioContext | null,
  type: BellType = "part",
  vol: number = 0.6,
): void {
  if (!ctx) return;
  if (type === "sub") {
    createBellSound(ctx, 660, 0.8, vol * 0.7);
  } else if (type === "end") {
    [0, 0.4, 0.8].forEach((delay) => {
      setTimeout(() => createBellSound(ctx, 523, 1.2, vol), delay * 1000);
    });
  } else {
    createBellSound(ctx, 880, 1.5, vol);
    setTimeout(() => createBellSound(ctx, 660, 1.0, vol * 0.7), 400);
  }
}

function playVolumePreview(ctx: AudioContext, vol: number): void {
  createBellSound(ctx, 880, 0.5, vol);
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

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_PARTS: ExamPart[] = [
  { id: 1, name: "Part A", duration: 50, subEnabled: false, subInterval: 0 },
  { id: 2, name: "Part B", duration: 200, subEnabled: true, subInterval: 30 },
];

let nextId = 3;

// ── Theme config ──────────────────────────────────────────────────────────────
const THEME = {
  dark: {
    bg: "#0a0a0a",
    surface: "#0d0d0d",
    border: "#1e1e1e",
    borderMid: "#2a2a2a",
    text: "#e0e0e0",
    textMid: "#888",
    textDim: "#444",
    textDimmer: "#333",
    accent: "#39ff14",
    inputBg: "#111",
    overlayBg: "rgba(0,0,0,0.88)",
    overlayPanel: "#111",
    brandBg: "#060606",
    brandBorder: "#1a1a1a",
    brandText: "#aaa",
  },
  light: {
    bg: "#f5f5f0",
    surface: "#ffffff",
    border: "#d0d0c8",
    borderMid: "#c0c0b8",
    text: "#1a1a1a",
    textMid: "#555",
    textDim: "#888",
    textDimmer: "#aaa",
    accent: "#16a34a",
    inputBg: "#fafafa",
    overlayBg: "rgba(0,0,0,0.5)",
    overlayPanel: "#fff",
    brandBg: "#e8e8e0",
    brandBorder: "#c8c8c0",
    brandText: "#444",
  },
} as const;

// ── Main Component ────────────────────────────────────────────────────────────
export default function ExamTimerV2() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [parts, setParts] = useState<ExamPart[]>(DEFAULT_PARTS);
  const [brandingMsg, setBrandingMsg] = useState<string>(
    "Theekshana Thenuwara",
  );
  const [currentPartIdx, setCurrentPartIdx] = useState<number>(0);
  const [secsLeft, setSecsLeft] = useState<number>(0);
  const [nextSubAt, setNextSubAt] = useState<number>(0);
  const [paused, setPaused] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.6);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [showSetup, setShowSetup] = useState<boolean>(false);
  const [endFlash, setEndFlash] = useState<boolean>(false);

  const T = THEME[theme];

  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(0);
  const secsRef = useRef<number>(0);
  const subRef = useRef<number>(0);
  const partIdxRef = useRef<number>(0);
  const partsRef = useRef<ExamPart[]>(parts);
  const pausedRef = useRef<boolean>(false);
  const volumeRef = useRef<number>(volume);
  const volumePreviewTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
    }
    return audioCtxRef.current;
  }, []);

  // Play a short preview bell when volume slider changes (debounced)
  const handleVolumeChange = (val: number) => {
    setVolume(val);
    if (volumePreviewTimeout.current)
      clearTimeout(volumePreviewTimeout.current);
    volumePreviewTimeout.current = setTimeout(() => {
      playVolumePreview(getAudioCtx(), val);
    }, 300);
  };

  const endExam = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    setPhase("ended");
    setEndFlash(true);
    playBell(getAudioCtx(), "end", volumeRef.current);
    setTimeout(() => setEndFlash(false), 3000);
  }, [getAudioCtx]);

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
      const sub =
        part.subEnabled && part.subInterval > 0 ? part.subInterval * 60 : 0;
      subRef.current = sub > 0 ? secs - sub : 0;
      setNextSubAt(subRef.current);
      playBell(getAudioCtx(), "part", volumeRef.current);
    },
    [endExam, getAudioCtx],
  );

  const startTimer = useCallback(() => {
    getAudioCtx();
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
      const elapsed = Math.round((now - lastTickRef.current) / 1000);
      if (elapsed < 1) return;
      lastTickRef.current += elapsed * 1000;
      secsRef.current -= elapsed;

      if (subRef.current > 0 && secsRef.current <= subRef.current) {
        playBell(audioCtxRef.current, "sub", volumeRef.current);
        const subInterval =
          partsRef.current[partIdxRef.current].subInterval * 60;
        subRef.current -= subInterval;
        if (subRef.current < 0) subRef.current = 0;
        setNextSubAt(subRef.current);
      }

      if (secsRef.current <= 0) {
        const nextIdx = partIdxRef.current + 1;
        if (nextIdx >= partsRef.current.length) endExam();
        else advancePart(nextIdx);
        return;
      }
      setSecsLeft(secsRef.current);
    }, 250);
  }, [getAudioCtx, advancePart, endExam]);

  const reset = (): void => {
    if (tickRef.current) clearInterval(tickRef.current);
    setPhase("setup");
    setPaused(false);
    setEndFlash(false);
  };

  const togglePause = (): void => {
    if (paused) {
      lastTickRef.current = performance.now();
      pausedRef.current = false;
      setPaused(false);
    } else {
      pausedRef.current = true;
      setPaused(true);
    }
  };

  const addPart = (): void => {
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

  const removePart = (id: number): void =>
    setParts((p) => p.filter((x) => x.id !== id));

  const updatePart = <K extends keyof ExamPart>(
    id: number,
    field: K,
    value: ExamPart[K],
  ): void =>
    setParts((p) => p.map((x) => (x.id === id ? { ...x, [field]: value } : x)));

  const currentPart = parts[currentPartIdx];
  const totalExamMins = parts.reduce((a, b) => a + Number(b.duration), 0);
  const progress = currentPart
    ? ((currentPart.duration * 60 - secsLeft) / (currentPart.duration * 60)) *
      100
    : 0;

  // ── Shared inline helpers ─────────────────────────────────────────────────
  const ThemeToggle = () => (
    <button
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      style={{
        background: "none",
        border: `1px solid ${T.borderMid}`,
        color: T.textMid,
        padding: "0.3rem 0.7rem",
        cursor: "pointer",
        borderRadius: 4,
        fontFamily: "'Courier New', monospace",
        fontSize: "0.85rem",
        transition: "all 0.2s",
      }}
      title="Toggle dark / light mode"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );

  const BrandingBanner = ({ fixed = false }: { fixed?: boolean }) => (
    <div
      style={{
        position: fixed ? "fixed" : "relative",
        bottom: fixed ? 0 : undefined,
        left: fixed ? 0 : undefined,
        right: fixed ? 0 : undefined,
        zIndex: fixed ? 50 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.85rem 1.5rem",
        borderTop: `2px solid ${T.brandBorder}`,
        background: T.brandBg,
        fontFamily: "'Courier New', monospace",
        gap: "1rem",
      }}
    >
      {/* Marketing message */}
      <div
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: "clamp(0.85rem, 2vw, 1.15rem)",
          letterSpacing: "0.18em",
          color: T.brandText,
          textTransform: "uppercase",
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {brandingMsg || "\u00A0"}
      </div>

      {/* Developer credit */}
      <a
        href="https://github.com/deshan68"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          color: T.textDim,
          textDecoration: "none",
          fontSize: "0.62rem",
          letterSpacing: "0.12em",
          whiteSpace: "nowrap",
          flexShrink: 0,
          transition: "color 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = T.accent)}
        onMouseLeave={(e) => (e.currentTarget.style.color = T.textDim)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577v-2.165c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
        ARUN
      </a>
    </div>
  );

  // ── ENDED ─────────────────────────────────────────────────────────────────
  if (phase === "ended") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: endFlash ? "#dc2626" : "#0f0f0f",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Courier New', monospace",
          transition: "background 0.5s",
          padding: "2rem",
        }}
      >
        <div
          style={{
            fontSize: "clamp(2rem,8vw,6rem)",
            fontWeight: 900,
            color: "#fff",
            textAlign: "center",
            letterSpacing: "0.05em",
            lineHeight: 1.1,
          }}
        >
          TIME IS OVER
        </div>
        <div
          style={{
            fontSize: "clamp(1rem,4vw,2.5rem)",
            color: "#ef4444",
            marginTop: "1rem",
            textAlign: "center",
            letterSpacing: "0.2em",
          }}
        >
          PLEASE STOP WRITING
        </div>
        <button
          onClick={reset}
          style={{
            marginTop: "3rem",
            background: "#22c55e",
            border: "none",
            color: "#000",
            padding: "0.85rem 2.5rem",
            cursor: "pointer",
            borderRadius: 4,
            fontFamily: "'Courier New', monospace",
            fontSize: "1rem",
            fontWeight: 900,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          ← NEW EXAM
        </button>
        <BrandingBanner fixed />
      </div>
    );
  }

  // ── RUNNING ───────────────────────────────────────────────────────────────
  if (phase === "running") {
    const subSecsLeft = nextSubAt > 0 ? secsLeft - nextSubAt : 0;
    const showSub =
      currentPart?.subEnabled && currentPart?.subInterval > 0 && nextSubAt > 0;
    const clockColor =
      secsLeft <= 60 ? "#ef4444" : secsLeft <= 300 ? "#f59e0b" : T.accent;
    const glowColor =
      secsLeft <= 60
        ? "#ef444455"
        : secsLeft <= 300
          ? "#f59e0b55"
          : `${T.accent}44`;

    return (
      <div
        style={{
          minHeight: "100vh",
          background: T.bg,
          display: "flex",
          flexDirection: "column",
          color: T.text,
          fontFamily: "'Courier New', monospace",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Scanline overlay (dark only) */}
        {theme === "dark" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 0,
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)",
            }}
          />
        )}

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.875rem 1.5rem",
            borderBottom: `1px solid ${T.border}`,
            position: "relative",
            zIndex: 1,
            background: T.surface,
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              letterSpacing: "0.22em",
              color: T.textDim,
              textTransform: "uppercase",
            }}
          >
            EXAM IN PROGRESS
          </div>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <ThemeToggle />
            <button
              onClick={() => setShowSetup((s) => !s)}
              style={iconBtn(T)}
              title="Settings"
            >
              ⚙
            </button>
            <button
              onClick={togglePause}
              style={iconBtn(T)}
              title="Pause / Resume"
            >
              {paused ? "▶" : "⏸"}
            </button>
            <button
              onClick={reset}
              style={{
                ...iconBtn(T),
                color: "#ef4444",
                borderColor: "#ef4444",
              }}
              title="Stop exam"
            >
              ■
            </button>
          </div>
        </div>

        {/* Part tabs */}
        <div
          style={{
            display: "flex",
            padding: "0 1.5rem",
            position: "relative",
            zIndex: 1,
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
          }}
        >
          {parts.map((p, i) => (
            <div
              key={p.id}
              style={{
                padding: "0.5rem 1.25rem",
                fontSize: "0.68rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: i === currentPartIdx ? T.accent : T.textDim,
                borderBottom:
                  i === currentPartIdx
                    ? `2px solid ${T.accent}`
                    : "2px solid transparent",
                transition: "all 0.3s",
              }}
            >
              {p.name}
              {i < currentPartIdx ? " ✓" : ""}
            </div>
          ))}
        </div>

        {/* Main clock area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 1,
            padding: "2rem",
          }}
        >
          {paused && (
            <div
              style={{
                fontSize: "clamp(0.75rem,1.8vw,1.1rem)",
                letterSpacing: "0.4em",
                color: "#f59e0b",
                marginBottom: "1rem",
              }}
            >
              ⏸ PAUSED
            </div>
          )}

          <div
            style={{
              fontSize: "clamp(0.85rem,2.2vw,1.3rem)",
              letterSpacing: "0.3em",
              color: T.textMid,
              marginBottom: "0.5rem",
              textTransform: "uppercase",
            }}
          >
            {currentPart?.name}
          </div>

          {/* Giant clock */}
          <div
            style={{
              fontSize: "clamp(4rem,17vw,13rem)",
              fontWeight: 900,
              color: clockColor,
              letterSpacing: "0.02em",
              lineHeight: 1,
              textShadow: `0 0 40px ${glowColor}`,
              transition: "color 0.5s, text-shadow 0.5s",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(secsLeft)}
          </div>

          {/* Progress bar */}
          <div
            style={{
              width: "min(600px,80vw)",
              height: 4,
              background: T.border,
              borderRadius: 2,
              marginTop: "2rem",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: T.accent,
                transition: "width 1s linear",
                borderRadius: 2,
              }}
            />
          </div>

          {/* Sub-timer */}
          {showSub && (
            <div style={{ marginTop: "2rem", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "0.62rem",
                  letterSpacing: "0.25em",
                  color: T.textDim,
                  marginBottom: "0.3rem",
                }}
              >
                NEXT INTERVAL BELL
              </div>
              <div
                style={{
                  fontSize: "clamp(1.1rem,3.5vw,2.2rem)",
                  color: T.textMid,
                  letterSpacing: "0.05em",
                }}
              >
                {formatTime(Math.max(0, subSecsLeft))}
              </div>
            </div>
          )}

          {/* Next part */}
          {currentPartIdx < parts.length - 1 && (
            <div
              style={{
                marginTop: "1.5rem",
                fontSize: "0.68rem",
                letterSpacing: "0.2em",
                color: T.textDim,
              }}
            >
              NEXT → {parts[currentPartIdx + 1].name} (
              {parts[currentPartIdx + 1].duration} min)
            </div>
          )}
        </div>

        <BrandingBanner />

        {/* Settings overlay */}
        {showSetup && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: T.overlayBg,
              zIndex: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                background: T.overlayPanel,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                padding: "2rem",
                maxWidth: 400,
                width: "90%",
              }}
            >
              <div
                style={{
                  color: T.accent,
                  fontSize: "0.65rem",
                  letterSpacing: "0.25em",
                  marginBottom: "1.25rem",
                }}
              >
                QUICK SETTINGS
              </div>
              <FieldLabel label="Branding Message" T={T}>
                <input
                  value={brandingMsg}
                  onChange={(e) => setBrandingMsg(e.target.value)}
                  style={inputSty(T)}
                />
              </FieldLabel>
              <FieldLabel label="Bell Volume" T={T}>
                <VolumeRow
                  volume={volume}
                  onVolumeChange={handleVolumeChange}
                  T={T}
                />
              </FieldLabel>
              <button
                onClick={() => setShowSetup(false)}
                style={{
                  marginTop: "1.25rem",
                  background: T.accent,
                  border: "none",
                  color: "#000",
                  padding: "0.6rem 1.5rem",
                  cursor: "pointer",
                  borderRadius: 4,
                  fontFamily: "'Courier New', monospace",
                  fontSize: "0.8rem",
                  fontWeight: 900,
                  letterSpacing: "0.15em",
                  width: "100%",
                }}
              >
                CLOSE
              </button>
            </div>
          </div>
        )}

        <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
      </div>
    );
  }

  // ── SETUP ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        fontFamily: "'Courier New', monospace",
        color: T.text,
        boxSizing: "border-box",
        paddingBottom: "6rem",
        transition: "background 0.3s, color 0.3s",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "1rem 2rem",
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}
      >
        <ThemeToggle />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <div
            style={{
              fontSize: "clamp(1.5rem,5vw,3rem)",
              fontWeight: 900,
              letterSpacing: "0.1em",
              color: T.accent,
            }}
          >
            EXAM TIMER
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              letterSpacing: "0.4em",
              color: T.textDim,
              marginTop: "0.3rem",
            }}
          >
            CLASSROOM EDITION
          </div>
        </div>

        {/* Exam structure */}
        <SectionTitle label="EXAM STRUCTURE" T={T} />
        <div
          style={{
            fontSize: "0.62rem",
            color: T.textDim,
            letterSpacing: "0.1em",
            marginBottom: "1rem",
            marginTop: "-0.5rem",
          }}
        >
          TOTAL: {totalExamMins} MIN ({Math.floor(totalExamMins / 60)}h{" "}
          {totalExamMins % 60}m)
        </div>

        {parts.map((part) => (
          <div
            key={part.id}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: "1.25rem",
              marginBottom: "0.75rem",
              background: T.surface,
              position: "relative",
              transition: "background 0.3s",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                alignItems: "flex-end",
              }}
            >
              <FieldLabel label="Part Name" T={T}>
                <input
                  value={part.name}
                  onChange={(e) => updatePart(part.id, "name", e.target.value)}
                  style={{ ...inputSty(T), width: 120 }}
                />
              </FieldLabel>
              <FieldLabel label="Duration (min)" T={T}>
                <input
                  type="number"
                  min={1}
                  value={part.duration}
                  onChange={(e) =>
                    updatePart(part.id, "duration", Number(e.target.value))
                  }
                  style={{ ...inputSty(T), width: 80 }}
                />
              </FieldLabel>
              <label
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.62rem",
                  letterSpacing: "0.15em",
                  color: T.textMid,
                  textTransform: "uppercase",
                  cursor: "pointer",
                  paddingBottom: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={part.subEnabled}
                  onChange={(e) =>
                    updatePart(part.id, "subEnabled", e.target.checked)
                  }
                  style={{ accentColor: T.accent, width: 16, height: 16 }}
                />
                Interval Bells
              </label>
              {part.subEnabled && (
                <FieldLabel label="Every (min)" T={T}>
                  <input
                    type="number"
                    min={1}
                    value={part.subInterval || ""}
                    onChange={(e) =>
                      updatePart(part.id, "subInterval", Number(e.target.value))
                    }
                    style={{ ...inputSty(T), width: 70 }}
                  />
                </FieldLabel>
              )}
            </div>
            {parts.length > 1 && (
              <button
                onClick={() => removePart(part.id)}
                style={{
                  position: "absolute",
                  top: "0.75rem",
                  right: "0.75rem",
                  background: "none",
                  border: "none",
                  color: T.textDim,
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <button
          onClick={addPart}
          style={{
            background: "none",
            border: `1px dashed ${T.borderMid}`,
            color: T.textDim,
            padding: "0.6rem 1.25rem",
            cursor: "pointer",
            borderRadius: 4,
            fontFamily: "'Courier New', monospace",
            fontSize: "0.75rem",
            letterSpacing: "0.15em",
            width: "100%",
            marginBottom: "2rem",
          }}
        >
          + Add Part
        </button>

        {/* Branding */}
        <SectionTitle label="MARKETING BANNER" T={T} />
        <input
          value={brandingMsg}
          onChange={(e) => setBrandingMsg(e.target.value)}
          placeholder="Your tuition centre name or message…"
          style={{ ...inputSty(T), width: "100%", marginBottom: "2rem" }}
        />

        {/* Volume */}
        <SectionTitle label="BELL VOLUME" T={T} />
        <VolumeRow volume={volume} onVolumeChange={handleVolumeChange} T={T} />

        {/* Start */}
        <button
          onClick={startTimer}
          style={{
            marginTop: "2.5rem",
            background: T.accent,
            border: "none",
            color: "#000",
            padding: "1rem 2.5rem",
            cursor: "pointer",
            borderRadius: 4,
            fontFamily: "'Courier New', monospace",
            fontSize: "1rem",
            fontWeight: 900,
            letterSpacing: "0.2em",
            width: "100%",
            textTransform: "uppercase",
          }}
        >
          ▶ START EXAM
        </button>
      </div>

      {/* Fixed branding banner */}
      <BrandingBanner fixed />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
type ThemeObj = (typeof THEME)[keyof typeof THEME];

function SectionTitle({ label, T }: { label: string; T: ThemeObj }) {
  return (
    <div
      style={{
        fontSize: "0.6rem",
        letterSpacing: "0.3em",
        color: T.accent,
        textTransform: "uppercase",
        marginBottom: "0.75rem",
        borderBottom: `1px solid ${T.border}`,
        paddingBottom: "0.4rem",
      }}
    >
      {label}
    </div>
  );
}

function FieldLabel({
  label,
  T,
  children,
}: {
  label: string;
  T: ThemeObj;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        fontSize: "0.6rem",
        letterSpacing: "0.15em",
        color: T.textMid,
        textTransform: "uppercase",
      }}
    >
      {label}
      {children}
    </label>
  );
}

function VolumeRow({
  volume,
  onVolumeChange,
  T,
}: {
  volume: number;
  onVolumeChange: (v: number) => void;
  T: ThemeObj;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        marginBottom: "0.5rem",
      }}
    >
      <span style={{ color: T.textDim, fontSize: "1rem" }}>🔈</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: T.accent }}
      />
      <span style={{ color: T.textDim, fontSize: "1rem" }}>🔊</span>
      <span
        style={{
          minWidth: "2.5rem",
          fontSize: "0.7rem",
          color: T.textMid,
          textAlign: "right",
          letterSpacing: "0.05em",
        }}
      >
        {Math.round(volume * 100)}%
      </span>
    </div>
  );
}

function inputSty(T: ThemeObj): React.CSSProperties {
  return {
    background: T.inputBg,
    border: `1px solid ${T.borderMid}`,
    borderRadius: 4,
    color: T.text,
    padding: "0.4rem 0.6rem",
    fontSize: "0.85rem",
    fontFamily: "'Courier New', monospace",
    outline: "none",
    width: "100%",
    transition: "background 0.3s, color 0.3s",
  };
}

function iconBtn(T: ThemeObj): React.CSSProperties {
  return {
    background: "none",
    border: `1px solid ${T.borderMid}`,
    color: T.textMid,
    padding: "0.3rem 0.6rem",
    cursor: "pointer",
    borderRadius: 4,
    fontFamily: "'Courier New', monospace",
    fontSize: "0.85rem",
  };
}
