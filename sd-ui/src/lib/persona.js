"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Who an agent is to the person using it: a name, a face and a colour they
 * chose. Kept in this browser and nowhere else.
 *
 * Read as an external store: the server renders the default, the browser
 * reads what this device chose, and a change tells every subscriber on the
 * page. Private mode or blocked storage falls back to memory for this page.
 * Two agents (the reader's companion, the scholar's agent) each have a key.
 */

export const FACES = ["?", "✦", "★", "☼", "❋", "◆", "A"];
export const TONES = ["navy", "teal", "plum", "amber"];

const listeners = new Map(); // key -> Set<cb>
const memory = new Map(); // key -> raw json, when storage is unavailable

function subscribeFor(key) {
  return (cb) => {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(cb);
    return () => listeners.get(key)?.delete(cb);
  };
}
function snapshotFor(key) {
  return () => {
    try { return window.localStorage.getItem(key) || memory.get(key) || ""; } catch { return memory.get(key) || ""; }
  };
}
function parsePersona(raw, defaults) {
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw);
    return {
      name: String(p.name || defaults.name).slice(0, 24) || defaults.name,
      face: FACES.includes(p.face) ? p.face : defaults.face,
      tone: TONES.includes(p.tone) ? p.tone : defaults.tone,
    };
  } catch {
    return defaults;
  }
}

/**
 * @param {string} key        localStorage key, one per agent
 * @param {{name:string, face:string, tone:string}} defaults
 * @returns {[persona, setPersona]}
 */
export function usePersona(key, defaults) {
  const subscribe = useMemo(() => subscribeFor(key), [key]);
  const snapshot = useMemo(() => snapshotFor(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const persona = useMemo(() => parsePersona(raw, defaults), [raw, defaults]);
  const setPersona = useCallback((next) => {
    const json = JSON.stringify(next);
    memory.set(key, json);
    try { window.localStorage.setItem(key, json); } catch { /* private mode: it lives for this page only */ }
    listeners.get(key)?.forEach((cb) => cb());
  }, [key]);
  return [persona, setPersona];
}
