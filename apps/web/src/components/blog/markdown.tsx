import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Align, Block, CalloutKind, Inline } from '@/lib/blog/markdown';

export type CalloutLabels = Record<CalloutKind, string>;

const CALLOUT_STYLE: Record<CalloutKind, string> = {
  tip: 'border-lime bg-lime-soft text-forest',
  note: 'border-line bg-wash text-ink',
  warning: 'border-warn/40 bg-warn-soft text-warn',
};

const ALIGN: Record<Exclude<Align, null>, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

function Inlines({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.text;
      case 'strong':
        return <strong key={i} className="font-semibold text-ink"><Inlines nodes={n.children} /></strong>;
      case 'em':
        return <em key={i}><Inlines nodes={n.children} /></em>;
      case 'code':
        return <code key={i} dir="ltr" className="rounded-md bg-wash px-1.5 py-0.5 font-mono text-[0.88em] text-ink">{n.text}</code>;
      case 'link': {
        const cls = 'font-medium text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:decoration-ink';
        if (n.href.startsWith('/') || n.href.startsWith('#')) return <Link key={i} href={n.href} className={cls}><Inlines nodes={n.children} /></Link>;
        return <a key={i} href={n.href} rel="noopener noreferrer" className={cls}><Inlines nodes={n.children} /></a>;
      }
    }
  });
}

function Blocks({ blocks, labels }: { blocks: Block[]; labels: CalloutLabels }): ReactNode {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'heading': {
        const props = { id: b.id, children: <Inlines nodes={b.children} /> };
        if (b.level === 2) return <h2 key={i} {...props} className="mt-12 mb-6 scroll-mt-24 text-2xl leading-8 font-bold tracking-[-0.02em]" />;
        if (b.level === 3) return <h3 key={i} {...props} className="mt-8 mb-3 scroll-mt-24 text-xl leading-8 font-semibold tracking-[-0.01em]" />;
        return <h4 key={i} {...props} className="mt-6 mb-2 scroll-mt-24 text-base leading-7 font-semibold" />;
      }
      case 'paragraph':
        return <p key={i} className="my-5 text-base leading-7 text-ink/85"><Inlines nodes={b.children} /></p>;
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag key={i} className={`my-5 grid gap-2.5 ps-6 text-base leading-7 text-ink/85 marker:text-ink/40 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
            {b.items.map((item, j) => (
              <li key={j} className="ps-1">
                <Inlines nodes={item.children} />
                {item.blocks.length > 0 && <div className="[&>*:first-child]:mt-2 [&>*:last-child]:mb-0 [&>ol]:my-2 [&>p]:my-2 [&>ul]:my-2"><Blocks blocks={item.blocks} labels={labels} /></div>}
              </li>
            ))}
          </Tag>
        );
      }
      case 'quote':
        return (
          <blockquote key={i} className="my-7 border-s-4 border-lime ps-5 text-lg text-ink/80 [&>p]:my-2">
            <Blocks blocks={b.children} labels={labels} />
          </blockquote>
        );
      case 'callout':
        return (
          <aside key={i} className={`my-7 rounded-xl border-s-4 px-5 py-4 ${CALLOUT_STYLE[b.kind]}`}>
            <p className="text-xs font-bold tracking-[0.14em] uppercase">{labels[b.kind]}</p>
            <div className="[&>p]:my-2 [&>p]:text-inherit [&>p:first-child]:mt-2 [&>p:last-child]:mb-0 [&_a]:text-inherit [&_strong]:text-inherit"><Blocks blocks={b.children} labels={labels} /></div>
          </aside>
        );
      case 'code':
        return (
          <pre key={i} dir="ltr" className="my-6 overflow-x-auto rounded-xl bg-ink p-4 text-sm leading-6 text-white/90">
            <code className="font-mono">{b.text}</code>
          </pre>
        );
      case 'table':
        return (
          <div key={i} className="my-7 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {b.head.map((cell, c) => (
                    <th key={c} scope="col" className={`border-b border-line bg-wash px-4 py-2.5 font-semibold ${b.align[c] ? ALIGN[b.align[c]!] : 'text-start'}`}><Inlines nodes={cell} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r} className="[&:last-child>td]:border-b-0">
                    {row.map((cell, c) => (
                      <td key={c} className={`border-b border-line px-4 py-2.5 align-top text-ink/85 ${b.align[c] ? ALIGN[b.align[c]!] : 'text-start'}`}><Inlines nodes={cell} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'image':
        return (
          <figure key={i} className="my-8">
            {/* eslint-disable-next-line @next/next/no-img-element -- taille inconnue à l'écriture de l'article */}
            <img src={b.src} alt={b.alt} loading="lazy" decoding="async" className="w-full rounded-lg border border-line" />
            {b.alt && <figcaption className="mt-2 text-center text-sm text-subtle">{b.alt}</figcaption>}
          </figure>
        );
      case 'hr':
        return <hr key={i} className="my-10 border-0 border-t border-dashed border-line" />;
    }
  });
}

/** Corps d'un article. Rendu en éléments React à partir de l'arbre Markdown : jamais de HTML brut. */
export function ArticleBody({ blocks, labels }: { blocks: Block[]; labels: CalloutLabels }) {
  return (
    <div className="[&>*:first-child]:mt-0">
      <Blocks blocks={blocks} labels={labels} />
    </div>
  );
}
