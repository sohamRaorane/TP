// App shell. Composition only — no business logic here. Owned by UI agent (B).
import { Canvas } from '@/components/Canvas/Canvas';
import { useCanvasStore } from '@/store/canvasStore';
import { ContextMenu } from '@/components/ContextMenu/ContextMenu';
import { DialogHost } from '@/components/Dialogs/DialogHost';
import { FooterRight, ZoomControls } from '@/components/Footer/Footer';
import { IntegrationHost } from '@/components/IntegrationHost';
import { Minimap } from '@/components/Overlays/Minimap';
import { FollowBanner, PresentationBar, ViewModeBadge, ZenExit } from '@/components/Overlays/Modes';
import { Toasts } from '@/components/Overlays/Toasts';
import { WelcomeScreen } from '@/components/Overlays/WelcomeScreen';
import { PropertiesPanel } from '@/components/PropertiesPanel/PropertiesPanel';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { TopLeft } from '@/components/TopBar/TopLeft';
import { TopRight } from '@/components/TopBar/TopRight';
import { ConfirmHost } from '@/components/ui/confirm';
import { PORTAL_ID } from '@/components/ui/portal';

function Chrome() {
  const presenting = useCanvasStore((s) => s.appState.presentation.active);
  const zen = useCanvasStore((s) => s.appState.zenMode);
  const viewMode = useCanvasStore((s) => s.appState.viewModeEnabled);
  if (presenting) return <PresentationBar />;
  return (
    <>
      {!zen && <TopLeft />}
      {!zen && <TopRight />}
      {!viewMode && <Toolbar />}
      <PropertiesPanel />
      {!zen && <ZoomControls />}
      {!zen && <FooterRight />}
      <Minimap />
      <ViewModeBadge />
      <ZenExit />
      <DialogHost />
    </>
  );
}

export function App() {
  const theme = useCanvasStore((s) => s.appState.theme);
  return (
    <div className={`sb-root ${theme === 'dark' ? 'dark' : ''}`} data-theme={theme}>
      <Canvas />
      <WelcomeScreen />
      <FollowBanner />
      <div className="sb-layer">
        <Chrome />
        <Toasts />
      </div>
      <ContextMenu />
      <ConfirmHost />
      <div id={PORTAL_ID} />
      <IntegrationHost />
    </div>
  );
}
