import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/supabase/env';

export default function robots(): MetadataRoute.Robots {
  return {
    // L'application, les retours OAuth et les routes d'API n'ont rien à faire dans un moteur de recherche.
    rules: { userAgent: '*', allow: '/', disallow: ['/app', '/admin', '/api/', '/auth/'] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
