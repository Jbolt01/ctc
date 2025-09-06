/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_API_URL || 'http://backend:8000';
    return [
      // Proxy API requests to the backend service when hitting Next directly on :3000
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      // Health endpoint convenience
      {
        source: '/health',
        destination: `${backendUrl}/health`,
      },
      // WebSocket proxy for dev (Next.js will forward upgrade requests)
      {
        source: '/ws/:path*',
        destination: `${backendUrl}/ws/:path*`,
      },
      // Proxy API docs from backend
      {
        source: '/docs',
        destination: `${backendUrl}/api/docs`,
      },
      {
        source: '/redoc',
        destination: `${backendUrl}/api/redoc`,
      },
    ];
  },
};

export default nextConfig;

