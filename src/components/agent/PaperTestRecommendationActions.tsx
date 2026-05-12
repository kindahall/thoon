'use client';

import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { postJson } from '../../services/api-client';
import { Button } from '../ui';

type PaperTestRecommendationActionsProps = {
  reportId: string;
  strategyId: string;
};

type AgentPaperActionResponse = {
  result?: {
    href?: string;
  };
  run?: {
    notes?: string;
  };
};

export function PaperTestRecommendationActions({ reportId, strategyId }: PaperTestRecommendationActionsProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<'error' | 'idle' | 'running' | 'sent'>('idle');
  const [message, setMessage] = useState('');

  if (dismissed) {
    return (
      <div className="agent-paper-actions agent-paper-actions--dismissed">
        <CheckCircle2 size={15} />
        <span>Ignored for now</span>
      </div>
    );
  }

  async function confirmPaperTest() {
    setStatus('running');
    setMessage('Preparing Charts paper');

    try {
      const response = await postJson<AgentPaperActionResponse>('/api/agent/actions', {
        action: 'send_to_paper',
        confirmed: true,
        reportId,
        strategyId,
      });
      const href = response.result?.href;

      setStatus('sent');
      setMessage(response.run?.notes ?? 'Paper proposal ready in Charts');

      if (href) {
        router.push(href);
      }
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Paper proposal blocked');
    }
  }

  return (
    <div className="agent-paper-actions">
      <Button disabled={status === 'running'} icon={<RotateCcw size={15} />} onClick={() => void confirmPaperTest()} size="sm" variant="primary">
        {status === 'running' ? 'Preparing' : 'Open in Charts'}
      </Button>
      <Button disabled={status === 'running'} icon={<X size={15} />} onClick={() => setDismissed(true)} size="sm" variant="ghost">
        Ignore
      </Button>
      {message ? <span className={`agent-paper-actions__status is-${status}`}>{message}</span> : null}
    </div>
  );
}
