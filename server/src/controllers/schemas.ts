import { z } from 'zod';
import { sceneDataSchema } from '../../../shared/schema';

/** Ids are uuids in practice; accept any url/file-safe token. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid id');

export const idParams = z.object({ id: idSchema });
export const versionParams = z.object({ id: idSchema, versionId: idSchema });

export const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const nameSchema = z.string().trim().min(1).max(200);
const thumbnailSchema = z
  .string()
  .max(2_000_000)
  .regex(/^data:image\//, 'Thumbnail must be an image data URL')
  .nullable();

export const createDrawingSchema = z.object({
  name: nameSchema.optional(),
  data: sceneDataSchema.optional(),
  thumbnail: thumbnailSchema.optional(),
});

export const updateDrawingSchema = createDrawingSchema.extend({
  baseRevision: z.number().int().nonnegative().optional(),
});

export const shareSchema = z.object({ mode: z.enum(['edit', 'view']) });
