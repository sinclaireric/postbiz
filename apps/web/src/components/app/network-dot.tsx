import { networkById } from '@/lib/networks';

export function NetworkDot({ id, size = 10 }: { id: string; size?: number }) {
  const n = networkById(id);
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: n?.color ?? '#999' }} title={n?.name} aria-hidden="true" />;
}

export function NetworkLabel({ id }: { id: string }) {
  const n = networkById(id);
  return (
    <span className="inline-flex items-center gap-1.5">
      <NetworkDot id={id} />
      <span>{n?.name ?? id}</span>
    </span>
  );
}
