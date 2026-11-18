// App shell. Composition only — no business logic here. Owned by UI agent (B).
import { Canvas } from '@/components/Canvas/Canvas';

export function App() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas />
    </div>
  );
}
