// How the assistant's reply is shown: a short headline, then a few clear bullets, with the important numbers in bold. In the small chat only the summary
// (the headline and the first few bullets) is shown; the full text stays on Home. The text itself is never changed, only laid out, so nothing is lost or invented.
import type { ReactNode } from 'react';

const TOKEN = /(\b\d{4}-\d{2}(?:-\d{2})?\b|\b\d[\d,]*(?:\.\d+)?%?)/g;
const IS_DATE = /^\d{4}-\d{2}(?:-\d{2})?$/;
/** Numbers and percentages in bold, dates left plain. */
export function emphasise(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => (i % 2 === 1 && !IS_DATE.test(part) ? <b key={i}>{part}</b> : part));
}
const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text);
/** One long line becomes short sentences (after a full stop or semicolon that is followed by a capital letter or a digit). */
export const sentences = (line: string): string[] => line.split(/(?<=[.;])\s+(?=[A-Z0-9])/).map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);

export function AssistantAnswer({ answer, summary }: { answer: string; summary: boolean }) {
  const lines = answer.split('\n').map(l => l.trim()).filter(Boolean);
  // the first sentence is the headline; every other sentence becomes a bullet
  const first = sentences(lines[0] || '');
  const title = first[0] || '';
  const rest = [...first.slice(1), ...lines.slice(1).flatMap(sentences)];
  const shown = summary ? rest.slice(0, 5) : rest;
  const hidden = rest.length - shown.length;
  return <div className="plan-ai-output assistant-answer" role="region" aria-label="Assistant answer">
    <p className="assistant-answer-title">{emphasise(summary ? cut(title, 160) : title)}</p>
    {shown.length > 0 && <ul>{shown.map((item, i) => <li key={i}>{emphasise(summary ? cut(item, 170) : item)}</li>)}</ul>}
    {hidden > 0 && <p className="assistant-answer-more">{hidden} more detail{hidden === 1 ? '' : 's'} are saved on Home.</p>}
  </div>;
}

/** Questions that make sense after this one. Tapping one asks it straight away. The question just asked is left out. */
export function nextSteps(prompt: string, answer: string): string[] {
  const asked = prompt.trim().toLowerCase();
  const list = /settings|detect|home|automatic/i.test(prompt)
    ? ['Check and explain my settings', 'Show only plans and warnings on Home', 'Check my report']
    : /report|powerpoint|excel|notes/i.test(prompt) || /^Report ready to make/.test(answer)
      ? ['Make an Excel report for this month', 'Make simple notes of my targets', 'Check my report', 'How much real stock do we have?']
      : /target|divide|split/i.test(prompt)
        ? ['Plan to reach 70 percent today', 'Make a PowerPoint report for this month', 'Check my report']
        : ['Check my report', 'How much real stock do we have?', 'Plan to reach 70 percent today', 'Make a PowerPoint report for this month'];
  return list.filter(q => q.toLowerCase() !== asked).slice(0, 4);
}
