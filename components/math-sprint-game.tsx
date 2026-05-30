"use client";

import {
  LoaderCircle,
  Mic,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LeaderboardEntry } from "@/lib/sprint/attempts";

const ROUND_SECONDS = 60;
const ROUND_MS = ROUND_SECONDS * 1000;
const VOICE_LEVEL_THRESHOLD = 0.035;
const MIN_VOICE_SEGMENT_MS = 180;
const SILENCE_AFTER_SPEECH_MS = 460;
const MAX_VOICE_SEGMENT_MS = 2600;
const VOICE_RECORDER_TIMESLICE_MS = 120;
const VISUALIZER_BARS = 32;
const TIMER_RADIUS = 22;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS;

type Operator = "+" | "-" | "x" | "/";
type GameState = "ready" | "running" | "finished";
type SubmitState = "idle" | "saving" | "saved" | "offline" | "error";
type VoiceState = "idle" | "starting" | "listening" | "transcribing" | "error" | "unsupported";

type VoiceAnswerResponse = {
  value?: number | null;
  transcript?: string;
  error?: string;
};

type VoiceSession = {
  stream: MediaStream;
  audioContext: AudioContext;
  analyser: AnalyserNode;
  samples: Uint8Array<ArrayBuffer>;
  frequencies: Uint8Array<ArrayBuffer>;
  frameId: number;
  isSpeaking: boolean;
  lastVoiceAt: number;
};

type VoiceSegment = {
  recorder: MediaRecorder;
  chunks: Blob[];
  questionId: string;
  segmentId: number;
  startedAt: number;
  discard?: boolean;
};

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

type ScorePopup = {
  id: number;
};

