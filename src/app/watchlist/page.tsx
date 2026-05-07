import { WatchlistPage } from '../../screens/WatchlistPage';

export const dynamic = 'force-dynamic';

type WatchlistRouteProps = {
  searchParams?: Promise<{
    add?: string;
  }>;
};

export default async function WatchlistRoute({ searchParams }: WatchlistRouteProps) {
  const params = await searchParams;

  return <WatchlistPage initialAddPair={params?.add} />;
}
