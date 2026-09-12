import type { NextConfig } from 'next';

/**
 * Minimal config — W18 S3 only needs the App Router defaults. `reactStrictMode`
 * is explicit rather than relying on whatever Next's own default happens to
 * be this version, matching this repo's "no hardcoded values implied by
 * silence" convention.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
