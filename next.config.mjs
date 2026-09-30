/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  compiler: {
    styledComponents: true,
  },

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
