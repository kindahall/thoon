import { ChartsPage } from '../../screens/ChartsPage';

export const dynamic = 'force-dynamic';

type ChartsRouteProps = {
  searchParams?: Promise<{
    pair?: string;
  }>;
};

export default async function ChartsRoute({ searchParams }: ChartsRouteProps) {
  const params = await searchParams;

  return <ChartsPage initialPair={params?.pair} />;
}
