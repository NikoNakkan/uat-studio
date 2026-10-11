import { Link } from 'react-router';
import type { Interaction } from '../../api';
import { useRail } from './RailState';

/** "1 waiting for you": goes to the page the question belongs to, opens the live panel and scrolls to it. */
export function WaitingLink({ open, compact = false }: { open: Interaction[]; compact?: boolean }) {
  const { revealQuestion } = useRail();
  const first = open[0];
  return (
    <Link to={first.channel === 'app' ? '/setup' : `/runs/${first.channel}`} onClick={revealQuestion} title={`${open.length} waiting for you`}
      className="rounded bg-accent px-2 py-1 font-semibold text-accent-ink hover:brightness-95">
      {open.length}<span className={compact ? 'md:sr-only' : ''}> waiting for you →</span></Link>
  );
}
