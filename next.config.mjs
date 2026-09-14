/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serve large video tile assets from /public without size warnings
  experimental: {},

  async headers() {
    return [
      {
        source: '/tiles/:path*',
        headers: [
          { key: 'Accept-Ranges', value: 'bytes' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
