/**
 * useVoiceAssistant — the entire voice pipeline as one React hook.
 *
 * Turn lifecycle:
 *   LISTEN (Web Speech API, interim results)
 *     → THINK (/chat SSE token stream)
 *     → SPEAK (speechSynthesis, sentence-by-sentence WHILE still streaming)
 *     → auto-LISTEN again (conversation mode).
 *
 * Fallback engine ("never go silent"):
 *   L1  instant "thinking" UI state
 *   L2  spoken filler at 1.5s, second filler at 5.5s
 *   L3  one silent retry on failure
 *   L4  local offline brain + graceful recovery next turn
 */
import { useEffect, useRef, useState } from "react";

// In production (Vercel), this points to the Railway backend URL.
// In dev, it's empty so the Vite proxy handles it.
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const FILLERS = [
  "Hmm, good question. Let me think.",
  "One second, just working that out.",
  "Okay, let me see.",
  "Hmm, give me a moment.",
];
const SECOND_FILLERS = [
  "Almost there, thanks for your patience.",
  "Still with you, just taking a little longer than usual.",
];

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function useVoiceAssistant() {
  // ---- UI state (drives React re-renders) ----
  const [micState, setMicState] = useState("idle"); // idle|listening|thinking|speaking
  const [status, setStatus] = useState("Tap the orb to start a conversation");
  const [interim, setInterim] = useState("");
  const [online, setOnline] = useState(true);
  const [lastLatency, setLastLatency] = useState(null);
  const [micLevel, setMicLevel] = useState(0); // 0..1 live input volume
  const [conversationOn, setConversationOn] = useState(false);
  const [turns, setTurns] = useState([
    {
      id: 0,
      role: "assistant",
      text: "Hi! Tap the orb and start talking — I'll answer out loud.",
    },
  ]);

  // ---- mutable machinery (must survive re-renders without causing them) ----
  const m = useRef({
    on: false,
    state: "idle",
    messages: [], // LLM chat history
    recognition: null,
    tUserDone: 0,
    tFirstToken: 0,
    latencyReported: false,
    fillerActive: false, // a filler is being spoken right now
    fillerTimer: null,
    secondFillerTimer: null,
    pendingUtterances: 0,
    streamDone: true,
    voice: null,
    nextId: 1,
    audio: null, // Web Audio visualizer plumbing
  }).current;

  // ---------- helpers ----------
  const setState = (s) => {
    m.state = s;
    setMicState(s);
  };

  const addTurn = (role, text, extra = {}) => {
    const id = m.nextId++;
    setTurns((t) => [...t, { id, role, text, ...extra }]);
    return id;
  };

  const patchTurn = (id, patch) =>
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // ---------- text-to-speech ----------
  const pickVoice = () => {
    const voices = speechSynthesis.getVoices();
    m.voice =
      voices.find((v) => /en/i.test(v.lang) && /natural|neural/i.test(v.name)) ||
      voices.find((v) => v.name === "Google US English") ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
  };

  const speak = (text, isFiller) => {
    if (!text) return;

    // The real answer must NEVER wait behind a filler: if a filler is
    // playing when the first real sentence is ready, cut it off instantly.
    if (!isFiller && m.fillerActive) {
      speechSynthesis.cancel(); // fires onend for the cancelled utterances
      m.fillerActive = false;
    }

    const u = new SpeechSynthesisUtterance(text);
    if (m.voice) u.voice = m.voice;
    u.rate = 1.05;

    u.onstart = () => {
      setState("speaking");
      setStatus("Speaking…  (tap the orb to interrupt)");
      if (isFiller) m.fillerActive = true;
      if (!isFiller && !m.latencyReported && m.tUserDone) {
        m.latencyReported = true;
        const s = ((performance.now() - m.tUserDone) / 1000).toFixed(2);
        const ttft = m.tFirstToken
          ? ((m.tFirstToken - m.tUserDone) / 1000).toFixed(2)
          : null;
        setLastLatency(s);
        // stamp the latency on the newest assistant bubble
        setTurns((t) => {
          const copy = [...t];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "assistant" && !copy[i].filler) {
              copy[i] = { ...copy[i], latency: s, ttft };
              break;
            }
          }
          return copy;
        });
      }
    };
    u.onend = u.onerror = () => {
      m.pendingUtterances--;
      if (isFiller) m.fillerActive = false;
      // Turn is over only when the stream finished AND all audio played.
      if (m.pendingUtterances <= 0 && m.streamDone && m.state === "speaking") {
        if (m.on) startListening();
        else {
          setState("idle");
          setStatus("Tap the orb to start a conversation");
        }
      }
    };

    m.pendingUtterances++;
    speechSynthesis.speak(u);
  };

  // ---------- speech recognition (voice input) ----------
  const startListening = () => {
    if (!m.on) return;
    speechSynthesis.cancel();
    m.pendingUtterances = 0;
    setState("listening");
    setStatus("Listening… speak now");

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let inter = "";
      let finalText = "";
      for (const res of e.results) {
        if (res.isFinal) finalText += res[0].transcript;
        else inter += res[0].transcript;
      }
      if (inter) setInterim(inter);
      if (finalText.trim()) {
        m.tUserDone = performance.now(); // latency stopwatch starts
        setInterim("");
        handleUserQuery(finalText.trim());
      }
    };

    rec.onerror = (e) => {
      setInterim("");
      if (e.error === "not-allowed") {
        setStatus("Microphone blocked — allow mic access in the browser.");
        stop();
      } else if (e.error === "network") {
        setStatus("Speech recognition needs internet — check your connection.");
      }
    };

    rec.onend = () => {
      // Closed on silence with no query → just reopen the mic.
      if (m.on && m.state === "listening") startListening();
    };

    m.recognition = rec;
    try {
      rec.start();
    } catch (e) {
      if (e.name !== "InvalidStateError") {
        setStatus("Microphone error — please try again.");
        stop();
      }
    }
  };

  // ---------- main turn ----------
  const handleUserQuery = async (text) => {
    addTurn("user", text);
    m.messages.push({ role: "user", content: text });

    setState("thinking");
    setStatus("Thinking…");
    m.latencyReported = false;
    m.tFirstToken = 0;
    armFillers();

    const ok = await streamReply();
    if (!ok && m.on) {
      const okRetry = await streamReply(); // L3: silent retry
      if (!okRetry && m.on) {
        offlineReply(text); // L4: local brain
        return;
      }
    }
    if (ok) setOnline(true); // healthy again
  };

  const streamReply = async () => {
    let full = "";
    let buf = "";
    let bubbleId = null;
    let success = false;
    m.streamDone = false;

    const flushSentences = () => {
      let match;
      while ((match = buf.match(/^[\s\S]*?[.!?](?=\s|$)/))) {
        speak(match[0].trim(), false);
        buf = buf.slice(match[0].length);
      }
    };

    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: m.messages }),
      });
      if (!resp.ok || !resp.body) return false;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });

        const events = raw.split("\n\n");
        raw = events.pop();

        for (const evt of events) {
          if (!evt.startsWith("data: ")) continue;
          let msg;
          try {
            msg = JSON.parse(evt.slice(6));
          } catch {
            continue; // skip malformed SSE fragment
          }
          if (msg.error) return false;
          if (msg.token) {
            clearFillers(); // real answer arriving — cancel pending fillers
            if (!m.tFirstToken) m.tFirstToken = performance.now();
            if (bubbleId === null) bubbleId = addTurn("assistant", "");
            full += msg.token;
            buf += msg.token;
            patchTurn(bubbleId, { text: full });
            flushSentences(); // speak each finished sentence immediately
          }
        }
      }

      if (buf.trim()) speak(buf.trim(), false); // trailing fragment
      if (!full.trim()) return false;

      m.messages.push({ role: "assistant", content: full.trim() });
      success = true;
      return true;
    } catch {
      return false;
    } finally {
      m.streamDone = true;
      // Only reopen the mic if the stream was successful and all speech
      // already finished. On failure the caller handles retry/fallback,
      // so we must NOT race by starting recognition here.
      if (success && m.pendingUtterances <= 0 && m.on && m.state !== "listening") {
        startListening();
      }
    }
  };

  // ---------- fallback L2: fillers ----------
  const armFillers = () => {
    clearFillers();
    m.fillerTimer = setTimeout(() => {
      if (m.state !== "thinking") return;
      const f = FILLERS[Math.floor(Math.random() * FILLERS.length)];
      addTurn("assistant", f, { filler: true });
      speak(f, true);
    }, 1500);
    m.secondFillerTimer = setTimeout(() => {
      if (m.state !== "thinking") return;
      const f = SECOND_FILLERS[Math.floor(Math.random() * SECOND_FILLERS.length)];
      addTurn("assistant", f, { filler: true });
      speak(f, true);
    }, 5500);
  };

  const clearFillers = () => {
    clearTimeout(m.fillerTimer);
    clearTimeout(m.secondFillerTimer);
  };

  // ---------- fallback L4: offline brain ----------
  const offlineReply = (userText) => {
    setOnline(false);
    clearFillers();
    const reply = localBrain(userText.toLowerCase());
    addTurn("assistant", reply);
    m.messages.push({ role: "assistant", content: reply });
    m.streamDone = true;
    speak(reply, false);
  };

  // ---------- mic level visualizer (Web Audio API) ----------
  const startVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / data.length) / 64; // ~0..1
        // quantize to avoid re-rendering React 60x/sec for tiny changes
        setMicLevel(Math.min(1, Math.round(rms * 20) / 20));
        m.audio.raf = requestAnimationFrame(loop);
      };

      m.audio = { ctx, stream, raf: requestAnimationFrame(loop) };
    } catch {
      /* visualizer is cosmetic — never break the app over it */
    }
  };

  const stopVisualizer = () => {
    if (!m.audio) return;
    cancelAnimationFrame(m.audio.raf);
    m.audio.stream.getTracks().forEach((t) => t.stop());
    m.audio.ctx.close();
    m.audio = null;
    setMicLevel(0);
  };

  // ---------- public controls ----------
  const stop = () => {
    m.on = false;
    setConversationOn(false);
    clearFillers();
    try {
      m.recognition && m.recognition.abort();
    } catch {
      /* ignore */
    }
    speechSynthesis.cancel();
    stopVisualizer();
    setState("idle");
    setStatus("Tap the orb to start a conversation");
    setInterim("");
  };

  const toggle = () => {
    if (!SR) {
      setStatus("This browser has no speech recognition — use Chrome or Edge.");
      return;
    }
    if (m.on) {
      stop(); // also acts as barge-in while speaking
    } else {
      m.on = true;
      setConversationOn(true);
      startVisualizer();
      startListening();
    }
  };

  // Send a typed/tapped query (suggestion chips) — works even without the mic.
  const sendText = (text) => {
    if (m.state === "thinking") return; // one query at a time
    speechSynthesis.cancel();
    m.pendingUtterances = 0;
    m.tUserDone = performance.now();
    // Activate conversation mode so the mic reopens after the reply
    if (!m.on) {
      m.on = true;
      setConversationOn(true);
      startVisualizer();
    }
    handleUserQuery(text);
  };

  // voices load asynchronously
  useEffect(() => {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    micState,
    status,
    interim,
    online,
    lastLatency,
    micLevel,
    turns,
    conversationOn,
    toggle,
    sendText,
    supported: !!SR,
  };
}

// Tiny rule-based brain so the assistant stays useful with no connectivity.
function localBrain(t) {
  const now = new Date();
  if (/\b(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t))
    return "Hello! Nice to hear from you. What can I do for you?";
  if (/\b(your name|who are you)\b/.test(t))
    return "I'm your voice assistant. My cloud brain is resting right now, but I'm still here with you.";
  if (/\btime\b/.test(t))
    return (
      "It's " +
      now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
      " right now."
    );
  if (/\b(date|day|today)\b/.test(t))
    return (
      "Today is " +
      now.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      }) +
      "."
    );
  if (/\bjoke\b/.test(t))
    return "Why don't programmers like nature? Too many bugs!";
  if (/\bhow are you\b/.test(t))
    return "I'm doing great, thanks for asking! How are you doing?";
  if (/\b(thanks|thank you)\b/.test(t)) return "You're very welcome!";
  if (/\b(bye|goodbye|see you)\b/.test(t))
    return "Goodbye! It was lovely talking with you.";
  return (
    "I'm having a little trouble reaching my knowledge service right now, " +
    "but I don't want to leave you hanging. Ask me the time, the date, or " +
    "for a joke — or try that question again in a few seconds."
  );
}
