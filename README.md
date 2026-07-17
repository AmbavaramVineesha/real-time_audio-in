# Real-Time Voice Assistant (Audio-In / Audio-Out)

A real-time conversational AI assistant: you **speak** to it, it **speaks back** —
with sub-2-second voice-to-voice latency and a layered fallback system that keeps
the conversation alive even when the AI service is slow or down.

## Demo flow

1. Click the mic → speak a question.
2. Your words appear live as you talk (interim speech recognition).
3. The reply streams in and is **spoken sentence-by-sentence while still generating**.
4. When it finishes speaking, the mic re-opens automatically (conversation mode).
5. A ⚡ badge shows the measured voice-to-voice latency for every turn.

## Quick start

```bash
pip install -r requirements.txt          # backend deps
cd frontend && npm install && npm run build && cd ..   # build the React UI
```

1. Get a **free** API key at https://console.groq.com (no credit card).
2. Put it in `.env`:  `GROQ_API_KEY=gsk_...`
3. Run the server:

```bash
uvicorn server:app --port 8000
```

4. Open **http://localhost:8000** in **Chrome or Edge** (they have the Web Speech API).
5. Click the mic orb, allow microphone access, and talk.

For frontend development with hot reload: `cd frontend && npm run dev`
(Vite dev server on port 5173, proxying `/chat` to the FastAPI backend).

## Architecture

```
React 19 + Vite frontend (Chrome/Edge)
├─ Voice input  : Web Speech API (SpeechRecognition) — built into the browser
├─ Voice output : speechSynthesis — built in, near-zero latency
├─ useVoiceAssistant hook : streaming, sentence-chunked TTS, fallback engine
└─ Voice-reactive mic orb : Web Audio API (AnalyserNode) live level meter
        │  SSE token stream
        ▼
FastAPI server (server.py)
└─ /chat : proxies the conversation to Groq (llama-3.1-8b-instant)
           and streams tokens back. Holds the API key server-side.
```

## How it stays under 2 seconds

- **Interim STT**: the transcript is ready the instant you stop speaking.
- **Groq**: one of the fastest LLM inference services (~0.3–0.6 s to first token).
- **Streaming + sentence chunking**: the first sentence is spoken while the rest
  of the reply is still being generated — we never wait for the full answer.
- **Prompt engineering**: the system prompt forces a short first sentence, so
  speech can begin almost immediately.
- The UI measures and displays real voice-to-voice latency each turn.

## Fallback design ("never go silent")

| Layer | Trigger | Behaviour |
|---|---|---|
| L1 | instantly | UI shows "thinking" state |
| L2 | no token after 1.5 s | speaks a natural filler ("Hmm, let me think…"); a second filler at 5.5 s |
| L3 | request fails | one silent retry while the filler keeps the user engaged |
| L4 | retry fails / offline | local "mini brain" answers simple intents (time, date, jokes, greetings, small talk) and invites the user to try again — no error messages, no dead ends |
| — | next turn | automatically tries the online path again and recovers |

**Known limitation (documented honestly):** Chrome's built-in speech *recognition*
uses an online service, so with no internet at all, voice input itself is limited.
The fallback layers fully cover the realistic failure cases: LLM API slowness,
outages, rate limits, and invalid keys.

## Why an online LLM (per the brief)

The assignment prefers offline but explicitly allows online when offline is not
feasible. Development hardware could not run local LLM inference at conversational
speed, so the design uses: browser-native speech APIs (local, free) + the fastest
available free cloud LLM + an offline fallback brain — maximising the offline
surface while keeping sub-2-second latency.

## AI usage disclosure

- **Groq API — `llama-3.1-8b-instant`**: generates all assistant responses at runtime.
- **Web Speech API** (browser built-in): speech-to-text and text-to-speech.
- **Claude Code (Anthropic)**: used as an AI pair-programming assistant to design
  and write this codebase.

## Project files

| File | Purpose |
|---|---|
| `server.py` | FastAPI backend: serves the React build, streams LLM tokens (SSE) |
| `frontend/src/hooks/useVoiceAssistant.js` | The core: voice loop, SSE streaming, sentence-chunked TTS, 4-layer fallback engine, Web Audio mic-level meter |
| `frontend/src/App.jsx` | App shell: header badges, transcript, orb, status |
| `frontend/src/components/MicOrb.jsx` | Voice-reactive mic orb (state colors + live halo) |
| `frontend/src/components/Transcript.jsx` | Auto-scrolling chat history |
| `frontend/src/index.css` | Glassmorphism dark UI, animated gradient orb states |
| `.env` | `GROQ_API_KEY` (never committed) |

## Tech stack

React 19 · Vite 8 · FastAPI · Groq (`llama-3.1-8b-instant`) · Web Speech API ·
Web Audio API · Server-Sent Events
