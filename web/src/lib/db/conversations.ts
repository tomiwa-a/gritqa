import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { conversationMessages, conversations, testPlans } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import type { AgentStep, Conversation, ConversationDetail, ConversationTurn } from '@/lib/model';

/**
 * Conversations, read and written.
 *
 * Scoped by project on every path, the same way `plans.ts` and `rules.ts` are: a
 * conversation belonging to another project reads as absent rather than as
 * forbidden, which is the answer that does not confirm the id exists.
 */

/**
 * A title nobody typed.
 *
 * Asking a model for one would be a third call per conversation to produce six
 * words, so it comes off the question itself -- first sentence, trimmed. The cost
 * is that a rambling first message makes a mediocre title; the alternative was an
 * untitled row, and an untitled row in a history list can never be found again.
 */
export function titleFrom(question: string): string {
  const line = question.trim().split(/\n/)[0] ?? '';
  const sentence = line.split(/(?<=[.?!])\s/)[0] ?? line;
  const clean = sentence.replace(/\s+/g, ' ').trim();
  if (clean.length <= 72) return clean || 'Untitled';
  return `${clean.slice(0, 71).trimEnd()}…`;
}

/**
 * One line of an answer, for a list you are scanning rather than reading.
 *
 * The model writes markdown, and markdown clamped to two lines at 12px is worse than
 * no preview at all -- a row that opens with three hashes or a fence marker tells you
 * about the formatting instead of about the answer. So the markers come out here
 * rather than being rendered: this is the one place text from the agent is
 * deliberately not `Prose`, because it is a label and not a document.
 *
 * `_` is left alone on purpose. It is emphasis about as often as it is the middle of
 * `route_pattern`, and mangling an identifier costs more than an unclosed italic.
 */
export function snippet(body: string | null, max = 190): string | null {
  if (!body) return null;
  const flat = body
    /* A fenced block says nothing in one line, and its first line is usually an
       import or a brace. */
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** `revision_author` on the way out, in the read model's two-sided naming. */
function authorOf(stored: 'agent' | 'human'): ConversationTurn['author'] {
  return stored === 'agent' ? 'ai' : 'you';
}

export async function listConversations(projectId: number): Promise<Conversation[]> {
  const rows = await db
    .select({
      publicId: conversations.publicId,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      /* Two counts as subqueries rather than two joins with a GROUP BY: the list is
         short, both are indexed, and a join against messages would multiply the
         conversation row before anything could be counted. */
      turnCount: sql<number>`(
        SELECT count(*) FROM ${conversationMessages}
        WHERE ${conversationMessages.conversationId} = ${conversations.id}
      )::int`,
      planCount: sql<number>`(
        SELECT count(*) FROM ${testPlans}
        WHERE ${testPlans.conversationId} = ${conversations.id}
      )::int`,
      /* The last thing said. Always the agent's answer, because an exchange is written
         as a pair -- and that is the half worth showing: a thread is recognised by
         what you were told, not by how you asked. */
      last: sql<string | null>`(
        SELECT ${conversationMessages.body} FROM ${conversationMessages}
        WHERE ${conversationMessages.conversationId} = ${conversations.id}
        ORDER BY ${conversationMessages.seq} DESC
        LIMIT 1
      )`,
    })
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.updatedAt));

  return rows.map((row) => ({
    publicId: row.publicId,
    title: row.title,
    whenLabel: agoLabel(row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
    turnCount: row.turnCount,
    planCount: row.planCount,
    preview: snippet(row.last),
  }));
}

export async function conversationDetail(
  projectId: number,
  publicId: string,
): Promise<ConversationDetail | null> {
  const [row] = await db
    .select({
      id: conversations.id,
      publicId: conversations.publicId,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.publicId, publicId)))
    .limit(1);

  if (!row) return null;

  const [turns, plans] = await Promise.all([
    db
      .select({
        publicId: conversationMessages.publicId,
        seq: conversationMessages.seq,
        author: conversationMessages.author,
        body: conversationMessages.body,
        steps: conversationMessages.steps,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, row.id))
      .orderBy(asc(conversationMessages.seq)),
    db
      .select({
        publicId: testPlans.publicId,
        name: testPlans.name,
        status: testPlans.status,
        version: testPlans.version,
      })
      .from(testPlans)
      .where(eq(testPlans.conversationId, row.id))
      .orderBy(desc(testPlans.createdAt)),
  ]);

  return {
    publicId: row.publicId,
    title: row.title,
    whenLabel: agoLabel(row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
    turnCount: turns.length,
    planCount: plans.length,
    preview: snippet(turns.at(-1)?.body ?? null),
    turns: turns.map((turn) => ({
      publicId: turn.publicId,
      seq: turn.seq,
      author: authorOf(turn.author),
      body: turn.body,
      whenLabel: agoLabel(turn.createdAt),
      createdAt: turn.createdAt.toISOString(),
      steps: turn.steps ?? [],
    })),
    plans,
  };
}

