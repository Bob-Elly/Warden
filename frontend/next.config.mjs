import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Local development: read the repo-root .env written by `npm run setup`.
// On Vercel the file does not exist and project env vars are used instead.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['near-api-js'],
  },
};

export default nextConfig;
