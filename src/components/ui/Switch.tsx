import { useId } from 'react';

/** Labeled toggle switch (role=switch). */
export function Switch({ label, checked, onChange, testId, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4" style={{ minHeight: 36 }}>
      <label htmlFor={id} style={{ font: '500 14px/1.3 var(--ui-font)', cursor: 'pointer' }}>
        {label}
        {hint && <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-muted)' }}>{hint}</div>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', width: 36, height: 20, borderRadius: 10, border: 0, padding: 0, cursor: 'pointer', flex: '0 0 auto',
          background: checked ? 'var(--color-primary)' : 'var(--color-border-strong)', transition: 'background .15s',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: 8,
            background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s',
          }}
        />
      </button>
    </div>
  );
}
