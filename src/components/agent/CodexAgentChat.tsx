'use client';

import { BrainCircuit, Send, Sparkles, Trash2, Tv } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { deleteJson, postJson } from '../../services/api-client';
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

type AgentChatDeleteResponse = {
  deleted: boolean;
  messages: AgentChatMessage[];
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
  const [deletingMessageIds, setDeletingMessageIds] = useState<string[]>([]);
  const orderedMessages = useMemo(() => messages.slice().reverse(), [messages]);
  const providerLabel = aiStatus.provider === 'codex' ? 'Codex CLI' : aiStatus.provider;
  const agentLabel = 'Thoonix';
  const directLabel = 'Thoonix direct';
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

  async function deleteMessage(messageId: string) {
    if (deletingMessageIds.includes(messageId)) {
      return;
    }

    const previousMessages = messages;
    setError('');
    setDeletingMessageIds((currentIds) => [...currentIds, messageId]);
    setMessages((currentMessages) => currentMessages.filter((message) => message.id !== messageId));

    try {
      const response = await deleteJson<AgentChatDeleteResponse>(`/api/agent/chat/${encodeURIComponent(messageId)}`);
      setMessages(response.messages);
    } catch (deleteError) {
      setMessages(previousMessages);
      setError(deleteError instanceof Error ? deleteError.message : 'Message deletion failed');
    } finally {
      setDeletingMessageIds((currentIds) => currentIds.filter((id) => id !== messageId));
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
          <span>{directLabel}</span>
          <h2>Chat Agent</h2>
        </div>
        <div className="codex-chat-badges">
          {hasRunningMessages ? <CodexLiveStatus /> : null}
          <Badge tone={aiStatus.configured ? 'positive' : 'warning'}>{providerLabel}</Badge>
          <Badge tone={aiStatus.sandbox === 'danger-full-access' ? 'warning' : 'neutral'}>{aiStatus.sandbox ?? aiStatus.model}</Badge>
        </div>
      </div>

      <div className="codex-chat-layout">
        <div className="codex-chat-thread" aria-live="polite">
          {orderedMessages.length ? (
            orderedMessages.slice(-10).map((message) => (
              <article className={`codex-chat-message codex-chat-message--${message.role} is-${message.status}`} key={message.id}>
                <div className="codex-chat-message-head">
                  <span>{message.role === 'user' ? 'Jimmy' : agentLabel}</span>
                  <button
                    aria-label="Delete message"
                    className="codex-chat-delete"
                    disabled={deletingMessageIds.includes(message.id)}
                    onClick={() => void deleteMessage(message.id)}
                    title="Delete message"
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {message.role === 'assistant' && message.status === 'running' ? <CodexLiveStatus /> : <p>{displayChatContent(message)}</p>}
              </article>
            ))
          ) : (
            <div className="codex-chat-empty">
              <BrainCircuit size={18} />
              <span>Demande a {agentLabel} son etat, une decision produit, ou une amelioration a coder.</span>
            </div>
          )}
          {pending ? (
            <article className="codex-chat-message codex-chat-message--assistant is-running">
              <span>{agentLabel}</span>
              <CodexLiveStatus />
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
        <textarea onChange={(event) => setDraft(event.target.value)} onKeyDown={handleDraftKeyDown} placeholder={`Parle directement a ${agentLabel}...`} value={draft} />
        <Button disabled={pending || !draft.trim()} icon={<Send size={15} />} size="sm" type="submit" variant="primary">
          Envoyer
        </Button>
      </form>
      {error ? <span className="codex-chat-error">{error}</span> : null}
    </Card>
  );
}

function CodexLiveStatus() {
  return (
    <button aria-label="Codex CLI actif" className="codex-live-status" title="Codex CLI actif" type="button">
      <span aria-hidden="true" />
      Actif
    </button>
  );
}

function displayChatContent(message: AgentChatMessage) {
  return message.content;
}
