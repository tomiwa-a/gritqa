import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { conversationDetail, listConversations } from '@/lib/db/conversations';
import type { Conversation, ConversationDetail } from '@/lib/model';

/**
 * Conversations, from `conversations`.
 *
 * Two reads and both are memoized, because the panel draws the open thread and the
 * history list beside it in one render -- and the history list is also what the
 * panel falls back to when no conversation is named.
 */

/** Every thread in this project, most recently spoken in first. */
export const getConversations = cache(async (): Promise<Conversation[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return listConversations(scope.projectId);
});

/**
 * One thread with its turns. Null for an id that is not a conversation of this
 * project, which the panel renders as the history list -- a stale link lands you
 * where you can pick a real one rather than on an error.
 */
export const getConversation = cache(
  async (publicId: string): Promise<ConversationDetail | null> => {
    const scope = await currentScope();
    if (!scope) return null;
    return conversationDetail(scope.projectId, publicId);
  },
);
