/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.STANDALONE === '1' ? 'standalone' : undefined,
};

export default nextConfig;
