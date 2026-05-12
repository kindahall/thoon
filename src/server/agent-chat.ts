import type { AgentChatMessage } from '../types/trading';

export function visibleAgentChatMessages(messages: AgentChatMessage[]) {
  return messages.filter((message) => !isLegacyLocalAgentChatMessage(message));
}

function isLegacyLocalAgentChatMessage(message: AgentChatMessage) {
  if (message.role !== 'assistant') {
    return false;
  }

  return (
    message.id.includes('agent-chat-thoonix-instant') ||
    message.content.startsWith('Recu. Je te reponds tout de suite') ||
    message.content.startsWith('Tu as raison: le chat ne doit pas attendre Codex CLI') ||
    message.content.startsWith('Analyse profonde lancee avec Codex. Tu peux continuer') ||
    message.content.startsWith('Connexion directe a Codex CLI en cours') ||
    message.content.startsWith('La reponse instantanee est deja affichee') ||
    message.content.startsWith('La reponse instantanee est affichee, mais') ||
    message.content.startsWith('Thoonix timed out while waiting for Codex CLI')
  );
}
