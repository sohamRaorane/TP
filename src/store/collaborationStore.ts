// Collaboration state. CONTRACT — Agent C implements the socket service that fills this;
// Agent A reads it to draw remote cursors/selection/laser; Agent B reads it for presence UI.
import { create } from 'zustand';
import type { Collaborator, PointerPayload } from '@shared/protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface CollaborationState {
  roomId: string | null;
  role: 'edit' | 'view';
  status: ConnectionStatus;
  me: { userId: string; name: string; color: string };
  /** other users (excludes own socket) */
  collaborators: Collaborator[];
  pointers: Record<string, PointerPayload & { updated: number }>; // by socketId
  lasers: Record<string, Array<[number, number, number]>>; // by socketId, x,y,t
  /** own laser trail (also rendered locally) */
  localLaser: Array<[number, number, number]>;
  set: (p: Partial<CollaborationState>) => void;
}

const COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#c2255c'];
const loadMe = () => {
  try {
    const raw = localStorage.getItem('sketchboard:me');
    if (raw) {
      const me = JSON.parse(raw) as CollaborationState['me'];
      return /^Guest \d+$/.test(me.name) ? { ...me, name: '' } : me;
    }
  } catch { /* ignore */ }
  const me = {
    userId: crypto.randomUUID(),
    name: '',
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  try { localStorage.setItem('sketchboard:me', JSON.stringify(me)); } catch { /* ignore */ }
  return me;
};

export const useCollaborationStore = create<CollaborationState>((set) => ({
  roomId: null,
  role: 'edit',
  status: 'disconnected',
  me: loadMe(),
  collaborators: [],
  pointers: {},
  lasers: {},
  localLaser: [],
  set: (p) => set(p),
}));
