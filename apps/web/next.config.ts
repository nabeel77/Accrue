import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
