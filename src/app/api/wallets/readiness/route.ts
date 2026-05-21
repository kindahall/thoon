import { NextResponse } from 'next/server';

import { getWalletExecutionReadiness } from '../../../../server/wallet-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    payload: getWalletExecutionReadiness(),
    source: 'thoon_wallet_execution_readiness',
  });
}
