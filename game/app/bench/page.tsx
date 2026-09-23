import { notFound } from 'next/navigation';
import DungeonBench from '../dungeon-bench';

// Dev-only, same pattern as the dev-only console hooks in dungeon-game.tsx (~1827): the bundler inlines
// NODE_ENV, so a production build's router never reaches DungeonBench at all - this whole module is
// reachable only from a request handler that first evaluates the check below, and `vinext build` treats a
// `notFound()` route exactly like one that was never registered. See plan 012 Stage C: `npm run build`
// reports the route as absent from the production manifest, not merely hidden.
export default function BenchPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DungeonBench />;
}
