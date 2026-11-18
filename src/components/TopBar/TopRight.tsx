import { BookOpen, CircleQuestionMark, Download, Redo2, Undo2, Users } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { useHistoryStore } from '@/store/historyStore';
import { AvatarStack } from '../Collaborators';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { kbd } from '../ui/portal';
import { openDialog, closeDialog } from '../commands';
import { run } from '../run';

export function TopRight() {
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const viewMode = useCanvasStore((s) => s.appState.viewModeEnabled);
  const dialog = useCanvasStore((s) => s.appState.openDialog);
  const inRoom = useCollaborationStore((s) => !!s.roomId);
  const count = useCollaborationStore((s) => s.collaborators.length);

  return (
    <div className="absolute flex items-center gap-2" style={{ right: 16, top: 16 }}>
      {!viewMode && (
        <div className="sb-island flex items-center" style={{ padding: 0, gap: 0 }}>
          <IconButton label="Undo" shortcut={kbd('Ctrl+Z')} icon={<Undo2 size={17} />} disabled={!canUndo} data-testid="undo" onClick={() => run(() => actions.undo())} />
          <IconButton label="Redo" shortcut={kbd('Ctrl+Shift+Z')} icon={<Redo2 size={17} />} disabled={!canRedo} data-testid="redo" onClick={() => run(() => actions.redo())} />
        </div>
      )}
      <div className="sb-island sb-hide-narrow">
        <IconButton label="Export image" shortcut={kbd('Ctrl+Shift+E')} icon={<Download size={17} />} data-testid="export-button" onClick={() => openDialog('export')} />
      </div>
      <AvatarStack />
      <Tooltip label={inRoom ? `Live session · ${count + 1} ${count ? 'people' : 'person'}` : 'Live collaboration'}>
        <button
          type="button"
          className="sb-btn sb-btn--primary"
          style={{ boxShadow: 'var(--island-shadow)', padding: '0 14px' }}
          aria-label={inRoom ? `Share, ${count + 1} people in session` : 'Share'}
          data-testid="share-button"
          onClick={() => openDialog('share')}
        >
          {inRoom ? <Users size={16} /> : null}
          Share
          {inRoom && <span className="sb-badge">{count + 1}</span>}
        </button>
      </Tooltip>
      <Tooltip label="Library">
        <button
          type="button"
          className={`sb-btn ${dialog === 'library' ? 'sb-btn--active' : ''}`}
          style={{ background: dialog === 'library' ? 'var(--button-active-bg)' : 'var(--island-bg)', color: dialog === 'library' ? 'var(--button-active-icon)' : undefined, boxShadow: 'var(--island-shadow)', padding: '0 12px' }}
          aria-pressed={dialog === 'library'}
          aria-label="Library"
          data-testid="library-button"
          onClick={() => (dialog === 'library' ? closeDialog() : openDialog('library'))}
        >
          <BookOpen size={17} />
          <span className="sb-hide-narrow">Library</span>
        </button>
      </Tooltip>
      <div className="sb-island sb-hide-narrow">
        <IconButton label="Help" shortcut="?" icon={<CircleQuestionMark size={17} />} data-testid="help-button" onClick={() => openDialog('help')} />
      </div>
    </div>
  );
}
