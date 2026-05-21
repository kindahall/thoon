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
    message.id.includes('agent-chat-thoonix-fast') ||
    message.content.startsWith('Recu. Je te reponds tout de suite') ||
    message.content.startsWith('Je suis la. Je reponds en mode rapide') ||
    message.content.startsWith('Tu as raison: une question simple ne doit pas lancer') ||
    message.content.startsWith('Je te reponds directement en mode rapide') ||
    message.content.startsWith('Etat rapide:') ||
    message.content.startsWith('Tu as raison: le chat ne doit pas attendre Codex CLI') ||
    message.content.startsWith('Analyse profonde lancee avec Codex. Tu peux continuer') ||
    message.content.startsWith('Connexion directe a Codex CLI en cours') ||
    message.content.startsWith('La reponse instantanee est deja affichee') ||
    message.content.startsWith('La reponse instantanee est affichee, mais') ||
    message.content.startsWith('Codex indisponible') ||
    message.content.startsWith('Codex CLI est bien configure') ||
    message.content.startsWith("Codex CLI n'a pas pu repondre") ||
    message.content.startsWith('Thoonix timed out while waiting for Codex CLI')
  );
}
