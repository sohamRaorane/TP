// Decouples modules that change the scene outside of localNonce (load/restore)
// from persistence, without import cycles. persistence registers the handler.
type Handler = () => void;
let handler: Handler | null = null;

export const onSaveRequested = (h: Handler) => {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
};

/** mark the scene as changed so autosave + recovery run */
export const requestSave = () => handler?.();
