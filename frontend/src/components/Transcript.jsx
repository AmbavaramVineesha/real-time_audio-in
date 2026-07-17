import { useEffect, useRef } from "react";

/** Assistant avatar: a tiny glowing orb, mirrors the big one. */
function Avatar() {
  return <span className="avatar" aria-hidden="true" />;
}

/** Chat history. Auto-scrolls as tokens stream into the newest bubble. */
export default function Transcript({ turns, thinking }) {
  const ref = useRef(null);

  // Show animated "thinking" dots only before the reply starts streaming.
  const showDots = thinking && turns[turns.length - 1]?.role === "user";

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, showDots]);

  return (
    <section ref={ref} className="transcript">
      {turns.map((t) => (
        <div
          key={t.id}
          className={`msg ${t.role}${t.filler ? " filler" : ""}`}
        >
          {t.role === "assistant" && <Avatar />}
          <div className="bubble">
            {t.text}
            {t.latency && (
              <span className="turn-latency">
                ⚡ voice-to-voice: {t.latency}s
                {t.ttft && ` · first AI token: ${t.ttft}s`}
              </span>
            )}
          </div>
        </div>
      ))}

      {showDots && (
        <div className="msg assistant">
          <Avatar />
          <div className="bubble dots">
            <span /><span /><span />
          </div>
        </div>
      )}
    </section>
  );
}
