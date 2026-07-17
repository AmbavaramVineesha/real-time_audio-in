/**
 * The mic "orb" — button and status indicator in one.
 * - Listening: the halo ring physically swells with the live mic level
 *   (Web Audio API), so the UI visibly reacts to the user's voice.
 * - Speaking: the mic icon morphs into an animated equalizer.
 */
export default function MicOrb({ state, level, onClick }) {
  return (
    <button
      className={`orb ${state}`}
      onClick={onClick}
      aria-label="Toggle microphone"
    >
      <span
        className="halo"
        style={{ transform: `scale(${1 + level * 1.8})` }}
      />
      <span className="ring" />
      <span className="core">
        {state === "speaking" ? (
          <span className="eq">
            <span /><span /><span /><span /><span />
          </span>
        ) : (
          <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        )}
      </span>
    </button>
  );
}
