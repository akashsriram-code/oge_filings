import type { NextConfig } from 'next';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const isGithubPagesBuild = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  typedRoutes: false,
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: isGithubPagesBuild,
  output: isGithubPagesBuild ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
