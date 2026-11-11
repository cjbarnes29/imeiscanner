// Your own Samsung model names, kept on this device. They are looked up before the built-in list,
// so adding a code that is already built in replaces its name, and deleting it brings the built-in name back.
export type CustomModels = Record<string, string>;
export const CUSTOM_MODELS_KEY = 'imei-lens-custom-models';
export const MAX_CUSTOM_MODELS = 2000;

/** "SM-R420B/DS", "r420" or "Model: SM-S948U1" -> "R420" (the part shared by every region and colour). Empty when not a model code. */
export function normalizeCode(text: string): string {
  const upper = String(text || '').toUpperCase().replace(/\s+/g, '');
  return upper.match(/^(?:.*?SM-?)?([A-Z]\d{3})/)?.[1] || '';
}

export function cleanName(name: string): string {
  return String(name || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function readCustomModels(): CustomModels {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_MODELS_KEY) || '{}') as Record<string, unknown>;
    const models: CustomModels = {};
    for (const [key, value] of Object.entries(raw)) {
      const code = normalizeCode(key), name = typeof value === 'string' ? cleanName(value) : '';
      if (code && name) models[code] = name;
    }
    return models;
  } catch { return {}; }
}

/** False when the device storage is full. */
export function writeCustomModels(models: CustomModels): boolean {
  try { localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(models)); return true; } catch { return false; }
}

/**
 * Read a models file: JSON ({"R420":"Galaxy Buds3 FE"}, a list of {modelCode,name}, or the app's catalog file)
 * or text/CSV with one "code, name" per line. Lines that are not a code and a name are counted in `skipped`.
 */
export function parseModelFile(text: string): { entries: CustomModels; skipped: number } {
  const entries: CustomModels = {};
  let skipped = 0;
  const add = (code: unknown, name: unknown) => {
    const key = normalizeCode(String(code ?? '')), label = cleanName(String(name ?? ''));
    if (key && label) entries[key] = label; else skipped++;
  };
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try { data = JSON.parse(trimmed); } catch { return { entries, skipped: 1 }; }
    const items = Array.isArray(data) ? data : Array.isArray((data as { products?: unknown }).products) ? (data as { products: unknown[] }).products : null;
    if (items) {
      for (const item of items) {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        add(row.modelCode ?? row.code ?? row.model, row.name);
      }
    } else for (const [code, name] of Object.entries(data as Record<string, unknown>)) add(code, name);
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split(/[,;\t]/);
      add(parts[0].replace(/^["']|["']$/g, ''), parts.slice(1).join(',').replace(/^\s*["']|["']\s*$/g, ''));
    }
  }
  return { entries, skipped };
}
