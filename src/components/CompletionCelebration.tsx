import type { CSSProperties } from "react";
import { Check, Sparkles } from "lucide-react";
import "./CompletionCelebration.css";

const colors = [
  "var(--accent)",
  "var(--gold)",
  "var(--green)",
  "#eaa787",
  "#92bbdc",
];
const pieces = Array.from(
  { length: 30 },
  (_, index) =>
    ({
      "--drift": `${(index % 2 ? 1 : -1) * (10 + ((index * 7) % 33))}vw`,
      "--lift": `${-18 - ((index * 11) % 28)}vh`,
      "--fall": `${10 + ((index * 3) % 18)}vh`,
      "--spin": `${(index % 2 ? 1 : -1) * (180 + ((index * 43) % 400))}deg`,
      "--delay": `${(index % 5) * 25}ms`,
      backgroundColor: colors[index % colors.length],
    }) as CSSProperties,
);

export default function CompletionCelebration() {
  return (
    <div className="completion-celebration" aria-hidden="true">
      {pieces.map((style, index) => (
        <span className="celebration-confetti" style={style} key={index} />
      ))}
      <div className="celebration-badge">
        <span className="celebration-check">
          <Check size={28} strokeWidth={2.5} />
        </span>
        <div>
          <strong>Nicely done!</strong>
          <span>One little step forward.</span>
        </div>
        <Sparkles className="celebration-sparkles" size={22} />
      </div>
    </div>
  );
}
