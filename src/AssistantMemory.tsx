import { useState } from 'react';
import { chatOf, clearMemory, deleteNote, editNote, setMemoryOn } from './agent/context';
import { MAX_MEMORY_ITEMS, hasImeiLike } from './retail/data';
import type { RetailCtx } from './retail/ui-helpers';

/** Memory & preferences: off until you switch it on, every note visible, editable and deletable. The assistant never remembers IMEI numbers. */
function Note({ id, text, onSave, onDelete }: { id: string; text: string; onSave: (id: string, text: string) => void; onDelete: (id: string) => void }) {
  const [value, setValue] = useState(text);
  const bad = hasImeiLike(value);
  return <li className="memory-note">
    <input aria-label="Memory note" value={value} maxLength={200} onChange={e => setValue(e.target.value)} />
    <button type="button" className="subtle-btn" disabled={!value.trim() || bad || value.trim() === text} onClick={() => onSave(id, value)}>Save</button>
    <button type="button" className="plan-link" aria-label={`Delete note: ${text.slice(0, 40)}`} onClick={() => onDelete(id)}>Delete</button>
    {bad && <small className="amber">IMEI numbers are never remembered.</small>}
  </li>;
}

export function AssistantMemory(ctx: RetailCtx) {
  const [confirmAll, setConfirmAll] = useState(false);
  const state = ctx.latest?.() || ctx.state, chat = chatOf(state);
  const save = (next: ReturnType<typeof clearMemory>, why: string) => ctx.change(next, why);
  return <details className="assistant-memory">
    <summary>Memory & preferences · {chat.memoryOn ? 'on' : 'off'}</summary>
    <label className="plan-imei-choice"><input type="checkbox" checked={chat.memoryOn} onChange={e => save(setMemoryOn(ctx.latest?.() || state, e.target.checked), 'assistant memory switch')} />Let the assistant remember notes and preferences. Off by default. Kept only on this device, never IMEI numbers.</label>
    {chat.memoryOn && <>
      <p className="settings-help">Say “remember that …”, “what do you remember”, “forget …”, “always use Fold6 when I don’t say a model” or “answer shortly”. Up to {MAX_MEMORY_ITEMS} notes.</p>
      {chat.memory.length === 0 ? <p className="settings-help">No notes yet.</p> : <ul className="memory-list">{chat.memory.map(m => <Note key={m.id + m.text} id={m.id} text={m.text} onSave={(id, text) => save(editNote(ctx.latest?.() || state, id, text), 'edit assistant note')} onDelete={id => save(deleteNote(ctx.latest?.() || state, id), 'delete assistant note')} />)}</ul>}
      {(chat.prefs.defaultModel || chat.prefs.shortAnswers) && <ul className="memory-list">
        {chat.prefs.defaultModel && <li>Default model: <b>{chat.prefs.defaultModel}</b> <button type="button" className="plan-link" onClick={() => save({ ...state, agentChat: { ...chat, prefs: { ...chat.prefs, defaultModel: undefined } } }, 'clear default model')}>Clear</button></li>}
        {chat.prefs.shortAnswers && <li>Short answers <button type="button" className="plan-link" onClick={() => save({ ...state, agentChat: { ...chat, prefs: { ...chat.prefs, shortAnswers: undefined } } }, 'clear short answers')}>Clear</button></li>}
      </ul>}
      {(chat.memory.length > 0 || Object.keys(chat.prefs).length > 0) && (confirmAll
        ? <div className="share-toolbar" role="group" aria-label="Forget everything"><span className="settings-help">Delete all notes and preferences?</span><button type="button" className="subtle-btn danger" onClick={() => { save(clearMemory(ctx.latest?.() || state), 'forget all assistant notes'); setConfirmAll(false); }}>Yes, forget everything</button><button type="button" className="plan-link" onClick={() => setConfirmAll(false)}>No</button></div>
        : <button type="button" className="plan-link" onClick={() => setConfirmAll(true)}>Forget everything</button>)}
    </>}
  </details>;
}
