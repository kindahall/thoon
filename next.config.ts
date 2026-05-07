import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; connect-src 'self' https://data-api.binance.vision https://api.bybit.com https://www.okx.com https://api.bitget.com https://api.kraken.com https://api.kucoin.com https://api.exchange.coinbase.com wss://data-stream.binance.vision; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-src https://www.tradingview.com; frame-ancestors 'none';",
          },
        ],
        source: '/:path*',
      },
    ];
  },
  reactStrictMode: true,
};

export default nextConfig;
