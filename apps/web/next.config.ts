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
  // @postbiz/core est du TypeScript non compilé (workspace) : Next doit le transpiler.
  transpilePackages: ['@postbiz/core'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Domaines secondaires → domaine principal (NEXT_PUBLIC_SITE_URL). Évalué au build : à renseigner avant `next build`.
  async redirects() {
    return aliasRedirects(process.env.NEXT_PUBLIC_SITE_URL, configuredAliases(process.env.SITE_ALIAS_DOMAINS));
  },
};

export default nextConfig;
