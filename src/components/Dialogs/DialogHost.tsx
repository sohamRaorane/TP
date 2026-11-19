import { useCanvasStore } from '@/store/canvasStore';
import type { UiDialog } from '../commands';
import { CommandPalette } from './CommandPalette';
import { DashboardDialog } from './DashboardDialog';
import { ExportDialog } from './ExportDialog';
import { HelpDialog } from './HelpDialog';
import { LibrarySidebar } from './LibrarySidebar';
import { ShareDialog } from './ShareDialog';
import { StatsPanel } from './StatsPanel';
import { TextToDiagramDialog } from './TextToDiagramDialog';
import { VersionHistory } from './VersionHistory';

/** Renders the dialog / drawer / panel named by appState.openDialog. */
export function DialogHost() {
  const dialog = useCanvasStore((s) => s.appState.openDialog) as UiDialog;
  switch (dialog) {
    case 'export': return <ExportDialog />;
    case 'share': return <ShareDialog />;
    case 'help': return <HelpDialog />;
    case 'library': return <LibrarySidebar />;
    case 'commandPalette': return <CommandPalette />;
    case 'versions': return <VersionHistory />;
    case 'dashboard': return <DashboardDialog />;
    case 'stats': return <StatsPanel />;
    case 'textToDiagram': return <TextToDiagramDialog />;
    default: return null;
  }
}
