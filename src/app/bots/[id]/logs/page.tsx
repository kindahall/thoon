import { notFound } from 'next/navigation';

import { BotLogsPage } from '../../../../screens/bots/BotLogsPage';
import { listBotIds, listBotLogs, listBots } from '../../../../services/thoon-data-service';

type BotLogsRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export function generateStaticParams() {
  return listBotIds().map((id) => ({ id }));
}

export default async function BotLogsRoute({ params }: BotLogsRouteProps) {
  const { id } = await params;
  const bot = listBots().find((item) => item.id === id);

  if (!bot) {
    notFound();
  }

  return <BotLogsPage bot={bot} logs={listBotLogs()} />;
}
