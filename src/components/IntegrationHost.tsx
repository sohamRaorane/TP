import { useEffect } from 'react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { initPersistence } from '@/services/persistence';

/** Mounts global keyboard shortcuts and persistence (autosave, recovery, routing) once. */
export function IntegrationHost() {
  useKeyboardShortcuts();
  useEffect(() => initPersistence(), []);
  return null;
}
