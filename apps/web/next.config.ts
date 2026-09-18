import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@accrue/core', '@accrue/solana', '@accrue/db'],
  webpack: (configuration) => {
    configuration.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return configuration;
  },
};

export default nextConfig;
