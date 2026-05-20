"use client";

import {
  Activity,
  ArrowRight,
  Gauge,
  Medal,
  Play,
  RotateCcw,
  Target,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LeaderboardEntry } from "@/lib/sprint/attempts";

const ROUND_SECONDS = 60;
const ROUND_MS = ROUND_SECONDS * 1000;

type Operator = "+" | "-" | "x" | "/";
type GameState = "ready" | "running" | "finished";
type SubmitState = "idle" | "saving" | "saved" | "offline" | "error";

type Question = {
  id: string;
  left: number;
  right: number;
  operator: Operator;
  answer: number;
  difficulty: number;
};

type AnswerRecord = {
  id: string;
  prompt: string;
  submitted: number;
  answer: number;
  correct: boolean;
  elapsedMs: number;
};

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function sanitizePlayerName(name: string) {
  const cleaned = name.replace(/[^\w .-]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 40) : "Guest";
}

function formatQuestion(question: Question) {
  return `${question.left} ${question.operator} ${question.right}`;
}

function createQuestion(correctCount: number, streak: number, elapsedMs: number): Question {
  const timeLevel = elapsedMs > 42000 ? 2 : elapsedMs > 22000 ? 1 : 0;
  const streakLevel = Math.floor(Math.min(streak, 15) / 5);
  const progressLevel = Math.floor(Math.min(correctCount, 30) / 8);
  const difficulty = Math.min(5, 1 + timeLevel + streakLevel + progressLevel);
  const pool: Array<() => Question> = [
    () => {
      const cap = difficulty > 3 ? 140 : difficulty > 1 ? 80 : 35;
      const left = randomInt(8, cap);
      const right = randomInt(4, cap);
      return {
        id: crypto.randomUUID(),
        left,
        right,
        operator: "+",
        answer: left + right,
        difficulty,
      };
    },
    () => {
      const cap = difficulty > 3 ? 180 : difficulty > 1 ? 95 : 40;
      const right = randomInt(3, cap);
      const left = randomInt(right, right + cap);
      return {
        id: crypto.randomUUID(),
        left,
        right,
        operator: "-",
        answer: left - right,
        difficulty,
      };
    },
  ];

  if (difficulty >= 2) {
    pool.push(() => {
      const left = randomInt(difficulty > 2 ? 6 : 3, difficulty > 3 ? 16 : 12);
      const right = randomInt(2, difficulty > 3 ? 14 : 10);
      return {
        id: crypto.randomUUID(),
        left,
        right,
        operator: "x",
        answer: left * right,
        difficulty,
      };
    });
  }

  if (difficulty >= 3) {
    pool.push(() => {
      const divisor = randomInt(2, difficulty > 3 ? 12 : 9);
      const quotient = randomInt(2, difficulty > 3 ? 18 : 12);
      return {
        id: crypto.randomUUID(),
        left: divisor * quotient,
        right: divisor,
        operator: "/",
        answer: quotient,
        difficulty,
      };
    });
  }

  return pool[randomInt(0, pool.length - 1)]();
}

function scoreAnswer(isCorrect: boolean, streak: number, elapsedMs: number) {
  if (!isCorrect) return -25;
  const speedBonus = elapsedMs < 1200 ? 40 : elapsedMs < 2200 ? 25 : elapsedMs < 3500 ? 10 : 0;
  const streakBonus = Math.min(60, streak * 4);
  return 100 + speedBonus + streakBonus;
}

