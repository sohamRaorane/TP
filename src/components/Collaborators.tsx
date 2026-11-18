import { memo } from 'react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import type { Collaborator } from '@shared/protocol';
import { Tooltip } from './ui/Tooltip';
import { run } from './run';

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('') || '?';

export const Avatar = memo(function Avatar({ user, following, size = 28 }: { user: Pick<Collaborator, 'name' | 'color' | 'socketId'>; following?: boolean; size?: number }) {
  return (
    <Tooltip label={following ? `Stop following ${user.name}` : `Follow ${user.name}`}>
      <button
        type="button"
        aria-label={following ? `Stop following ${user.name}` : `Follow ${user.name}`}
        aria-pressed={following}
        className={`sb-avatar ${following ? 'is-following' : ''}`}
        style={{ background: user.color, width: size, height: size }}
        onClick={() => run(() => actions.followUser(following ? null : user.socketId))}
      >
        {initials(user.name)}
      </button>
    </Tooltip>
  );
});

/** Overlapping avatar stack of collaborators (max 4 + overflow count). */
export function AvatarStack({ max = 4 }: { max?: number }) {
  const users = useCollaborationStore((s) => s.collaborators);
  const following = useCanvasStore((s) => s.appState.followingSocketId);
  if (!users.length) return null;
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex items-center" style={{ paddingLeft: 6 }} data-testid="avatar-stack">
      {shown.map((u) => (
        <span key={u.socketId} style={{ marginLeft: -6 }}>
          <Avatar user={u} following={following === u.socketId} />
        </span>
      ))}
      {rest > 0 && (
        <span className="sb-avatar" style={{ marginLeft: -6, background: 'var(--color-surface-low)', color: 'var(--color-on-surface)', cursor: 'default' }}>
          +{rest}
        </span>
      )}
    </div>
  );
}
