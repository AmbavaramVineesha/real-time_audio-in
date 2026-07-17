import useVoiceAssistant from "./hooks/useVoiceAssistant";
import Transcript from "./components/Transcript";
import MicOrb from "./components/MicOrb";

const SUGGESTIONS = [
  "Tell me a fun fact",
  "What can you do?",
  "Tell me a joke",
  "Give me a productivity tip",
];

export default function App() {
  const va = useVoiceAssistant();

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          <span className="logo">◉</span> AURA
          <span className="sub">real-time voice AI</span>
        </h1>
        <div className="badges">
          <span className={"badge " + (va.online ? "ok" : "warn")}>
            <span className="pulse-dot" />
            {va.online ? "online" : "fallback mode"}
          </span>
          {va.lastLatency && (
            <span className="badge accent">⚡ {va.lastLatency}s</span>
          )}
        </div>
      </header>

      <Transcript turns={va.turns} thinking={va.micState === "thinking"} />

      {/* first-visit suggestion chips — tap to ask without the mic */}
      {va.turns.length <= 1 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip-btn" onClick={() => va.sendText(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="interim">{va.interim ? `“${va.interim}…”` : ""}</div>

      <footer className="controls">
        <div className="status">{va.status}</div>
        <MicOrb state={va.micState} level={va.micLevel} onClick={va.toggle} />
        <div className="hint">
          Conversation mode: the mic reopens automatically after each answer.
          Tap the orb again to stop or interrupt.
        </div>
      </footer>
    </main>
  );
}
