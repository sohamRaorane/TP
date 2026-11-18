// Tool registry. One instance per tool type (tools keep in-progress state).
import type { ToolType } from '@/types/appState';
import type { Tool } from './types';
import { SelectionTool } from './selection/SelectionTool';
import { HandTool } from './hand/HandTool';
import { createRectangleTool } from './rectangle/RectangleTool';
import { createDiamondTool } from './diamond/DiamondTool';
import { createEllipseTool } from './ellipse/EllipseTool';
import { createFrameTool } from './frame/FrameTool';
import { createArrowTool } from './arrow/ArrowTool';
import { createLineTool } from './line/LineTool';
import { FreedrawTool } from './freedraw/FreedrawTool';
import { TextTool } from './text/TextTool';
import { ImageTool } from './image/ImageTool';
import { EraserTool } from './eraser/EraserTool';
import { LaserTool } from './laser/LaserTool';

const factories: Record<ToolType, () => Tool> = {
  selection: () => new SelectionTool(),
  hand: () => new HandTool(),
  rectangle: createRectangleTool,
  diamond: createDiamondTool,
  ellipse: createEllipseTool,
  frame: createFrameTool,
  arrow: createArrowTool,
  line: createLineTool,
  freedraw: () => new FreedrawTool(),
  text: () => new TextTool(),
  image: () => new ImageTool(),
  eraser: () => new EraserTool(),
  laser: () => new LaserTool(),
};

const instances = new Map<ToolType, Tool>();

export function getTool(type: ToolType): Tool {
  let t = instances.get(type);
  if (!t) {
    t = (factories[type] ?? factories.selection)();
    instances.set(type, t);
  }
  return t;
}

/** tools that stay active after drawing */
export const STICKY_TOOLS: ToolType[] = ['hand', 'freedraw', 'eraser', 'laser'];
