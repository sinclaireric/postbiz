import type { NextConfig } from 'next';
import { aliasRedirects, configuredAliases } from './src/lib/alias-domains';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @postbiz/core et @postbiz/kb sont du TypeScript non compilé (workspace) : Next doit les transpiler.
  transpilePackages: ['@postbiz/core', '@postbiz/kb'],
  // Le lecteur de PDF (pdf.js) se charge depuis node_modules à l'exécution, sans être empaqueté.
  serverExternalPackages: ['unpdf'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Domaines secondaires → domaine principal (NEXT_PUBLIC_SITE_URL). Évalué au build : à renseigner avant `next build`.
  async redirects() {
    return aliasRedirects(process.env.NEXT_PUBLIC_SITE_URL, configuredAliases(process.env.SITE_ALIAS_DOMAINS));
  },
};

export default nextConfig;
