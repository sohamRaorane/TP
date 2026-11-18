import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, Group, Link, Lock, LockOpen, Trash, Ungroup,
} from 'lucide-react';
import { actions } from '@/services/actions';
import { selectors, useCanvasStore } from '@/store/canvasStore';
import type {
  Arrowhead, CurrentItemStyle, ElementType, SketchElement, TextElement, ToolType,
} from '@/types/appState';
import {
  ArrowheadIcon, EdgeRoundIcon, EdgeSharpIcon, FillCrossHatchIcon, FillHachureIcon, FillSolidIcon,
  FillZigzagIcon, FontCodeIcon, FontHandIcon, FontNormalIcon, SloppinessIcon, StrokeStyleIcon,
  StrokeWidthIcon, TextAlignIcon,
} from '../icons';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { kbd } from '../ui/portal';
import { useIsNarrow } from '../ui/useMedia';
import { run } from '../run';
import { BG_QUICK, ColorSection, STROKE_QUICK } from './ColorPicker';
import { setElementLink } from './elementOps';

// ---------------------------------------------------------------- capabilities
const ALL: ElementType[] = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame'];
const CAP = {
  stroke: new Set<ElementType>(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text']),
  background: new Set<ElementType>(['rectangle', 'diamond', 'ellipse', 'line', 'freedraw']),
  strokeWidth: new Set<ElementType>(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw']),
  strokeStyle: new Set<ElementType>(['rectangle', 'diamond', 'ellipse', 'arrow', 'line']),
  sloppiness: new Set<ElementType>(['rectangle', 'diamond', 'ellipse', 'arrow', 'line']),
  edges: new Set<ElementType>(['rectangle', 'diamond', 'line', 'arrow']),
  arrowheads: new Set<ElementType>(['arrow']),
  text: new Set<ElementType>(['text']),
  opacity: new Set<ElementType>(ALL),
};
const TOOL_PANEL: Partial<Record<ToolType, ElementType>> = {
  rectangle: 'rectangle', diamond: 'diamond', ellipse: 'ellipse', arrow: 'arrow', line: 'line', freedraw: 'freedraw', text: 'text',
};

type StyleKey = keyof CurrentItemStyle;
interface Resolved<T> { value: T | null; mixed: boolean }

function resolve<K extends StyleKey>(key: K, els: SketchElement[] | null, item: CurrentItemStyle): Resolved<CurrentItemStyle[K]> {
  if (!els) return { value: item[key], mixed: false };
  const vals = new Set<unknown>();
  for (const el of els) if (key in el) vals.add((el as unknown as Record<string, unknown>)[key]);
  if (vals.size === 0) return { value: item[key], mixed: false };
  if (vals.size > 1) return { value: null, mixed: true };
  return { value: [...vals][0] as CurrentItemStyle[K], mixed: false };
}

const setStyle = (changes: Partial<CurrentItemStyle>) => run(() => actions.setStyle(changes));

// ---------------------------------------------------------------- primitives
function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <fieldset className="sb-panel__section" data-testid={testId} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="sb-panel__label" style={{ padding: 0, float: 'left', width: '100%' }}>{title}</legend>
      <div style={{ clear: 'both' }} />
      {children}
    </fieldset>
  );
}

interface Opt<T> { value: T; label: string; icon: ReactNode; shortcut?: string; testId?: string }

