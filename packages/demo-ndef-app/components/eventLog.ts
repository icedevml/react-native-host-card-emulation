import React from 'react';
import type { Buffer } from 'buffer/';

export type LogSource = 'fg' | 'bg';

export interface LogEntry {
  id: number;
  time: Date;
  source: LogSource;
  text: string;
}

const MAX_ENTRIES = 300;

/*
 Module-level store, so that it's shared between the views and the background handler
 (background.ts). On Android, the background handler runs as a headless JS task in the same
 JS runtime as the UI, so the entries it adds show up in the UI whenever the app is open.
 */
let entries: LogEntry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function logEvent(text: string, source: LogSource = 'fg') {
  console.log(`HCE event [${source}]:`, text);
  entries = [...entries, { id: nextId++, time: new Date(), source, text }].slice(-MAX_ENTRIES);
  notify();
}

export function logApdu(command: Buffer, response: Buffer, source: LogSource = 'fg') {
  logEvent(`<= ${command.toString('hex').toUpperCase()}`, source);
  logEvent(`=> ${response.toString('hex').toUpperCase()}`, source);
}

export function clearEventLog() {
  entries = [];
  notify();
}

export function useEventLog(): LogEntry[] {
  return React.useSyncExternalStore(subscribe, () => entries);
}
