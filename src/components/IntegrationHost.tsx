import { useEffect } from 'react';
import { loadOptional, PATHS, useOptionalModule, type KeyboardModule, type PersistenceModule } from './integration';

function KeyboardShortcuts({ hook }: { hook: () => void }) {
  hook();
  return null;
}

/** Mounts C's keyboard shortcuts hook and persistence once they exist. */
export function IntegrationHost() {
  const keyboard = useOptionalModule<KeyboardModule>(PATHS.keyboard);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void loadOptional<PersistenceModule>(PATHS.persistence).then((m) => {
      if (cancelled || !m?.initPersistence) return;
      try { dispose = m.initPersistence(); } catch (e) { console.error('[sketchboard] initPersistence failed', e); }
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);

  return keyboard?.useKeyboardShortcuts ? <KeyboardShortcuts hook={keyboard.useKeyboardShortcuts} /> : null;
}