/**
 * The prose of a conversation, oldest first, for handing back to the model.
 *
 * Turns only -- the tool digests are for a developer reading the panel, not for the
 * model, which already knows what it called. Kept here rather than derived from
 * `conversationDetail` so that the agent path does not depend on the read model's
 * labels: `whenLabel` is presentation, and a prompt built from it would go stale in
 * a way nothing would notice.
 */
export async function conversationHistory(
  conversationId: number,
): Promise<{ author: 'agent' | 'human'; body: string }[]> {
  return db
    .select({ author: conversationMessages.author, body: conversationMessages.body })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.seq));
}

/**
 * Enough of a conversation to write to it, and to talk about it.
 *
 * `title` is here because the brief proposal needs it and reading it costs one
 * column: the panel has it on screen, but a title arriving back from the browser is
 * a prompt somebody else could have written.
 */
export type ConversationRef = { id: number; publicId: string; title: string };

/** The conversation by id, if it is in this project. Resolved before anything is written. */
export async function findConversation(
  projectId: number,
  publicId: string,
): Promise<ConversationRef | null> {
  const [row] = await db
    .select({
      id: conversations.id,
      publicId: conversations.publicId,
      title: conversations.title,
    })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.publicId, publicId)))
    .limit(1);
  return row ?? null;
}

/**
 * A question, written the moment somebody asks it.
 *
 * This reverses a decision, and the reversal is worth recording rather than quietly
 * making. Until now a question and its answer were written together, because a
 * question stored on its own would be "a row that is not a record of anything,
 * sitting above a composer, with no way to tell whether the answer is coming or the
 * request died". That objection was exact, and it is answered: the answer is queued
 * work now, so there is a job row that says an answer is coming and says so if it
 * stopped. With the objection gone, what is left is the half that was always better
 * -- a thread that exists while the agent is reading, on a page the developer is
 * free to close.
 *
 * `seq` comes back rather than being discarded, because the answer is written later
 * by something else and has to land in the slot immediately after this one. Passing
 * it through the job payload is what keeps the pair together across a process that
 * might not be the one that finishes.
 */
export async function askedIn(input: {
  projectId: number;
  userId: number;
  /** The thread this belongs to, or null to start one from the question. */
  conversation: ConversationRef | null;
  question: string;
}): Promise<{ thread: ConversationRef; seq: number }> {
  return db.transaction(async (tx) => {
    let thread = input.conversation;
    if (!thread) {
      const [created] = await tx
        .insert(conversations)
        .values({
          projectId: input.projectId,
          title: titleFrom(input.question),
          createdBy: input.userId,
        })
        .returning({
          id: conversations.id,
          publicId: conversations.publicId,
          title: conversations.title,
        });
      thread = created;
    }

    const [{ next }] = await tx
      .select({
        next: sql<number>`coalesce(max(${conversationMessages.seq}), 0) + 1`.mapWith(Number),
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, thread.id));

    await tx.insert(conversationMessages).values({
      conversationId: thread.id,
      seq: next,
      author: 'human',
      /* `steps` and `model_label` left null, which the table's CHECK requires:
         somebody typing called no tools and used no model. */
      body: input.question,
    });

    /* The value set here is discarded -- `set_updated_at()` overwrites it with the
       server's own now() on every UPDATE. What the statement is for is causing the
       update, so the trigger fires and the history list re-sorts by what was last
       spoken in. A question counts as activity: a thread being answered right now is
       the one you most want at the top. */
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, thread.id));

    return { thread, seq: next };
  });
}

/**
 * The thread up to a question, for handing to the model.
 *
 * `conversationHistory` cannot be used on the queued path: the question is already a
 * row by the time the agent runs, and `askAgent` appends it as the final user
 * message -- so reading everything would send it twice, once as history and once as
 * the thing being asked. Strictly before, so the boundary is the question's own seq
 * and not "the last row", which a second person asking in the same thread would move.
 */
export async function historyBefore(
  conversationId: number,
  seq: number,
): Promise<{ author: 'agent' | 'human'; body: string }[]> {
  return db
    .select({ author: conversationMessages.author, body: conversationMessages.body })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        lt(conversationMessages.seq, seq),
      ),
    )
    .orderBy(asc(conversationMessages.seq));
}

/**
 * The answer, in the slot after the question it answers.
 *
 * `onConflictDoNothing` is not defensive tidiness, it is the one real race on this
 * path: a job whose answer was written and whose `settleWork` never landed is
 * resumed, and it must not append a second copy of an answer that is already in the
 * thread. Doing nothing is right rather than clever -- the row that is there was
 * written by an attempt that got further than this one.
 */
export async function answeredIn(input: {
  conversationId: number;
  /** The seq of the question. The answer goes immediately after it. */
  seq: number;
  answer: { body: string; steps: AgentStep[]; modelLabel: string };
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        seq: input.seq + 1,
        author: 'agent',
        body: input.answer.body,
        steps: input.answer.steps,
        modelLabel: input.answer.modelLabel,
      })
      .onConflictDoNothing();

    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
  });
}
