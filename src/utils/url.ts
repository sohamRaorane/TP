// URL state: ?room=<id> for collaboration, #drawing=<id> for a saved drawing.
export const getUrlState = (loc: Pick<Location, 'search' | 'hash'> = window.location) => {
  const room = new URLSearchParams(loc.search).get('room');
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ''));
  return { room: room || null, drawing: hash.get('drawing') || null };
};

export const setUrlDrawing = (id: string | null) => {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  url.hash = id ? `drawing=${encodeURIComponent(id)}` : '';
  window.history.replaceState(null, '', url.toString());
};

export const setUrlRoom = (roomId: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  url.hash = '';
  window.history.replaceState(null, '', url.toString());
};

export const roomShareUrl = (roomId: string) => `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
