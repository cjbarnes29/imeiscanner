// The assistant's face. It shows the real state from src/assistant-activity.ts with a few lightweight SVG parts moved only by transform and opacity:
// idle/ready blink slowly, checking looks side to side, reading chews with crumbs, thinking shows three dots, waiting has half-closed eyes and "zz",
// ready has a check badge, error has an amber "!". With "reduce motion" nothing moves: each state keeps its own still picture, and the words say the same.
import { ACTIVITY_LABEL, useActivity, type Activity } from './assistant-activity';

export function AssistantMascot({ extra, showLabel = false }: { extra?: Record<string, Activity | null | undefined>; showLabel?: boolean }) {
  const kind = useActivity(extra);
  return <span className={`ai-mascot ai-${kind}`} data-state={kind} role="img" aria-label={ACTIVITY_LABEL[kind]}>
    <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" focusable="false">
      <rect className="face" x="4" y="6" width="24" height="21" rx="7" />
      <circle className="eye" cx="12" cy="14.5" r="2.3" />
      <circle className="eye" cx="20" cy="14.5" r="2.3" />
      <path className="mouth" d="M11.5 21 Q16 24.2 20.5 21" />
      <ellipse className="mouth-open" cx="16" cy="21.8" rx="3.6" ry="2.4" />
      <rect className="crumb c1" x="3" y="22" width="2.4" height="2.4" rx=".6" />
      <rect className="crumb c2" x="1.5" y="18" width="2" height="2" rx=".5" />
      <rect className="crumb c3" x="5" y="26" width="2" height="2" rx=".5" />
      <circle className="dot d1" cx="21" cy="3" r="1.5" />
      <circle className="dot d2" cx="25" cy="3" r="1.5" />
      <circle className="dot d3" cx="29" cy="3" r="1.5" />
      <text className="zz" x="23" y="5" fontSize="7" fontWeight="700">zz</text>
      <circle className="badge-ready-bg" cx="26" cy="7" r="5" />
      <path className="badge-ready" d="M23.4 7.2 L25.4 9.2 L29 5.4" />
      <circle className="badge-error-bg" cx="26" cy="7" r="5" />
      <path className="badge-error" d="M26 4.6 V7.6 M26 9.6 V9.7" />
    </svg>
    {showLabel && <span className="ai-mascot-label" role="status">{ACTIVITY_LABEL[kind]}</span>}
  </span>;
}
