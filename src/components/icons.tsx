// Small custom icons for property controls (Excalidraw-like line art).
import type { ReactNode, SVGProps } from 'react';
import type { Arrowhead } from '@/types/appState';

type P = SVGProps<SVGSVGElement> & { size?: number };

const Svg = ({ size = 18, children, ...rest }: P & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    {...rest}
  >
    {children}
  </svg>
);

const clipBox = 'M4 4h12v12H4z';

export const FillHachureIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />
    <path d="M4 10.5 10.5 4M4 15.5 15.5 4M8.5 16 16 8.5" strokeWidth={1.1} />
  </Svg>
);
export const FillCrossHatchIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />
    <path d="M4 10.5 10.5 4M4 15.5 15.5 4M8.5 16 16 8.5M9.5 4 16 10.5M4 4.5 15.5 16M4 9.5 10.5 16" strokeWidth={1.1} />
  </Svg>
);
export const FillSolidIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" fill="currentColor" />
  </Svg>
);
export const FillZigzagIcon = (p: P) => (
  <Svg {...p}>
    <defs>
      <clipPath id="sb-zz"><path d={clipBox} /></clipPath>
    </defs>
    <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />
    <path clipPath="url(#sb-zz)" d="M3 7l2.5 2 2.5-2 2.5 2 2.5-2 2.5 2 2.5-2M3 12l2.5 2 2.5-2 2.5 2 2.5-2 2.5 2 2.5-2" strokeWidth={1.1} />
  </Svg>
);

export const StrokeWidthIcon = ({ w, ...p }: P & { w: number }) => (
  <Svg {...p}>
    <path d="M3.5 10h13" strokeWidth={w} />
  </Svg>
);

export const StrokeStyleIcon = ({ kind, ...p }: P & { kind: 'solid' | 'dashed' | 'dotted' }) => (
  <Svg {...p}>
    <path
      d="M3.5 10h13"
      strokeWidth={2}
      strokeDasharray={kind === 'dashed' ? '4 3' : kind === 'dotted' ? '0.1 3.2' : undefined}
    />
  </Svg>
);

export const SloppinessIcon = ({ level, ...p }: P & { level: 0 | 1 | 2 }) => (
  <Svg {...p}>
    {level === 0 && <path d="M3 14c2.5-1 4.5-6 7-6s4.5 4 7 3" />}
    {level === 1 && <path d="M3 14c1.6-1.2 3-5.7 5-6.2 2.3-.6 3 3.6 5 3.8 1.2.1 2.4-.9 4-2.2M4 15c2.2-2.1 3.1-6 5.6-6.4" />}
    {level === 2 && (
      <path d="M3 15c1-2.4 2.6-7.4 4.6-7.6 2.1-.2 1.4 5.7 3.6 5.6 2-.1 2.2-3.8 5.8-4.4M3.6 12.6c1.6-1.8 2.7-6 4.6-5.5M10.8 13.6c1.2 1 3.3-2.6 5.6-3" />
    )}
  </Svg>
);

export const EdgeSharpIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 16V4h12" strokeDasharray="0" />
    <path d="M9 16h0M16 9v0" />
  </Svg>
);
export const EdgeRoundIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 16V9a5 5 0 0 1 5-5h7" />
  </Svg>
);

export const ArrowheadIcon = ({ kind, flip, ...p }: P & { kind: Arrowhead; flip?: boolean }) => (
  <Svg {...p} size={p.size ?? 22} style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d={kind === null ? 'M2.5 10h15' : 'M2.5 10h12'} strokeWidth={1.6} />
    {kind === 'arrow' && <path d="M12.5 6.5 17 10l-4.5 3.5" strokeWidth={1.6} />}
    {kind === 'triangle' && <path d="M12.5 6.5 17.5 10l-5 3.5z" fill="currentColor" strokeWidth={1.2} />}
    {kind === 'dot' && <circle cx="15" cy="10" r="2.6" fill="currentColor" strokeWidth={1} />}
    {kind === 'bar' && <path d="M15.5 5.5v9" strokeWidth={1.8} />}
  </Svg>
);

export const TextAlignIcon = ({ align, ...p }: P & { align: 'left' | 'center' | 'right' }) => {
  const rows: Array<[number, number]> =
    align === 'left' ? [[4, 16], [4, 12], [4, 14]] : align === 'right' ? [[4, 16], [8, 16], [6, 16]] : [[4, 16], [6, 14], [5, 15]];
  return (
    <Svg {...p}>
      {rows.map(([a, b], i) => <path key={i} d={`M${a} ${6 + i * 4}h${b - a}`} strokeWidth={1.6} />)}
    </Svg>
  );
};

export const FontHandIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 15.5c1.5-4 3.4-9.6 4.7-11 .6-.6 1.2-.2 1 .7-.5 2.6-2.3 6.8-2.5 9.4-.1 1.3.8 1.4 1.6.6 1-1 2.3-3.1 3.2-3.3.8-.2.4 1.6.9 2 .6.5 1.6-.4 2.3-1" />
  </Svg>
);
export const FontNormalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 15 10 4l5 11M7 11h6" strokeWidth={1.6} />
  </Svg>
);
export const FontCodeIcon = (p: P) => (
  <Svg {...p}>
    <path d="m7 6-4 4 4 4M13 6l4 4-4 4" strokeWidth={1.6} />
  </Svg>
);

/** Sketchboard logo: a pencil drawing a squiggle. Original artwork. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M3.5 24.5c2.6-3.2 4.6-3.6 6-1.8 1.5 1.9 3.2 1.6 5.4-1.1"
        stroke="var(--color-primary)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.6 18.4 26.4 9.6a2.4 2.4 0 0 0-3.4-3.4l-8.8 8.8-1.3 4.7z" fill="var(--color-primary)" opacity="0.18" />
      <path
        d="M17.6 18.4 26.4 9.6a2.4 2.4 0 0 0-3.4-3.4l-8.8 8.8-1.3 4.7zM21.4 7.8l3.4 3.4"
        stroke="var(--color-primary)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
