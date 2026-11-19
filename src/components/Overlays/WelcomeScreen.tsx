import type { CSSProperties, ReactNode } from 'react';
import { CircleQuestionMark, FolderOpen, Sparkles, Users } from 'lucide-react';
import { useCanvasStore } from '@/store/canvasStore';
import { LogoMark } from '../icons';
import { kbd } from '../ui/portal';
import { useIsNarrow, useMediaQuery } from '../ui/useMedia';
import { openDialog } from '../commands';

const ArrowSvg = ({ d, head, w, h, style }: { d: string; head: string; w: number; h: number; style: CSSProperties }) => (
  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" stroke="var(--hint)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', ...style }} aria-hidden>
    <path d={d} />
    <path d={head} />
  </svg>
);

const welcomeVisible = (s: ReturnType<typeof useCanvasStore.getState>) => {
  const a = s.appState;
  if (a.zenMode || a.viewModeEnabled || a.presentation.active) return false;
  if (a.activeTool !== 'selection' && a.activeTool !== 'hand') return false;
  return !s.elements.some((e) => !e.isDeleted);
};

function Item({ icon, label, shortcut, onClick, testId }: { icon: ReactNode; label: string; shortcut?: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      className="sb-pe flex w-full items-center gap-3 hover:bg-[var(--color-surface-high)]"
      style={{ height: 40, padding: '0 12px', borderRadius: 8, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', font: '500 14px var(--ui-font)' }}
      onClick={onClick}
      data-testid={testId}
    >
      <span style={{ display: 'inline-flex', color: 'var(--color-muted)' }}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span style={{ fontSize: 12, color: 'var(--color-muted-2)' }}>{shortcut}</span>}
    </button>
  );
}

/** Empty-canvas welcome screen with hand-drawn hints (Excalidraw-like). */
export function WelcomeScreen() {
  const visible = useCanvasStore(welcomeVisible);
  const narrow = useIsNarrow();
  const showHints = useMediaQuery('(min-width: 901px)');
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 select-none" style={{ zIndex: 5 }} data-testid="welcome-screen">
      {showHints && !narrow && (
        <>
          {/* menu hint */}
          <div className="absolute" style={{ left: 30, top: 62 }}>
            <ArrowSvg w={40} h={56} style={{ left: 0, top: 0 }} d="M30 52 C 10 44, 4 26, 8 4" head="M2 12 L 8 3 L 15 10" />
            <div className="sb-hint" style={{ position: 'absolute', left: 40, top: 40, width: 220 }}>Open, export, themes & more…</div>
          </div>
          {/* toolbar hint */}
          <div className="absolute" style={{ left: 76, top: '50%', transform: 'translateY(-50%)' }}>
            <ArrowSvg w={90} h={60} style={{ left: 0, top: -10 }} d="M86 44 C 60 50, 30 40, 8 20" head="M8 32 L 7 19 L 20 18" />
            <div className="sb-hint" style={{ position: 'absolute', left: 92, top: 18, width: 230 }}>Pick a tool &amp; start drawing!</div>
          </div>
          {/* share / library / help hint */}
          <div className="absolute" style={{ right: 60, top: 62 }}>
            <ArrowSvg w={44} h={56} style={{ right: 0, top: 0 }} d="M8 52 C 30 44, 36 26, 32 4" head="M24 11 L 32 3 L 38 12" />
            <div className="sb-hint" style={{ position: 'absolute', right: 44, top: 40, width: 220, textAlign: 'right' }}>Share, library &amp; help</div>
          </div>
        </>
      )}
      <div className="absolute flex flex-col items-center" style={{ left: '50%', top: '46%', transform: 'translate(-50%, -50%)', width: 'min(360px, 86vw)' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
          <LogoMark size={narrow ? 40 : 52} />
          <span style={{ font: `700 ${narrow ? 34 : 44}px/1 var(--font-hand)`, color: 'var(--color-primary)', letterSpacing: '0.01em', paddingTop: 8 }}>Sketchboard</span>
        </div>
        <div className="sb-hint text-center" style={{ fontSize: 16, marginBottom: 22 }}>
          Your data is saved locally in this browser.
        </div>
        <div className="flex w-full flex-col" style={{ gap: 2, maxWidth: 300 }}>
          <Item icon={<FolderOpen size={17} />} label="Open" shortcut={kbd('Ctrl+O')} onClick={() => openDialog('dashboard')} testId="welcome-open" />
          <Item icon={<Users size={17} />} label="Live collaboration…" onClick={() => openDialog('share')} testId="welcome-collab" />
          <Item icon={<Sparkles size={17} />} label="Text to diagram…" onClick={() => openDialog('textToDiagram')} testId="welcome-t2d" />
          <Item icon={<CircleQuestionMark size={17} />} label="Help" shortcut="?" onClick={() => openDialog('help')} testId="welcome-help" />
        </div>
      </div>
    </div>
  );
}