function TimerRing({ seconds }: { seconds: number }) {
  const progress = Math.max(0, Math.min(1, seconds / ROUND_SECONDS));
  const strokeDashoffset = TIMER_CIRCUMFERENCE * (1 - progress);
  const isUrgent = seconds <= 20;

  return (
    <svg className={`timer-ring ${isUrgent ? "urgent" : ""}`} width="52" height="52" viewBox="0 0 52 52">
      <g transform="rotate(-90 26 26)">
        <circle cx="26" cy="26" r={TIMER_RADIUS} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="26"
          cy="26"
          r={TIMER_RADIUS}
          fill="none"
          stroke={isUrgent ? "var(--wrong)" : "var(--cyan)"}
          strokeWidth="3"
          strokeDasharray={TIMER_CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </g>
      <text x="26" y="26" textAnchor="middle" dominantBaseline="central">
        {seconds}
      </text>
    </svg>
  );
}

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function sanitizePlayerName(name: string) {
  const cleaned = name.replace(/[^\w .-]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 40) : "Guest";
}

function formatQuestion(question: Question) {
  const operator = question.operator === "x" ? "×" : question.operator === "/" ? "÷" : question.operator;
  return `${question.left} ${operator} ${question.right}`;
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
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [scorePulse, setScorePulse] = useState(false);
  const [scorePopups, setScorePopups] = useState<ScorePopup[]>([]);
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
  const gameStateRef = useRef<GameState>("ready");
  const questionRef = useRef<Question | null>(null);
  const playerNameRef = useRef("Guest");
  const localBestRef = useRef(0);
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const activeVoiceSegmentRef = useRef<VoiceSegment | null>(null);
  const visualizerBarRefs = useRef<Array<HTMLDivElement | null>>([]);
  const monitorVoiceRef = useRef<() => void>(() => undefined);
  const voiceSegmentIdRef = useRef(0);
  const latestVoiceSegmentIdRef = useRef(0);
  const scorePopupIdRef = useRef(0);
  const commitAnswerRef = useRef<(rawAnswer: string | number) => boolean>(() => false);
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
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);

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
    const firstQuestion = createQuestion(0, 0, 0);
    const activeSegment = activeVoiceSegmentRef.current;

    if (activeSegment) {
      activeSegment.discard = true;
      if (activeSegment.recorder.state !== "inactive") {
        activeSegment.recorder.stop();
      }
    }

    voiceSegmentIdRef.current += 1;
    latestVoiceSegmentIdRef.current = voiceSegmentIdRef.current;
    gameStateRef.current = "running";
    questionRef.current = firstQuestion;
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
    setVoiceState(voiceSessionRef.current ? "listening" : "idle");
    setVoiceMessage("");
    setScorePulse(false);
    setScorePopups([]);
    setQuestion(firstQuestion);
    setAnswer("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const viewBoard = () => {
    setGameState("ready");
    setRemainingMs(ROUND_MS);
    setFeedback(null);
    setAnswer("");
    setScorePopups([]);
    void loadLeaderboard();
  };

  const commitAnswer = useCallback(
    (rawAnswer: string | number) => {
      const answerText = typeof rawAnswer === "number" ? String(rawAnswer) : rawAnswer.trim();
      if (!question || gameState !== "running" || answerText === "") return false;

      const submitted = Number(answerText);
      if (!Number.isFinite(submitted)) return false;
      setAnswer(answerText);

      const isCorrect = submitted === question.answer;
      if (!isCorrect) {
        const nextAttempted = attemptedCount + 1;
        const nextRecords = [
          ...records,
          {
            id: `${question.id}-${nextAttempted}`,
            prompt: formatQuestion(question),
            submitted,
            answer: question.answer,
            correct: false,
            elapsedMs: Date.now() - questionStartedAtRef.current,
          },
        ].slice(-80);

        setAttemptedCount(nextAttempted);
        setStreak(0);
        setRecords(nextRecords);
        setFeedback("wrong");
        window.setTimeout(() => setFeedback(null), 180);
        return false;
      }

      const elapsedMs = Date.now() - questionStartedAtRef.current;
      const nextStreak = streak + 1;
      const nextCorrect = correctCount + 1;
      const nextAttempted = attemptedCount + 1;
      const nextScore = score + 1;
      const nextMaxStreak = Math.max(maxStreak, nextStreak);
      const nextRecords = [
        ...records,
        {
          id: question.id,
          prompt: formatQuestion(question),
          submitted,
          answer: question.answer,
          correct: true,
          elapsedMs,
        },
      ].slice(-80);

      setScore(nextScore);
      setCorrectCount(nextCorrect);
      setAttemptedCount(nextAttempted);
      setStreak(nextStreak);
      setMaxStreak(nextMaxStreak);
      setRecords(nextRecords);
      setFeedback("correct");
      setScorePulse(false);
      window.setTimeout(() => setScorePulse(true), 0);
      window.setTimeout(() => setScorePulse(false), 180);
      scorePopupIdRef.current += 1;
      setScorePopups((popups) => [...popups, { id: scorePopupIdRef.current }]);
      window.setTimeout(() => {
        setScorePopups((popups) => popups.slice(1));
      }, 650);
      setAnswer("");
      questionStartedAtRef.current = Date.now();
      setQuestion(createQuestion(nextCorrect, nextStreak, Date.now() - startedAtRef.current));
      window.setTimeout(() => setFeedback(null), 180);
      return true;
    },
    [attemptedCount, correctCount, gameState, maxStreak, question, records, score, streak],
  );

  useEffect(() => {
    commitAnswerRef.current = commitAnswer;
  }, [commitAnswer]);

  const submitAnswer = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    void commitAnswer(answer);
  };

  const submitVoiceBlob = useCallback(async (audio: Blob, questionId: string, segmentId: number) => {
    if (segmentId !== latestVoiceSegmentIdRef.current) {
      return;
    }

    setVoiceState("transcribing");
    setVoiceMessage("");

    const body = new FormData();
    body.append("audio", audio, "answer.webm");

    try {
      const response = await fetch("/api/voice-answer", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as VoiceAnswerResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Voice recognition failed.");
      }

      if (
        segmentId !== latestVoiceSegmentIdRef.current ||
        questionRef.current?.id !== questionId ||
        gameStateRef.current !== "running"
      ) {
        setVoiceState(voiceSessionRef.current ? "listening" : "idle");
        return;
      }

      if (typeof data.value !== "number" || !Number.isFinite(data.value)) {
        setVoiceState(voiceSessionRef.current ? "listening" : "error");
        setVoiceMessage("No number");
        return;
      }

      commitAnswerRef.current(data.value);
      setVoiceState(voiceSessionRef.current && gameStateRef.current === "running" ? "listening" : "idle");
      setVoiceMessage(`Heard ${data.value}`);
    } catch {
      setVoiceState(voiceSessionRef.current ? "listening" : "error");
      setVoiceMessage("Voice error");
    }
  }, []);

  const stopVoiceSegment = useCallback((discard = false) => {
    const segment = activeVoiceSegmentRef.current;
    if (!segment) {
      return;
    }

    segment.discard = segment.discard || discard;
    if (segment.recorder.state === "inactive") {
      activeVoiceSegmentRef.current = null;
      return;
    }

    segment.recorder.stop();
  }, []);

  const startVoiceSegment = useCallback(() => {
    const session = voiceSessionRef.current;
    const questionSnapshot = questionRef.current;

    if (!session || activeVoiceSegmentRef.current || !questionSnapshot || gameStateRef.current !== "running") {
      return;
    }

    const preferredType = "audio/webm;codecs=opus";
    const recorder = new MediaRecorder(
      session.stream,
      MediaRecorder.isTypeSupported(preferredType) ? { mimeType: preferredType } : undefined,
    );
    const segmentId = voiceSegmentIdRef.current + 1;
    const segment: VoiceSegment = {
      recorder,
      chunks: [],
      questionId: questionSnapshot.id,
      segmentId,
      startedAt: Date.now(),
    };

    voiceSegmentIdRef.current = segmentId;
    latestVoiceSegmentIdRef.current = segmentId;
    activeVoiceSegmentRef.current = segment;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        segment.chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      if (activeVoiceSegmentRef.current?.segmentId === segment.segmentId) {
        activeVoiceSegmentRef.current = null;
      }

      const durationMs = Date.now() - segment.startedAt;
      if (segment.discard || durationMs < MIN_VOICE_SEGMENT_MS || segment.chunks.length === 0) {
        return;
      }

      void submitVoiceBlob(
        new Blob(segment.chunks, { type: recorder.mimeType || "audio/webm" }),
        segment.questionId,
        segment.segmentId,
      );
    };

    recorder.start(VOICE_RECORDER_TIMESLICE_MS);
  }, [submitVoiceBlob]);

  const monitorVoice = useCallback(() => {
    const session = voiceSessionRef.current;
    if (!session) {
      return;
    }

    if (gameStateRef.current !== "running") {
      return;
    }

    session.analyser.getByteTimeDomainData(session.samples);
    session.analyser.getByteFrequencyData(session.frequencies);

    let total = 0;
    for (const sample of session.samples) {
      const centered = (sample - 128) / 128;
      total += centered * centered;
    }

    const rms = Math.sqrt(total / session.samples.length);
    const now = Date.now();
    const bars = visualizerBarRefs.current;

    if (bars.length > 0) {
      const bucketSize = Math.max(1, Math.floor(session.frequencies.length / VISUALIZER_BARS));

      for (let index = 0; index < VISUALIZER_BARS; index += 1) {
        const start = index * bucketSize;
        const end = Math.min(session.frequencies.length, start + bucketSize);
        let sum = 0;

        for (let bucket = start; bucket < end; bucket += 1) {
          sum += session.frequencies[bucket];
        }

        const average = sum / Math.max(1, end - start);
        const level = 8 + Math.round((average / 255) * 82);
        const opacity = 0.35 + (average / 255) * 0.65;
        bars[index]?.style.setProperty("--level", `${level}px`);
        bars[index]?.style.setProperty("--opacity", String(opacity));
      }
    }

    if (rms > VOICE_LEVEL_THRESHOLD) {
      session.lastVoiceAt = now;

      if (!session.isSpeaking) {
        session.isSpeaking = true;
        startVoiceSegment();
      }
    }

    const activeSegment = activeVoiceSegmentRef.current;
    if (activeSegment) {
      const segmentMs = now - activeSegment.startedAt;
      const silenceMs = now - session.lastVoiceAt;

      if (
        (segmentMs >= MIN_VOICE_SEGMENT_MS && silenceMs >= SILENCE_AFTER_SPEECH_MS) ||
        segmentMs >= MAX_VOICE_SEGMENT_MS
      ) {
        session.isSpeaking = false;
        stopVoiceSegment();
      }
    }

    session.frameId = window.requestAnimationFrame(() => monitorVoiceRef.current());
  }, [startVoiceSegment, stopVoiceSegment]);

  useEffect(() => {
    monitorVoiceRef.current = monitorVoice;
  }, [monitorVoice]);

  const stopVoiceSession = useCallback((updateStatus = true) => {
    const session = voiceSessionRef.current;
    voiceSessionRef.current = null;
    stopVoiceSegment(true);

    if (session) {
      window.cancelAnimationFrame(session.frameId);
      session.stream.getTracks().forEach((track) => track.stop());
      void session.audioContext.close().catch(() => undefined);
    }

    if (updateStatus) {
      setVoiceState("idle");
      setVoiceMessage("");
    }
  }, [stopVoiceSegment]);

  const startVoiceSession = useCallback(async () => {
    if (voiceSessionRef.current || gameStateRef.current !== "running") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceState("unsupported");
      setVoiceMessage("Mic unavailable");
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      setVoiceState("unsupported");
      setVoiceMessage("Mic unavailable");
      return;
    }

    setVoiceState("starting");
    setVoiceMessage("Starting mic");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.12;
      source.connect(analyser);

      const session: VoiceSession = {
        stream,
        audioContext,
        analyser,
        samples: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        frequencies: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
        frameId: 0,
        isSpeaking: false,
        lastVoiceAt: Date.now(),
      };

      voiceSessionRef.current = session;
      setVoiceState("listening");
      setVoiceMessage("");
      session.frameId = window.requestAnimationFrame(() => monitorVoiceRef.current());
    } catch {
      setVoiceState("error");
      setVoiceMessage("Mic blocked");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (gameState === "running") {
        void startVoiceSession();
        return;
      }

      stopVoiceSession();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [gameState, question?.id, startVoiceSession, stopVoiceSession]);

  useEffect(() => {
    return () => stopVoiceSession(false);
  }, [stopVoiceSession]);

  const seconds = Math.ceil(remainingMs / 1000);

  useEffect(() => {
    const danger = gameState === "running" && seconds <= 10;
    document.body.classList.toggle("danger-mode", danger);

    return () => {
      document.body.classList.remove("danger-mode");
    };
  }, [gameState, seconds]);

  const voiceStatusText =
    voiceState === "starting"
      ? "Starting mic"
      : voiceState === "listening"
      ? "Listening"
      : voiceState === "transcribing"
        ? "Recognizing"
        : voiceMessage;
  const visualizerState =
    gameState === "running" && (voiceState === "listening" || voiceState === "transcribing")
      ? "active"
      : "idle";
  const podiumEntries = leaderboard.slice(0, 3);
  const boardEntries = leaderboard.slice(3, 8);
  const tickerItems =
    leaderboard.length > 0
      ? leaderboard.map(
          (entry) =>
            `${entry.playerName} scored ${entry.score} — ${
              entry.averageMsPerQuestion === null ? "no avg" : `${(entry.averageMsPerQuestion / 1000).toFixed(1)}s avg`
            }`,
        )
      : ["signal clear", "voice channel ready", "speak fast", "stay precise"];
  const avgLabel = averageMs === null ? "-" : `${(averageMs / 1000).toFixed(1)}s`;

  return (
    <main className={`app-shell ${gameState}`}>
      <div className={`feedback-overlay ${feedback ?? ""}`} aria-hidden />

      {gameState === "ready" && (
        <section className="idle-screen" aria-label="SwiftMath Sprint start screen">
          <div className="idle-hero">
            <p className="idle-brand">S W I F T M A T H</p>
            <h1>60-SECOND SPRINT</h1>
            <div className="handle-control">
              <label htmlFor="playerName">Handle:</label>
              <input
                className="handle-input"
                id="playerName"
                value={playerName}
                maxLength={40}
                onChange={(event) => setPlayerName(event.target.value)}
                onBlur={() => setPlayerName(sanitizePlayerName(playerName))}
              />
            </div>
            <button className="start-btn" type="button" onClick={startRound}>
              <span>
                <Play size={16} />
                Start Sprint
              </span>
            </button>
          </div>

          <section className="idle-board" aria-label="Leaderboard">
            <div className="section-rule">Board</div>
            {leaderboard.length === 0 ? (
              <p className="board-empty">{leaderboardConfigured ? "No transmissions yet." : "Supabase not connected."}</p>
            ) : (
              <>
                <div className="podium">
                  {podiumEntries.map((entry, index) => (
                    <div className="podium-card" data-rank={index + 1} key={entry.id}>
                      <span className="handle">{entry.playerName}</span>
                      <strong className="score">{entry.score}</strong>
                      <em>
                        {entry.averageMsPerQuestion === null
                          ? "-"
                          : `${(entry.averageMsPerQuestion / 1000).toFixed(1)}s avg`}
                      </em>
                    </div>
                  ))}
                </div>
                <div className="board-list">
                  {boardEntries.map((entry, index) => (
                    <div className="board-row" key={entry.id}>
                      <span className="rank">#{index + 4}</span>
                      <strong>{entry.playerName}</strong>
                      <span className="score">{entry.score}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </section>
      )}

      {gameState === "running" && question && (
        <section className="app-wrapper" aria-label="SwiftMath active sprint">
          <div className="top-hud">
            <div className="hud-brand">
              <strong>SwiftMath</strong>
              <span>Transmission live</span>
            </div>
            <TimerRing seconds={seconds} />
            <div className={`hud-score ${scorePulse ? "score-pop" : ""}`}>{score}</div>
            <button className="hud-reset" type="button" onClick={startRound} aria-label="Restart sprint">
              <RotateCcw size={18} />
            </button>
          </div>

          <div
            className={`problem-display ${feedback === "wrong" ? "wrong" : ""} ${streak >= 3 ? "on-streak" : ""} ${
              streak >= 7 ? "hot-streak" : ""
            }`}
            key={question.id}
          >
            <span>{formatQuestion(question)} = ?</span>
            {scorePopups.map((popup) => (
              <span className="score-popup" key={popup.id}>
                +1
              </span>
            ))}
          </div>

          <form className="voice-zone" onSubmit={submitAnswer}>
            <div className="voice-visualizer" data-state={visualizerState}>
              {Array.from({ length: VISUALIZER_BARS }).map((_, index) => (
                <div
                  className="bar"
                  key={index}
                  ref={(node) => {
                    visualizerBarRefs.current[index] = node;
                  }}
                  style={{ "--i": index } as CSSProperties}
                />
              ))}
              <div className="mic-icon-center">
                {voiceState === "starting" || voiceState === "transcribing" ? (
                  <LoaderCircle size={28} />
                ) : (
                  <Mic size={28} />
                )}
              </div>
            </div>

            <div className="answer-console">
              <label htmlFor="answerInput">Signal</label>
              <input
                id="answerInput"
                ref={inputRef}
                inputMode="numeric"
                pattern="-?[0-9]*"
                autoComplete="off"
                value={answer}
                placeholder="Say answer"
                onChange={(event) => setAnswer(event.target.value.replace(/[^\d-]/g, ""))}
                aria-label="Manual answer"
              />
              <button className="manual-submit" type="submit">
                Send
              </button>
            </div>
            <p className={`voice-status ${voiceState}`} aria-live="polite">
              {voiceStatusText || "Listening"}
            </p>
          </form>

          <div className="stats-bar">
            <div className="stat-item">
              Correct <span className="value">{correctCount}/{attemptedCount}</span>
            </div>
            <div className="stat-item">
              Acc <span className="value">{accuracy}%</span>
            </div>
            <div className="stat-item streak">
              Streak <span className="value">×{streak}</span>
            </div>
            <div className="stat-item">
              Avg <span className="value">{avgLabel}</span>
            </div>
          </div>
        </section>
      )}

      {gameState === "finished" && (
        <section className="results-screen" data-save-state={submitState} aria-label="Final score">
          <p className="results-label">Final Score</p>
          <strong className="final-score">{score}</strong>
          <div className="results-grid">
            <span>Correct</span>
            <strong>{correctCount}/{attemptedCount}</strong>
            <span>Accuracy</span>
            <strong>{accuracy}%</strong>
            <span>Streak</span>
            <strong>×{maxStreak} Best</strong>
            <span>Avg Time</span>
            <strong>{avgLabel}</strong>
          </div>
          <div className="results-actions">
            <button className="start-btn" type="button" onClick={startRound}>
              <span>Play Again</span>
            </button>
            <button className="ghost-btn" type="button" onClick={viewBoard}>
              View Board
            </button>
          </div>
        </section>
      )}

      {gameState === "ready" && (
        <div className="ticker" aria-hidden>
          <div className="ticker-content">{tickerItems.join("  ·  ")}</div>
        </div>
      )}
    </main>
  );
}
