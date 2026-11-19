import { useState } from 'react';
import { Check, Copy, Eye, LogOut, Pencil, Users } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { initials } from '../Collaborators';
import { Dialog } from '../ui/Dialog';
import { closeDialog } from '../commands';
import { run, runAsync, toast } from '../run';

const USER_COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#c2255c'];

function saveMe(p: Partial<{ name: string; color: string }>) {
  const st = useCollaborationStore.getState();
  const me = { ...st.me, ...p };
  st.set({ me });
  try { localStorage.setItem('sketchboard:me', JSON.stringify(me)); } catch { /* ignore quota */ }
}

function Identity() {
  const me = useCollaborationStore((s) => s.me);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="sb-me-name" style={{ font: '600 13px var(--ui-font)' }}>Your name</label>
      <div className="flex items-center gap-2">
        <span className="sb-avatar" style={{ background: me.color, cursor: 'default', width: 34, height: 34 }} aria-hidden>{initials(me.name)}</span>
        <input
          id="sb-me-name"
          className="sb-input"
          data-testid="collab-name"
          value={me.name}
          maxLength={40}
          placeholder="Enter your name"
          data-autofocus={!me.name.trim() ? 'true' : undefined}
          onChange={(e) => saveMe({ name: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Your color">
        {USER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={me.color === c}
            aria-label={`Color ${c}`}
            className={`sb-swatch ${me.color === c ? 'is-active' : ''}`}
            style={{ background: c, borderRadius: 11 }}
            onClick={() => saveMe({ color: c })}
          />
        ))}
      </div>
    </div>
  );
}

export function ShareDialog() {
  const roomId = useCollaborationStore((s) => s.roomId);
  const role = useCollaborationStore((s) => s.role);
  const status = useCollaborationStore((s) => s.status);
  const users = useCollaborationStore((s) => s.collaborators);
  const following = useCanvasStore((s) => s.appState.followingSocketId);
  const [links, setLinks] = useState<{ edit?: string; view?: string }>({});
  const [busy, setBusy] = useState<'edit' | 'view' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);

  const start = async (mode: 'edit' | 'view') => {
    if (!useCollaborationStore.getState().me.name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setBusy(mode);
    const url = await runAsync(() => actions.startCollaboration(mode));
    setBusy(null);
    if (url) setLinks((l) => ({ ...l, [mode]: url }));
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      toast('Could not copy the link', 'error');
    }
  };

  const fallback = roomId ? `${location.origin}${location.pathname}?room=${roomId}` : undefined;
  const editLink = links.edit ?? (roomId && role === 'edit' ? fallback : undefined);

  const linkRow = (url: string, kind: 'edit' | 'view') => (
    <div className="flex flex-col gap-1.5">
      <span style={{ font: '600 13px var(--ui-font)' }}>{kind === 'edit' ? 'Edit link' : 'View-only link'}</span>
      <div className="flex gap-2">
        <input className="sb-input" readOnly value={url} aria-label={`${kind} link`} data-testid={`share-link-${kind}`} onFocus={(e) => e.target.select()} style={{ fontFamily: 'var(--mono-font)', fontSize: 12 }} />
        <button type="button" className="sb-btn sb-btn--primary" onClick={() => copy(url)} data-testid={`copy-link-${kind}`}>
          {copied === url ? <Check size={16} /> : <Copy size={16} />}
          {copied === url ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );

  return (
    <Dialog title="Live collaboration" onClose={closeDialog} width={520} testId="share-dialog">
      <div className="sb-dialog__body flex flex-col gap-5">
        {!roomId ? (
          <>
            <div className="flex flex-col items-center gap-2 text-center" style={{ padding: '4px 8px 0' }}>
              <div className="flex items-center justify-center" style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--color-primary-light)', color: 'var(--color-primary-darker)' }}>
                <Users size={24} />
              </div>
              <p style={{ margin: 0, font: '400 14px/1.5 var(--ui-font)', color: 'var(--color-muted)' }}>
                Invite people to collaborate on your drawing in real time. Anyone with the link can join; the session stays live while someone is connected.
              </p>
            </div>
            <Identity />
            {nameError && <p role="alert" style={{ margin: '-10px 0 0', color: 'var(--color-danger-strong)', font: '500 13px var(--ui-font)' }}>Enter your name before starting a session.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sb-btn sb-btn--primary" style={{ flex: 1 }} disabled={!!busy} data-testid="start-session" onClick={() => start('edit')}>
                <Pencil size={16} /> {busy === 'edit' ? 'Starting…' : 'Start session'}
              </button>
              <button type="button" className="sb-btn sb-btn--outline" style={{ flex: 1 }} disabled={!!busy} data-testid="start-view-session" onClick={() => start('view')}>
                <Eye size={16} /> {busy === 'view' ? 'Creating…' : 'View-only link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2" style={{ font: '500 13px var(--ui-font)', color: 'var(--color-muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: status === 'connected' ? 'var(--color-success)' : '#f08c00' }} />
              {status === 'connected' ? 'Session is live' : `Session ${status}…`}
              {role === 'view' && ' · you are viewing'}
            </div>
            {editLink && linkRow(editLink, 'edit')}
            {links.view ? (
              linkRow(links.view, 'view')
            ) : (
              role === 'edit' && (
                <button type="button" className="sb-btn sb-btn--outline self-start sb-btn--sm" disabled={!!busy} onClick={() => start('view')}>
                  <Eye size={14} /> Create view-only link
                </button>
              )
            )}
            <Identity />
            <div className="flex flex-col gap-1.5">
              <span style={{ font: '600 13px var(--ui-font)' }}>In this session ({users.length + 1})</span>
              <ul className="flex flex-col gap-1" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="collaborator-list">
                {users.map((u) => (
                  <li key={u.socketId} className="flex items-center gap-2" style={{ padding: '4px 0' }}>
                    <span className="sb-avatar" style={{ background: u.color, cursor: 'default' }} aria-hidden>{initials(u.name)}</span>
                    <span className="flex-1 truncate" style={{ font: '500 14px var(--ui-font)' }}>
                      {u.name}
                      {u.role === 'view' && <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}> · viewer</span>}
                    </span>
                    <button
                      type="button"
                      className={`sb-btn sb-btn--sm ${following === u.socketId ? 'sb-btn--primary' : 'sb-btn--outline'}`}
                      aria-pressed={following === u.socketId}
                      onClick={() => run(() => actions.followUser(following === u.socketId ? null : u.socketId))}
                    >
                      {following === u.socketId ? 'Following' : 'Follow'}
                    </button>
                  </li>
                ))}
                {!users.length && <li style={{ font: '400 13px var(--ui-font)', color: 'var(--color-muted)' }}>Nobody else is here yet. Share the link!</li>}
              </ul>
            </div>
            <div className="sb-hdivider" />
            <button
              type="button"
              className="sb-btn self-start"
              style={{ color: 'var(--color-danger-strong)', background: 'var(--color-danger-bg)' }}
              data-testid="stop-session"
              onClick={() => { run(() => actions.stopCollaboration()); setLinks({}); }}
            >
              <LogOut size={16} /> Stop session
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
