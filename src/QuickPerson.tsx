// A small "+ Person" button that opens a name box, so a person can be made right where the people are chosen (Phones, Scan).
import { useState } from 'react';

export function QuickPerson({ onAdd, label = '+ Person' }: { onAdd: (name: string) => boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return <button type="button" className="chip-add" onClick={() => setOpen(true)}>{label}</button>;
  return <form className="quick-person" onSubmit={event => { event.preventDefault(); if (onAdd(name)) { setName(''); setOpen(false); } }}>
    <input autoFocus aria-label="New person name" placeholder="Name of the person" maxLength={40} value={name} onChange={event => setName(event.target.value)} />
    <button type="submit" className="primary" disabled={!name.trim()}>Add</button>
    <button type="button" className="subtle-btn" onClick={() => { setOpen(false); setName(''); }}>Cancel</button>
  </form>;
}
