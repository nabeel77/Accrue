import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@accrue/core', '@accrue/solana'],
};

export default nextConfig;
