import type { z } from 'zod';
import { HttpError } from '../services/errors';

/** Compact, client-friendly zod issues. */
export const formatIssues = (error: z.ZodError) =>
  error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));

/** Parses `value` with `schema` or throws a 400 HttpError with the issues as details. */
export function parseOr400<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, `Invalid ${what}`, formatIssues(result.error));
  return result.data;
}
