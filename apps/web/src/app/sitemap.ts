import type { MetadataRoute } from 'next';
import { CONTENT_DIR, loadPostsFrom } from '@/lib/blog/load';
import { CATEGORIES } from '@/lib/blog/types';
import { siteUrl } from '@/lib/supabase/env';

const PAGES = ['/', '/produit/inbox', '/produit/planification', '/canaux', '/tarifs', '/blog', '/contact', '/cgu', '/confidentialite', '/suppression-des-donnees'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Une seule adresse par article et par page, quelle que soit la langue : la langue se choisit par cookie, pas par l'URL.
  const posts = await loadPostsFrom(CONTENT_DIR, 'en');
  return [
    ...PAGES.map((path) => ({ url: `${siteUrl}${path === '/' ? '' : path}` })),
    ...CATEGORIES.map((c) => ({ url: `${siteUrl}/blog/category/${c}` })),
    ...posts.map((p) => ({ url: `${siteUrl}/blog/${p.slug}`, lastModified: new Date(`${p.updated ?? p.date}T00:00:00Z`) })),
  ];
}
