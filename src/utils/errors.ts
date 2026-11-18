// Turn any thrown value into a short, human-readable message.
export const errorMessage = (e: unknown, fallback = 'Something went wrong'): string => {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string')
    return (e as { message: string }).message;
  return fallback;
};
