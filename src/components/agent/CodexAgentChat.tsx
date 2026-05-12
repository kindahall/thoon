'use client';

import { BrainCircuit, Send, Sparkles, Tv } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { postJson } from '../../services/api-client';
import type { KronosIntegrationProfile } from '../../server/kronos-integration';
import type { TradingViewMcpProfile } from '../../server/tradingview-mcp-integration';
import type { AgentChatMessage, KronosLearningProfile } from '../../types/trading';
import { Badge, Button, Card } from '../ui';

type CodexAgentChatProps = {
  aiStatus: {
    configured: boolean;
    endpoint: string;
    model: string;
    provider: string;
    sandbox?: string;
  };
  initialMessages: AgentChatMessage[];
  kronosLearningProfile: KronosLearningProfile;
  kronosProfile: KronosIntegrationProfile;
  tradingViewMcpProfile: TradingViewMcpProfile;
};

type AgentChatResponse = {
  messages: AgentChatMessage[];
  reply: AgentChatMessage;
};

const quickPrompts = [
  'Ou en est ton travail dans Thoon ?',
  'Quelles ameliorations prioriser dans l application ?',
  'Comment Kronos peut aider les strategies et les backtests ?',
  'Analyse TradingView et propose les strategies importables.',
];

export function CodexAgentChat({ aiStatus, initialMessages, kronosLearningProfile, kronosProfile, tradingViewMcpProfile }: CodexAgentChatProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const [pending, setPending] = useState(false);
  const orderedMessages = useMemo(() => messages.slice().reverse(), [messages]);
  const providerLabel = aiStatus.provider === 'codex' ? 'Thoonix' : aiStatus.provider;
  const hasRunningMessages = messages.some((message) => message.status === 'running');

  useEffect(() => {
    if (!hasRunningMessages) {
      return undefined;
    }

    let cancelled = false;

    async function refreshMessages() {
      try {
        const response = await fetch('/api/agent/chat', { cache: 'no-store' });

        if (!response.ok) {
          return;
        }

        const nextMessages = (await response.json()) as AgentChatMessage[];

        if (!cancelled) {
          setMessages(nextMessages);
        }
      } catch {
        // Keep the optimistic thread visible; the next interval can recover.
      }
    }

    void refreshMessages();
    const interval = window.setInterval(refreshMessages, 1800);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasRunningMessages]);

  async function sendMessage(message = draft) {
    const content = message.trim();

    if (!content || pending) {
      return;
    }

    const optimisticMessage: AgentChatMessage = {
      content,
      createdAt: new Date().toISOString(),
      id: `optimistic-${Date.now()}`,
      role: 'user',
      status: 'completed',
    };

    setPending(true);
    setError('');
    setDraft('');
    setMessages((currentMessages) => [optimisticMessage, ...currentMessages]);

    try {
      const response = await postJson<AgentChatResponse>('/api/agent/chat', { message: content });
      setMessages(response.messages);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : 'Thoonix chat failed');
    } finally {
      setPending(false);
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  return (
    <Card className="codex-chat-card">
      <div className="codex-chat-head">
        <div>
          <span>Thoonix direct</span>
          <h2>Chat Agent</h2>
        </div>
        <div className="codex-chat-badges">
          <Badge tone={aiStatus.configured ? 'positive' : 'warning'}>{providerLabel}</Badge>
          <Badge tone={aiStatus.sandbox === 'danger-full-access' ? 'warning' : 'neutral'}>{aiStatus.sandbox ?? aiStatus.model}</Badge>
        </div>
      </div>

      <div className="codex-chat-layout">
        <div className="codex-chat-thread" aria-live="polite">
          {orderedMessages.length ? (
            orderedMessages.slice(-10).map((message) => (
              <article className={`codex-chat-message codex-chat-message--${message.role} is-${message.status}`} key={message.id}>
                <span>{message.role === 'user' ? 'Jimmy' : 'Thoonix'}</span>
                <p>{displayChatContent(message)}</p>
              </article>
            ))
          ) : (
            <div className="codex-chat-empty">
              <BrainCircuit size={18} />
              <span>Demande a Thoonix son etat, une decision produit, ou une amelioration a coder.</span>
            </div>
          )}
          {pending ? (
            <article className="codex-chat-message codex-chat-message--assistant is-running">
              <span>Thoonix</span>
              <p>Thoonix travaille...</p>
            </article>
          ) : null}
        </div>

        <div className="codex-chat-side">
          <aside className="codex-kronos-card" aria-label="Kronos integration">
            <div>
              <Sparkles size={16} />
              <strong>Kronos</strong>
            </div>
            <span>{kronosProfile.summary}</span>
            <div className="codex-kronos-grid">
              <small>{(kronosLearningProfile.accuracy * 100).toFixed(1)}% hit</small>
              <small>{kronosLearningProfile.confidenceWeight.toFixed(2)}x</small>
              <small>{kronosLearningProfile.sampleQuality}</small>
            </div>
          </aside>
          <aside className="codex-kronos-card codex-kronos-card--tradingview" aria-label="TradingView MCP integration">
            <div>
              <Tv size={16} />
              <strong>TradingView MCP</strong>
            </div>
            <span>{tradingViewMcpProfile.summary}</span>
            <div className="codex-kronos-grid">
              <small>{tradingViewMcpProfile.mcpName}</small>
              <small>{tradingViewMcpProfile.tools.length} tools</small>
              <small>{tradingViewMcpProfile.configured ? 'enabled' : 'missing'}</small>
            </div>
          </aside>
        </div>
      </div>

      <div className="codex-quick-prompts">
        {quickPrompts.map((prompt) => (
          <button disabled={pending} key={prompt} onClick={() => void sendMessage(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>

      <form
        className="codex-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <textarea onChange={(event) => setDraft(event.target.value)} onKeyDown={handleDraftKeyDown} placeholder="Parle directement a Thoonix..." value={draft} />
        <Button disabled={pending || !draft.trim()} icon={<Send size={15} />} size="sm" type="submit" variant="primary">
          Envoyer
        </Button>
      </form>
      {error ? <span className="codex-chat-error">{error}</span> : null}
    </Card>
  );
}

function displayChatContent(message: AgentChatMessage) {
  if (message.role !== 'assistant') {
    return message.content;
  }

  return message.content
    .replace(/\bchat Codex\b/g, 'chat Thoonix')
    .replace(/\bCodex direct\b/g, 'Thoonix direct')
    .replace(/\bCodex est\b/g, 'Thoonix est')
    .replace(/\bCodex travaille\b/g, 'Thoonix travaille');
}
