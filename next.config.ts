import type { NextConfig } from 'next';

/**
 * Configuration Next.js.
 * - `sw.js` ne doit jamais être mis en cache par le navigateur, sinon les mises
 *   à jour du service worker mettent des heures à arriver.
 * - Les réponses de l'API ne doivent pas être mises en cache (données temps réel).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
