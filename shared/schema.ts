// Zod validation for anything crossing a trust boundary:
// JSON import, REST payloads, socket messages.
import { z } from 'zod';

const point = z.tuple([z.number().finite(), z.number().finite()]);
const arrowhead = z.enum(['arrow', 'triangle', 'dot', 'bar']).nullable();
const binding = z
  .object({ elementId: z.string(), focus: z.number().finite(), gap: z.number().finite() })
  .nullable();

const base = {
  id: z.string().min(1).max(100),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  angle: z.number().finite(),
  strokeColor: z.string().max(64),
  backgroundColor: z.string().max(64),
  fillStyle: z.enum(['hachure', 'cross-hatch', 'solid', 'zigzag']),
  strokeWidth: z.number().positive().max(100),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']),
  roughness: z.number().min(0).max(5),
  opacity: z.number().min(0).max(100),
  roundness: z.boolean(),
  locked: z.boolean(),
  groupIds: z.array(z.string()),
  frameId: z.string().nullable(),
  index: z.string().max(500).optional(),
  boundElements: z.array(z.object({ id: z.string(), type: z.enum(['arrow', 'text']) })),
  link: z.string().max(2000).nullable(),
  seed: z.number().int(),
  version: z.number().int().nonnegative(),
  versionNonce: z.number().int(),
  isDeleted: z.boolean(),
  updated: z.number(),
};

export const genericElementSchema = z.object({
  ...base,
  type: z.enum(['rectangle', 'diamond', 'ellipse']),
});
export const linearElementSchema = z.object({
  ...base,
  type: z.enum(['arrow', 'line']),
  points: z.array(point).min(1).max(10_000),
  startArrowhead: arrowhead,
  endArrowhead: arrowhead,
  startBinding: binding,
  endBinding: binding,
});
export const freedrawElementSchema = z.object({
  ...base,
  type: z.literal('freedraw'),
  points: z.array(point).min(1).max(50_000),
  pressures: z.array(z.number()),
  simulatePressure: z.boolean(),
});
export const textElementSchema = z.object({
  ...base,
  type: z.literal('text'),
  text: z.string().max(100_000),
  fontSize: z.number().positive().max(1000),
  fontFamily: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  textAlign: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  containerId: z.string().nullable(),
  lineHeight: z.number().positive(),
});
export const imageElementSchema = z.object({
  ...base,
  type: z.literal('image'),
  fileId: z.string(),
  status: z.enum(['pending', 'saved', 'error']),
  scale: z.tuple([z.number(), z.number()]),
});
export const frameElementSchema = z.object({
  ...base,
  type: z.literal('frame'),
  name: z.string().max(200),
});

export const elementSchema = z.discriminatedUnion('type', [
  genericElementSchema,
  linearElementSchema,
  freedrawElementSchema,
  textElementSchema,
  imageElementSchema,
  frameElementSchema,
]);

export const binaryFileSchema = z.object({
  id: z.string(),
  mimeType: z.string().regex(/^image\//),
  dataURL: z.string().startsWith('data:image/'),
  created: z.number(),
});

export const sceneDataSchema = z.object({
  type: z.literal('sketchboard'),
  version: z.literal(1),
  source: z.string().optional(),
  elements: z.array(elementSchema).max(100_000),
  appState: z
    .object({
      viewBackgroundColor: z.string().optional(),
      gridEnabled: z.boolean().optional(),
      theme: z.enum(['light', 'dark']).optional(),
      name: z.string().optional(),
    })
    .default({}),
  files: z.record(z.string(), binaryFileSchema).default({}),
});

export type SceneDataInput = z.input<typeof sceneDataSchema>;
