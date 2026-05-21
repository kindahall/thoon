import type { NextConfig } from 'next';

const scriptSrc = process.env.NODE_ENV === 'development' ? "'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com" : "'self' 'unsafe-inline' https://s3.tradingview.com";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
          {
            key: 'Content-Security-Policy',
            value:
              `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; connect-src 'self' https://data-api.binance.vision https://api.bybit.com https://www.okx.com https://api.bitget.com https://api.kraken.com https://api.kucoin.com https://api.exchange.coinbase.com wss://data-stream.binance.vision wss://fstream.binance.com wss://stream.binance.com:9443; img-src 'self' data: blob: https://s3-symbol-logo.tradingview.com https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; frame-src https://www.tradingview.com https://s.tradingview.com https://www.tradingview-widget.com; frame-ancestors 'none';`,
          },
        ],
        source: '/:path*',
      },
    ];
  },
  reactStrictMode: true,
};

export default nextConfig;
