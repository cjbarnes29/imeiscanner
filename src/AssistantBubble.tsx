// The assistant's small round button, shown on every screen above the bottom bar. Tapping it opens the small chat card (or closes it again). It shows the
// assistant's face, so what the assistant is really doing (checking, reading, ready for review…) is visible without opening anything.
import { AssistantMascot } from './AssistantMascot';
import type { Activity } from './assistant-activity';

export function AssistantBubble({ onToggle, disabled, open, extra }: { onToggle: () => void; disabled: boolean; open: boolean; extra?: Record<string, Activity | null | undefined> }) {
  return <button type="button" className="assistant-launch assistant-bubble" aria-label="Open assistant" aria-expanded={open} title="Ask the assistant" disabled={disabled} onClick={onToggle}><AssistantMascot extra={extra} /></button>;
}