function NumberField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    const tokens = Array.from({ length: 72 }, (_, index) => ({
      value: ["+", "-", "x", "/", "7", "3", "9", "12"][index % 8],
      x: Math.random(),
      y: Math.random(),
      speed: 0.00018 + Math.random() * 0.00028,
      size: 14 + Math.random() * 18,
    }));

    const resize = () => {
      const scale = window.devicePixelRatio || 1;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const render = (time: number) => {
      context.clearRect(0, 0, width, height);

      for (const token of tokens) {
        const y = ((token.y + time * token.speed) % 1) * height;
        context.globalAlpha = 0.18;
        context.fillStyle = "rgba(18, 18, 18, 0.05)";
        context.font = `700 ${token.size}px Geist, Inter, sans-serif`;
        context.fillText(token.value, token.x * width, y);
      }

      context.globalAlpha = 1;
      if (!media.matches) animationFrame = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    render(0);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="number-field" />;
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MathSprintGame() {
  const [gameState, setGameState] = useState<GameState>("ready");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [playerName, setPlayerName] = useState(() => {
    if (typeof window === "undefined") return "Guest";
    return window.localStorage.getItem("sprint-player-name") ?? "Guest";
  });
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [remainingMs, setRemainingMs] = useState(ROUND_MS);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [attemptedCount, setAttemptedCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardConfigured, setLeaderboardConfigured] = useState(true);
  const [localBest, setLocalBest] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("sprint-local-best")) || 0;
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const startedAtRef = useRef(0);
  const deadlineRef = useRef(0);
  const questionStartedAtRef = useRef(0);
  const playerNameRef = useRef("Guest");
  const localBestRef = useRef(0);
  const latestStatsRef = useRef({
    score: 0,
    correctCount: 0,
    attemptedCount: 0,
    maxStreak: 0,
    records: [] as AnswerRecord[],
  });

  const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 100) : 0;
  const averageMs = useMemo(() => {
    if (records.length === 0) return null;
    return Math.round(records.reduce((total, record) => total + record.elapsedMs, 0) / records.length);
  }, [records]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    localBestRef.current = localBest;
  }, [localBest]);

  useEffect(() => {
    latestStatsRef.current = {
      score,
      correctCount,
      attemptedCount,
      maxStreak,
      records,
    };
  }, [attemptedCount, correctCount, maxStreak, records, score]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const response = await fetch("/api/leaderboard", { cache: "no-store" });
      const data = (await response.json()) as {
        entries?: LeaderboardEntry[];
        configured?: boolean;
      };
      setLeaderboard(data.entries ?? []);
      setLeaderboardConfigured(data.configured !== false);
    } catch {
      setLeaderboardConfigured(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLeaderboard();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadLeaderboard]);

  const finishRound = useCallback(async () => {
    setGameState("finished");
    setAnswer("");

    const snapshot = latestStatsRef.current;
    const safeName = sanitizePlayerName(playerNameRef.current);
    const nextBest = Math.max(localBestRef.current, snapshot.score);
    const avg =
      snapshot.records.length > 0
        ? Math.round(
            snapshot.records.reduce((total, record) => total + record.elapsedMs, 0) /
              snapshot.records.length,
          )
        : null;

    setLocalBest(nextBest);
    window.localStorage.setItem("sprint-local-best", String(nextBest));
    window.localStorage.setItem("sprint-player-name", safeName);

    setSubmitState("saving");
    try {
      const response = await fetch("/api/sprint-attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: safeName,
          score: snapshot.score,
          correctCount: snapshot.correctCount,
          attemptedCount: snapshot.attemptedCount,
          maxStreak: snapshot.maxStreak,
          averageMsPerQuestion: avg,
          durationSeconds: ROUND_SECONDS,
          clientMetadata: {
            localBest: nextBest,
            userAgent: navigator.userAgent.slice(0, 180),
          },
        }),
      });

      if (response.status === 202) {
        setSubmitState("offline");
        return;
      }

      if (!response.ok) throw new Error("Save failed");
      setSubmitState("saved");
      await loadLeaderboard();
    } catch {
      setSubmitState("error");
    }
  }, [loadLeaderboard]);

  useEffect(() => {
    if (gameState !== "running") return;

    const interval = window.setInterval(() => {
      const remaining = Math.max(0, deadlineRef.current - Date.now());
      setRemainingMs(remaining);
      if (remaining <= 0) {
        window.clearInterval(interval);
        void finishRound();
      }
    }, 80);

    return () => window.clearInterval(interval);
  }, [finishRound, gameState]);

  const startRound = () => {
    const now = Date.now();
    startedAtRef.current = now;
    deadlineRef.current = now + ROUND_MS;
    questionStartedAtRef.current = now;
    setGameState("running");
    setSubmitState("idle");
    setRemainingMs(ROUND_MS);
    setScore(0);
    setCorrectCount(0);
    setAttemptedCount(0);
    setStreak(0);
    setMaxStreak(0);
    setRecords([]);
    setFeedback(null);
    setQuestion(createQuestion(0, 0, 0));
    setAnswer("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submitAnswer = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!question || gameState !== "running" || answer.trim() === "") return;

    const submitted = Number(answer);
    if (!Number.isFinite(submitted)) return;

    const elapsedMs = Date.now() - questionStartedAtRef.current;
    const isCorrect = submitted === question.answer;
    const nextStreak = isCorrect ? streak + 1 : 0;
    const nextCorrect = correctCount + (isCorrect ? 1 : 0);
    const nextAttempted = attemptedCount + 1;
    const nextScore = Math.max(0, score + scoreAnswer(isCorrect, nextStreak, elapsedMs));
    const nextMaxStreak = Math.max(maxStreak, nextStreak);
    const nextRecords = [
      ...records,
      {
        id: question.id,
        prompt: formatQuestion(question),
        submitted,
        answer: question.answer,
        correct: isCorrect,
        elapsedMs,
      },
    ].slice(-80);

    setScore(nextScore);
    setCorrectCount(nextCorrect);
    setAttemptedCount(nextAttempted);
    setStreak(nextStreak);
    setMaxStreak(nextMaxStreak);
    setRecords(nextRecords);
    setFeedback(isCorrect ? "correct" : "wrong");
    setAnswer("");
    questionStartedAtRef.current = Date.now();
    setQuestion(createQuestion(nextCorrect, nextStreak, Date.now() - startedAtRef.current));
    window.setTimeout(() => setFeedback(null), 180);
  };

  const progress = Math.max(0, Math.min(100, (remainingMs / ROUND_MS) * 100));
  const seconds = Math.ceil(remainingMs / 1000);
  const latestRecords = records.slice(-5).reverse();

  return (
    <main className="app-shell">
      <NumberField />
      <section className="game-frame" aria-label="60-second math sprint">
        <div className="topbar">
          <div>
            <p className="eyebrow">SwiftMath</p>
            <h1>60-Second Sprint</h1>
          </div>
          <div className="topbar-actions">
            <div className="best-pill">
              <Trophy size={17} />
              <span>{localBest.toLocaleString()}</span>
            </div>
            <button className="icon-button" type="button" onClick={startRound} aria-label="Restart sprint">
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        <div className="content-grid">
          <section className={`play-panel ${feedback ?? ""}`}>
            <div className="timer-row">
              <div>
                <span className="timer-label">Timer</span>
                <strong>{seconds}s</strong>
              </div>
              <div className="score-chip">
                <Zap size={17} />
                {score.toLocaleString()}
              </div>
            </div>
            <div className="time-track" aria-hidden>
              <span style={{ width: `${progress}%` }} />
            </div>

            {gameState === "ready" && (
              <div className="ready-state">
                <div className="name-row">
                  <label htmlFor="playerName">Handle</label>
                  <input
                    id="playerName"
                    value={playerName}
                    maxLength={40}
                    onChange={(event) => setPlayerName(event.target.value)}
                    onBlur={() => setPlayerName(sanitizePlayerName(playerName))}
                  />
                </div>
                <button className="primary-button" type="button" onClick={startRound}>
                  <Play size={18} />
                  Start
                </button>
              </div>
            )}

            {gameState === "running" && question && (
              <form className="question-form" onSubmit={submitAnswer}>
                <p className="question-text">{formatQuestion(question)}</p>
                <div className="answer-row">
                  <input
                    ref={inputRef}
                    inputMode="numeric"
                    pattern="-?[0-9]*"
                    autoComplete="off"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value.replace(/[^\d-]/g, ""))}
                    aria-label="Answer"
                  />
                  <button className="submit-button" type="submit" aria-label="Submit answer">
                    <ArrowRight size={22} />
                  </button>
                </div>
              </form>
            )}

            {gameState === "finished" && (
              <div className="results-state">
                <Medal size={34} />
                <h2>{score.toLocaleString()}</h2>
                <p>
                  {correctCount}/{attemptedCount} correct, {accuracy}% accuracy
                </p>
                <button className="primary-button" type="button" onClick={startRound}>
                  <Play size={18} />
                  Again
                </button>
              </div>
            )}
          </section>

          <aside className="side-panel">
            <div className="stats-grid">
              <StatTile icon={<Target size={18} />} label="Correct" value={`${correctCount}/${attemptedCount}`} />
              <StatTile icon={<Activity size={18} />} label="Accuracy" value={`${accuracy}%`} />
              <StatTile icon={<Gauge size={18} />} label="Streak" value={String(maxStreak)} />
              <StatTile
                icon={<Timer size={18} />}
                label="Avg"
                value={averageMs === null ? "-" : `${(averageMs / 1000).toFixed(1)}s`}
              />
            </div>

            <section className="mini-card">
              <div className="card-heading">
                <h2>Board</h2>
                <span className={leaderboardConfigured ? "status-dot live" : "status-dot"} />
              </div>
              <div className="leaderboard">
                {leaderboard.length === 0 ? (
                  <p className="muted">
                    {leaderboardConfigured ? "No runs yet." : "Supabase not connected."}
                  </p>
                ) : (
                  leaderboard.map((entry, index) => (
                    <div className="leader-row" key={entry.id}>
                      <span>{index + 1}</span>
                      <strong>{entry.playerName}</strong>
                      <em>{entry.score.toLocaleString()}</em>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mini-card">
              <div className="card-heading">
                <h2>Feed</h2>
                <span className={`save-state ${submitState}`}>{submitState}</span>
              </div>
              <div className="feed-list">
                {latestRecords.length === 0 ? (
                  <p className="muted">Waiting for a run.</p>
                ) : (
                  latestRecords.map((record) => (
                    <div className="feed-row" key={record.id}>
                      <span className={record.correct ? "mark good" : "mark bad"} />
                      <strong>{record.prompt}</strong>
                      <em>{record.submitted}</em>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
