import React from 'react';

/**
 * Keeps the most recent HCE events, for display purposes.
 */
export default function useEventLog(): [string, (entry: string) => void] {
  const [entries, setEntries] = React.useState<string[]>([]);

  const addEntry = React.useCallback((entry: string) => {
    console.log('HCE event:', entry);
    setEntries(prev => [...prev, entry].slice(-15));
  }, []);

  return [entries.join('\n'), addEntry];
}
