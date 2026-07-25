import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ledgerlite/domain', '@ledgerlite/ui'],
};

export default nextConfig;
