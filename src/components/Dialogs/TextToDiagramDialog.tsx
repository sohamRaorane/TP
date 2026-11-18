import { useState } from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { loadOptional, PATHS, type TextToDiagramModule } from '../integration';
import { closeDialog } from '../commands';
import { errorMessage, toast } from '../run';

const EXAMPLE = `A[Start] --> B{Is it working?}
B -->|Yes| C[Ship it]
B -->|No| D[Debug]
D --> B`;

export function TextToDiagramDialog() {
  const [text, setText] = useState(EXAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const insert = async () => {
    setBusy(true);
    setError(null);
    try {
      const mod = await loadOptional<TextToDiagramModule>(PATHS.textToDiagram);
      if (!mod) throw new Error('Text to diagram is not available yet');
      await mod.insertDiagramFromText(text);
      closeDialog();
      toast('Diagram inserted', 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Text to diagram"
      onClose={closeDialog}
      width={720}
      testId="text-to-diagram-dialog"
      initialFocus="textarea"
      footer={
        <>
          <button type="button" className="sb-btn sb-btn--outline" onClick={closeDialog}>Cancel</button>
          <button type="button" className="sb-btn sb-btn--primary" disabled={busy || !text.trim()} onClick={insert} data-testid="text-to-diagram-insert">
            <Sparkles size={16} /> {busy ? 'Inserting…' : 'Insert'}
          </button>
        </>
      }
    >
      <div className="sb-dialog__body flex flex-col gap-3">
        <p style={{ margin: 0, font: '400 14px/1.5 var(--ui-font)', color: 'var(--color-muted)' }}>
          Describe a flowchart using a Mermaid-like syntax. Nodes: <code>A[Box]</code>, <code>B{'{Decision}'}</code>, <code>C(Rounded)</code>, <code>D((Circle))</code>.
          Edges: <code>--&gt;</code>, <code>---</code>, <code>-.-&gt;</code>, labels with <code>-- text --&gt;</code> or <code>--&gt;|text|</code>.
        </p>
        <textarea
          className="sb-input"
          rows={10}
          spellCheck={false}
          aria-label="Diagram definition"
          aria-invalid={!!error}
          aria-describedby={error ? 'sb-t2d-error' : undefined}
          data-testid="text-to-diagram-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void insert(); } }}
        />
        {error && (
          <div id="sb-t2d-error" role="alert" className="flex items-start gap-2" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--color-danger-bg)', color: 'var(--color-danger-strong)', font: '500 13px/1.4 var(--ui-font)' }}>
            <AlertCircle size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>
          </div>
        )}
        <span style={{ font: '400 12px var(--ui-font)', color: 'var(--color-muted-2)' }}>Tip: press Ctrl+Enter to insert.</span>
      </div>
    </Dialog>
  );
}