function Options<T extends string | number | boolean | null>({ options, value, onChange, name }: { options: Opt<T>[]; value: T | null; onChange: (v: T) => void; name: string }) {
  return (
    <div className="sb-row" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <Tooltip key={String(o.value)} label={o.label} shortcut={o.shortcut}>
          <button
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.label}
            data-testid={o.testId}
            className={`sb-opt ${typeof o.icon === 'string' ? 'sb-opt--text' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function ActionBtn({ label, icon, onClick, shortcut, active, testId }: { label: string; icon: ReactNode; onClick: () => void; shortcut?: string; active?: boolean; testId?: string }) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button type="button" aria-label={label} aria-pressed={active} data-testid={testId} className="sb-opt" onClick={onClick}>
        {icon}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- arrowheads
const HEADS: Array<{ v: Arrowhead; label: string }> = [
  { v: null, label: 'None' }, { v: 'arrow', label: 'Arrow' }, { v: 'triangle', label: 'Triangle' }, { v: 'dot', label: 'Dot' }, { v: 'bar', label: 'Bar' },
];

function ArrowheadPicker({ which, value, mixed }: { which: 'start' | 'end'; value: Arrowhead; mixed: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const key = which === 'start' ? 'startArrowhead' : 'endArrowhead';
  return (
    <>
      <Tooltip label={`${which === 'start' ? 'Start' : 'End'} arrowhead`}>
        <button
          ref={ref}
          type="button"
          aria-label={`${which} arrowhead: ${mixed ? 'mixed' : value ?? 'none'}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid={`arrowhead-${which}`}
          className={`sb-opt ${open ? 'is-active' : ''}`}
          style={{ width: 44 }}
          onClick={() => setOpen((o) => !o)}
        >
          {mixed ? <span style={{ fontSize: 12 }}>—</span> : <ArrowheadIcon kind={value} flip={which === 'start'} />}
        </button>
      </Tooltip>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} side="bottom" align="start" label={`${which} arrowhead`}>
          <div className="sb-row" style={{ padding: 8, width: 5 * 40 }} role="radiogroup" aria-label={`${which} arrowhead`}>
            {HEADS.map((h) => (
              <Tooltip key={String(h.v)} label={h.label}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!mixed && value === h.v}
                  aria-label={h.label}
                  className="sb-opt"
                  style={{ width: 36, height: 36 }}
                  onClick={() => { setStyle({ [key]: h.v }); setOpen(false); }}
                >
                  <ArrowheadIcon kind={h.v} flip={which === 'start'} />
                </button>
              </Tooltip>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------- opacity
function OpacitySlider({ value, mixed, els }: { value: number | null; mixed: boolean; els: SketchElement[] | null }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value ?? 100;
  const commit = () => {
    if (draft === null) return;
    const v = draft;
    setDraft(null);
    setStyle({ opacity: v });
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={shown}
        aria-label="Opacity"
        data-testid="opacity-slider"
        className="sb-range"
        style={{ ['--sb-range-pct' as string]: `${shown}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          // live preview without a history entry; setStyle on release commits
          if (els?.length) useCanvasStore.getState().updateElements(Object.fromEntries(els.map((el) => [el.id, { opacity: v }])));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span style={{ font: '500 12px/1 var(--ui-font)', color: 'var(--color-muted)', width: 30, textAlign: 'right' }}>
        {mixed && draft === null ? '—' : shown}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- link
function LinkButton({ els }: { els: SketchElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = els.length === 1 ? els[0].link ?? '' : '';
  const [draft, setDraft] = useState(current);
  return (
    <>
      <Tooltip label="Link" shortcut={kbd('Ctrl+K')}>
        <button ref={ref} type="button" className={`sb-opt ${open || current ? 'is-active' : ''}`} aria-label="Edit link" data-testid="action-link" onClick={() => { setDraft(current); setOpen((o) => !o); }}>
          <Link size={16} />
        </button>
      </Tooltip>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} side="bottom" align="start" label="Edit link">
          <form
            className="flex items-center gap-1.5"
            style={{ padding: 8, width: 280 }}
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
              run(() => setElementLink(els.map((el) => el.id), draft.trim() || null));
            }}
          >
            <input autoFocus className="sb-input sb-input--sm" placeholder="Type or paste a link" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Link URL" />
            <button type="submit" className="sb-btn sb-btn--primary sb-btn--sm">Save</button>
          </form>
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------- panel
const panelVisibleSelector = (s: ReturnType<typeof useCanvasStore.getState>) => {
  const a = s.appState;
  if (a.viewModeEnabled || a.zenMode || a.presentation.active) return false;
  return Object.keys(a.selectedElementIds).length > 0 || !!TOOL_PANEL[a.activeTool];
};

export function PropertiesPanel() {
  const visible = useCanvasStore(panelVisibleSelector);
  if (!visible) return null;
  return <PanelBody />;
}

const PanelBody = memo(function PanelBody() {
  const selected = useCanvasStore(useShallow(selectors.selectedElements));
  const activeTool = useCanvasStore((s) => s.appState.activeTool);
  const item = useCanvasStore((s) => s.appState.currentItem);
  const narrow = useIsNarrow();

  const mode: 'selection' | 'tool' = selected.length ? 'selection' : 'tool';
  const els = mode === 'selection' ? selected : null;

  // Containers with a bound text label expose font controls for that label.
  const textEls = useMemo<TextElement[]>(() => {
    if (!els) return [];
    const byId = useCanvasStore.getState().elementsById;
    const out: TextElement[] = [];
    for (const el of els) {
      if (el.type === 'text') out.push(el);
      for (const b of el.boundElements) {
        const t = byId[b.id];
        if (b.type === 'text' && t && t.type === 'text' && !t.isDeleted) out.push(t);
      }
    }
    return out;
  }, [els]);

  const types = useMemo(() => {
    const t = new Set<ElementType>();
    if (els) els.forEach((e) => t.add(e.type));
    else if (TOOL_PANEL[activeTool]) t.add(TOOL_PANEL[activeTool]!);
    if (textEls.length) t.add('text');
    return t;
  }, [els, activeTool, textEls]);

  const has = (cap: Set<ElementType>) => [...types].some((t) => cap.has(t));
  const r = <K extends StyleKey>(k: K, cap: Set<ElementType>, src: SketchElement[] | null = els) =>
    resolve(k, src ? src.filter((e) => cap.has(e.type)) : null, item);

  const stroke = r('strokeColor', CAP.stroke);
  const bg = r('backgroundColor', CAP.background);
  const fill = r('fillStyle', CAP.background);
  const sw = r('strokeWidth', CAP.strokeWidth);
  const ss = r('strokeStyle', CAP.strokeStyle);
  const rough = r('roughness', CAP.sloppiness);
  const round = r('roundness', CAP.edges);
  const startHead = r('startArrowhead', CAP.arrowheads);
  const endHead = r('endArrowhead', CAP.arrowheads);
  const fontSize = resolve('fontSize', els ? textEls : null, item);
  const fontFamily = resolve('fontFamily', els ? textEls : null, item);
  const textAlign = resolve('textAlign', els ? textEls : null, item);
  const opacity = r('opacity', CAP.opacity);

  const hasBgColor = bg.mixed || (bg.value !== null && bg.value !== 'transparent');
  const allLocked = !!els?.length && els.every((e) => e.locked);
  const groupable = !!els && els.length > 1 && !(() => {
    const outer = els.map((e) => e.groupIds[e.groupIds.length - 1]);
    return outer[0] !== undefined && outer.every((g) => g === outer[0]);
  })();
  const ungroupable = !!els?.some((e) => e.groupIds.length > 0);

  return (
    <div className="sb-props-wrap sb-pe" data-testid="properties-panel">
      <section
        aria-label={mode === 'selection' ? 'Selected element properties' : 'Default style for new elements'}
        className="sb-island sb-panel sb-scroll"
        style={narrow ? undefined : { maxHeight: 'calc(100vh - 150px)' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="sb-panel__grid">
          {has(CAP.stroke) && (
            <Section title="Stroke" testId="section-stroke">
              <ColorSection title="Stroke" quick={STROKE_QUICK} value={stroke.value} mixed={stroke.mixed} allowTransparent={false} testId="stroke-color" onChange={(c) => setStyle({ strokeColor: c })} />
            </Section>
          )}
          {has(CAP.background) && (
            <Section title="Background" testId="section-background">
              <ColorSection title="Background" quick={BG_QUICK} value={bg.value} mixed={bg.mixed} allowTransparent testId="background-color" onChange={(c) => setStyle({ backgroundColor: c })} />
            </Section>
          )}
          {has(CAP.background) && hasBgColor && (
            <Section title="Fill" testId="section-fill">
              <Options
                name="Fill"
                value={fill.value}
                onChange={(v) => setStyle({ fillStyle: v })}
                options={[
                  { value: 'hachure', label: 'Hachure', icon: <FillHachureIcon />, testId: 'fill-hachure' },
                  { value: 'cross-hatch', label: 'Cross-hatch', icon: <FillCrossHatchIcon />, testId: 'fill-cross-hatch' },
                  { value: 'solid', label: 'Solid', icon: <FillSolidIcon />, testId: 'fill-solid' },
                  { value: 'zigzag', label: 'Zigzag', icon: <FillZigzagIcon />, testId: 'fill-zigzag' },
                ]}
              />
            </Section>
          )}
          {has(CAP.strokeWidth) && (
            <Section title="Stroke width" testId="section-stroke-width">
              <Options
                name="Stroke width"
                value={sw.value}
                onChange={(v) => setStyle({ strokeWidth: v })}
                options={[
                  { value: 1, label: 'Thin', icon: <StrokeWidthIcon w={1.2} />, testId: 'stroke-width-thin' },
                  { value: 2, label: 'Bold', icon: <StrokeWidthIcon w={2.4} />, testId: 'stroke-width-bold' },
                  { value: 4, label: 'Extra bold', icon: <StrokeWidthIcon w={4} />, testId: 'stroke-width-extra' },
                ]}
              />
            </Section>
          )}
          {has(CAP.strokeStyle) && (
            <Section title="Stroke style" testId="section-stroke-style">
              <Options
                name="Stroke style"
                value={ss.value}
                onChange={(v) => setStyle({ strokeStyle: v })}
                options={[
                  { value: 'solid', label: 'Solid', icon: <StrokeStyleIcon kind="solid" /> },
                  { value: 'dashed', label: 'Dashed', icon: <StrokeStyleIcon kind="dashed" /> },
                  { value: 'dotted', label: 'Dotted', icon: <StrokeStyleIcon kind="dotted" /> },
                ]}
              />
            </Section>
          )}
          {has(CAP.sloppiness) && (
            <Section title="Sloppiness" testId="section-sloppiness">
              <Options
                name="Sloppiness"
                value={rough.value}
                onChange={(v) => setStyle({ roughness: v })}
                options={[
                  { value: 0, label: 'Architect', icon: <SloppinessIcon level={0} /> },
                  { value: 1, label: 'Artist', icon: <SloppinessIcon level={1} /> },
                  { value: 2, label: 'Cartoonist', icon: <SloppinessIcon level={2} /> },
                ]}
              />
            </Section>
          )}
          {has(CAP.edges) && (
            <Section title={types.has('arrow') && types.size === 1 ? 'Arrow type' : 'Edges'} testId="section-edges">
              <Options
                name="Edges"
                value={round.value}
                onChange={(v) => setStyle({ roundness: v })}
                options={[
                  { value: false, label: types.has('arrow') && types.size === 1 ? 'Sharp' : 'Sharp', icon: <EdgeSharpIcon /> },
                  { value: true, label: types.has('arrow') && types.size === 1 ? 'Curved' : 'Round', icon: <EdgeRoundIcon /> },
                ]}
              />
            </Section>
          )}
          {has(CAP.arrowheads) && (
            <Section title="Arrowheads" testId="section-arrowheads">
              <div className="sb-row">
                <ArrowheadPicker which="start" value={startHead.value ?? null} mixed={startHead.mixed} />
                <ArrowheadPicker which="end" value={endHead.value ?? null} mixed={endHead.mixed} />
              </div>
            </Section>
          )}
          {has(CAP.text) && (
            <>
              <Section title="Font size" testId="section-font-size">
                <Options
                  name="Font size"
                  value={fontSize.value}
                  onChange={(v) => setStyle({ fontSize: v })}
                  options={[
                    { value: 16, label: 'Small', icon: 'S' },
                    { value: 20, label: 'Medium', icon: 'M' },
                    { value: 28, label: 'Large', icon: 'L' },
                    { value: 36, label: 'Extra large', icon: 'XL' },
                  ]}
                />
              </Section>
              <Section title="Font family" testId="section-font-family">
                <Options
                  name="Font family"
                  value={fontFamily.value}
                  onChange={(v) => setStyle({ fontFamily: v })}
                  options={[
                    { value: 1, label: 'Hand-drawn', icon: <FontHandIcon /> },
                    { value: 2, label: 'Normal', icon: <FontNormalIcon /> },
                    { value: 3, label: 'Code', icon: <FontCodeIcon /> },
                  ]}
                />
              </Section>
              <Section title="Text align" testId="section-text-align">
                <Options
                  name="Text align"
                  value={textAlign.value}
                  onChange={(v) => setStyle({ textAlign: v })}
                  options={[
                    { value: 'left', label: 'Left', icon: <TextAlignIcon align="left" /> },
                    { value: 'center', label: 'Center', icon: <TextAlignIcon align="center" /> },
                    { value: 'right', label: 'Right', icon: <TextAlignIcon align="right" /> },
                  ]}
                />
              </Section>
            </>
          )}
          <Section title="Opacity" testId="section-opacity">
            <OpacitySlider value={opacity.value} mixed={opacity.mixed} els={els} />
          </Section>
          {els && (
            <Section title="Layers" testId="section-layers">
              <div className="sb-row">
                <ActionBtn label="Send to back" shortcut={kbd('Ctrl+Shift+[')} icon={<ArrowDownToLine size={16} />} onClick={() => run(() => actions.sendToBack())} testId="layer-back" />
                <ActionBtn label="Send backward" shortcut={kbd('Ctrl+[')} icon={<ArrowDown size={16} />} onClick={() => run(() => actions.sendBackward())} testId="layer-backward" />
                <ActionBtn label="Bring forward" shortcut={kbd('Ctrl+]')} icon={<ArrowUp size={16} />} onClick={() => run(() => actions.bringForward())} testId="layer-forward" />
                <ActionBtn label="Bring to front" shortcut={kbd('Ctrl+Shift+]')} icon={<ArrowUpToLine size={16} />} onClick={() => run(() => actions.bringToFront())} testId="layer-front" />
              </div>
            </Section>
          )}
          {els && els.length > 1 && (
            <Section title="Align" testId="section-align">
              <div className="sb-row">
                <ActionBtn label="Align left" shortcut={kbd('Ctrl+Shift+←')} icon={<AlignStartVertical size={16} />} onClick={() => run(() => actions.align('left'))} />
                <ActionBtn label="Center horizontally" icon={<AlignCenterVertical size={16} />} onClick={() => run(() => actions.align('centerX'))} />
                <ActionBtn label="Align right" shortcut={kbd('Ctrl+Shift+→')} icon={<AlignEndVertical size={16} />} onClick={() => run(() => actions.align('right'))} />
                {els.length > 2 && (
                  <ActionBtn label="Distribute horizontally" shortcut={kbd('Alt+H')} icon={<AlignHorizontalDistributeCenter size={16} />} onClick={() => run(() => actions.distribute('horizontal'))} />
                )}
                <ActionBtn label="Align top" shortcut={kbd('Ctrl+Shift+↑')} icon={<AlignStartHorizontal size={16} />} onClick={() => run(() => actions.align('top'))} />
                <ActionBtn label="Center vertically" icon={<AlignCenterHorizontal size={16} />} onClick={() => run(() => actions.align('centerY'))} />
                <ActionBtn label="Align bottom" shortcut={kbd('Ctrl+Shift+↓')} icon={<AlignEndHorizontal size={16} />} onClick={() => run(() => actions.align('bottom'))} />
                {els.length > 2 && (
                  <ActionBtn label="Distribute vertically" shortcut={kbd('Alt+V')} icon={<AlignVerticalDistributeCenter size={16} />} onClick={() => run(() => actions.distribute('vertical'))} />
                )}
              </div>
            </Section>
          )}
          {els && (
            <Section title="Actions" testId="section-actions">
              <div className="sb-row">
                <ActionBtn label="Duplicate" shortcut={kbd('Ctrl+D')} icon={<Copy size={16} />} onClick={() => run(() => actions.duplicateSelected())} testId="action-duplicate" />
                <ActionBtn label="Delete" shortcut="Delete" icon={<Trash size={16} />} onClick={() => run(() => actions.deleteSelected())} testId="action-delete" />
                <ActionBtn label={allLocked ? 'Unlock' : 'Lock'} shortcut={kbd('Ctrl+Shift+L')} active={allLocked} icon={allLocked ? <Lock size={16} /> : <LockOpen size={16} />} onClick={() => run(() => actions.toggleLock())} testId="action-lock" />
                {groupable && <ActionBtn label="Group selection" shortcut={kbd('Ctrl+G')} icon={<Group size={16} />} onClick={() => run(() => actions.group())} testId="action-group" />}
                {ungroupable && <ActionBtn label="Ungroup selection" shortcut={kbd('Ctrl+Shift+G')} icon={<Ungroup size={16} />} onClick={() => run(() => actions.ungroup())} testId="action-ungroup" />}
                <LinkButton els={els} />
              </div>
            </Section>
          )}
        </div>
      </section>
    </div>
  );
});
