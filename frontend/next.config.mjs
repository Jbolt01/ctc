/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    return [
      // Proxy API requests to the backend service when hitting Next directly on :3000
      {
        source: '/api/:path*',
        destination: 'http://backend:8000/api/:path*',
      },
      // Health endpoint convenience
      {
        source: '/health',
        destination: 'http://backend:8000/health',
      },
      // WebSocket proxy for dev (Next.js will forward upgrade requests)
      {
        source: '/ws/:path*',
        destination: 'http://backend:8000/ws/:path*',
      },
    ];
  },
};

export default nextConfig;

