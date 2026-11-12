import { useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  /** Called with every edit. The parent may apply it at low priority; the box itself never waits for it. */
  onValue: (value: string) => void;
  /** Cleans typed text (for example digits only). */
  clean?: (value: string) => string;
};

/**
 * A text box that keeps its own text, so typing stays instant even when the page around it is large and
 * slow to redraw. The parent is told after each edit and again when the box loses focus; an outside change
 * of `value` (for example opening another record) replaces the text.
 */
export function DeferredInput({ value, onValue, clean, onBlur, ...rest }: Props) {
  const [local, setLocal] = useState(value);
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current) { sent.current = value; setLocal(value); }
  }, [value]);
  return <input
    {...rest}
    value={local}
    onChange={event => {
      const next = clean ? clean(event.target.value) : event.target.value;
      sent.current = next;
      setLocal(next);
      onValue(next);
    }}
    onBlur={event => { onValue(local); onBlur?.(event); }}
  />;
}
