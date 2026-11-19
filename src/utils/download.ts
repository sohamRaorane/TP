// Trigger a browser download for a Blob (anchor + object URL).
export const sanitizeFileName = (name: string) =>
  (name.trim() || 'Untitled drawing').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120);

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the click has been handled
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
