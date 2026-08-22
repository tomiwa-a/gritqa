'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { writeNewPlan } from '@/lib/db/drafts';
import { requireScope } from '@/lib/db/scope';
import { listRules, toTestingRule } from '@/lib/db/rules';
import {
  conversationHistory,
  findConversation,
  writeExchange,
  type ConversationRef,
} from '@/lib/db/conversations';
import {
  CliUnavailableError,
  NoModelKeyError,
  askAgent,
  draftPlan,
  priorFindingsOf,
  proposeBrief,
} from '@/lib/agent';
import { NEW_CONVERSATION, askToken, withOverlayOn } from '@/lib/overlay';

/**
 * The three things the ask panel can do: answer, propose a brief, draft from one.
 *
 * Server actions rather than a streaming route, and the reason is the same one
 * `generate.ts` gives about itself -- the data path here is the one a stream would
 * use, so a reader can be put in front of it later without moving anything. What is
 * different is that this path is already non-destructive: the exchange is a row, so
 * closing the panel mid-answer loses the waiting and not the answer.
 *
 * All three read through `requireScope()`, so a conversation belonging to another
 * project is simply not found. None of them can reach a plan, run anything, or write
 * to the developer's code.
 */

/** A question is a paragraph. Longer than this is a pasted file, not an ask. */
const MAX_QUESTION = 2_000;
const MAX_BRIEF = 2_000;
const MAX_NAME = 120;

/**
 * The failures worth naming, in the words of what to do about them.
 *
 * The same two conditions `refine.ts` and `generate.ts` name, in the same sentences,
 * because they are the same two conditions and a developer who has read one of these
 * on the plan page should not wonder whether this is a different problem.
 */
function readable(error: unknown): string {
  if (error instanceof NoModelKeyError) {
    return 'No model key yet, so there is nothing to answer with. Add one in Settings → AI.';
  }
  if (error instanceof CliUnavailableError) {
    /* Logged, unlike the other named failures, because `detail` carries the address
       that did not answer and the reason -- and this is the one condition a developer
       has to fix rather than read. */
    console.error('agent: research unavailable', error.detail);
    return 'GritQA could not reach the research server on your machine, so it has no way to read the code. That is a separate channel from the job poller, so a connected machine can still be missing it — start it and ask again.';
  }
  /* Logged rather than shown: a provider's own error text is written for whoever
     wired the provider up, and it is the one place a request id or a key fragment
     could turn up in something a browser renders. */
  console.error('ask: could not answer', error);
  return 'The model did not come back with an answer. Try asking again, or a smaller question.';
}

/**
 * The page the panel is open over, from the href the composer sent.
 *
 * The panel is an overlay, so there is no route of its own to revalidate -- the
 * thread is rendered by whichever page you happened to be reading. Only the path is
 * kept: `revalidatePath` is keyed by path, and the params belong to the page.
 */
function pageOf(here: string): string {
  const path = here.split('?')[0];
  return path.startsWith('/dashboard') ? path : '/dashboard';
}

/** Where a thread lives when it is a page rather than a panel. */
const CONVERSATIONS = '/dashboard/conversations';

/**
 * Whether the question came from the conversation pages or from the panel.
 *
 * The two surfaces address a thread differently -- the page by route, the panel by
 * search param -- and a new thread has to land wherever it was started. Read off
 * `here` rather than passed as a flag, because the composer already sends where it
 * is and a second field could disagree with the first.
 */
function fromConversationPage(here: string): boolean {
  return pageOf(here).startsWith(CONVERSATIONS);
}

export type AskState = null | { error: string } | { ok: true; turn: number };

/**
 * One turn: the question, and the answer to it.
 *
 * A new conversation ends in a redirect, because `ask:new` has to become
 * `ask:<id>` -- the panel is addressed by the thread it is showing, and the thread
 * did not exist when the question was asked. An existing one returns, because the
 * URL is already right and the revalidation redraws the thread underneath the box.
 */
export async function askAction(_previous: AskState, formData: FormData): Promise<AskState> {
  const id = String(formData.get('conversation') ?? '')
    .trim()
    .slice(0, 64);
  const question = String(formData.get('question') ?? '')
    .trim()
    .slice(0, MAX_QUESTION);
  const here = String(formData.get('here') ?? '/dashboard');

  if (!question) return { error: 'Ask something first.' };

  const scope = await requireScope();

  let conversation: ConversationRef | null = null;
  if (id && id !== NEW_CONVERSATION) {
    conversation = await findConversation(scope.projectId, id);
    if (!conversation) return { error: 'That conversation is not in this project any more.' };
  }

  let written: ConversationRef;
  let turns: number;
  try {
    const history = conversation ? await conversationHistory(conversation.id) : [];
    const answer = await askAgent({ question, history });

    written = await writeExchange({
      projectId: scope.projectId,
      userId: scope.userId,
      conversation,
      question,
      answer,
    });
    turns = history.length + 2;
  } catch (error) {
    return { error: readable(error) };
  }

  revalidatePath(pageOf(here));
  /* And the list, which sorts by activity and counts turns -- stale the moment an
     exchange lands, wherever it was asked from. Before the redirect below, because
     `redirect` throws and nothing after it runs. */
  revalidatePath(CONVERSATIONS);

  /* Outside the try, because `redirect` works by throwing and a catch around it
     would read a saved exchange as a failed one. */
  if (!conversation) {
    /* Asked from the pages -- including the panel opened over them, which is how a
       thread is started there -- the new thread is a page. Asked from anywhere else,
       it is the panel over the page you were reading, which is where you still are. */
    redirect(
      fromConversationPage(here)
        ? `${CONVERSATIONS}/${written.publicId}`
        : withOverlayOn(here, askToken(written.publicId)),
    );
  }

  return { ok: true, turn: turns };
}

export type BriefState = null | { error: string } | { ok: true; brief: string; name: string };

/**
 * A brief, from the conversation, for the developer to read before drafting.
 *
 * Cheap and separate on purpose. No tools and no research -- everything it needs was
 * already said -- and it lands in an editable field rather than going straight into a
 * draft, because the conversation may have covered four things and only one of them
 * is the test. `CliUnavailableError` is unreachable here, which is why the only named
 * failure is the missing key.
 */
export async function proposeBriefAction(
  _previous: BriefState,
  formData: FormData,
): Promise<BriefState> {
  const id = String(formData.get('conversation') ?? '')
    .trim()
    .slice(0, 64);
  if (!id || id === NEW_CONVERSATION) return { error: 'Ask something first.' };

  const scope = await requireScope();
  const conversation = await findConversation(scope.projectId, id);
  if (!conversation) return { error: 'That conversation is not in this project any more.' };

  try {
    const history = await conversationHistory(conversation.id);
    if (!history.some((turn) => turn.author === 'agent')) {
      return { error: 'There is nothing to draft from yet. Ask a question first.' };
    }
    const shaped = await proposeBrief({ title: conversation.title, history });
    return { ok: true, brief: shaped.brief, name: shaped.name };
  } catch (error) {
    return { error: readable(error) };
  }
}

export type ConversationDraftState = null | { error: string };

/** A plan records where it will run, so a typo here would be stored as fact. */
function cleanBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * "Draft a plan from this" -- the conversation's one action.
 *
 * The same draft the wizard produces, from a brief somebody arrived at instead of
 * one they typed cold, and it still researches: the conversation goes in as prior
 * findings, which pass one is told to confirm rather than to trust. A conversation
 * held ten minutes ago is a cache, and research is the one thing here that is not
 * allowed to be one.
 *
 * `trigger_source` stays `manual` -- a person asked for this -- and
 * `conversation_id` carries the difference.
 */
export async function draftFromConversationAction(
  _previous: ConversationDraftState,
  formData: FormData,
): Promise<ConversationDraftState> {
  const id = String(formData.get('conversation') ?? '')
    .trim()
    .slice(0, 64);
  const brief = String(formData.get('brief') ?? '')
    .trim()
    .slice(0, MAX_BRIEF);
  const name =
    String(formData.get('name') ?? '')
      .trim()
      .slice(0, MAX_NAME) || undefined;
  const baseUrl = cleanBaseUrl(String(formData.get('baseUrl') ?? '').trim());

  if (!id || id === NEW_CONVERSATION) return { error: 'Ask something first.' };
  if (!brief) return { error: 'Say what the plan should prove first.' };
  if (!baseUrl)
    return { error: 'That address is not a URL GritQA can call. Try http://localhost:8080.' };

  const scope = await requireScope();
  const conversation = await findConversation(scope.projectId, id);
  if (!conversation) return { error: 'That conversation is not in this project any more.' };

  const rules = (await listRules(scope.projectId)).map(toTestingRule);

  let written: Awaited<ReturnType<typeof writeNewPlan>>;
  try {
    const priorFindings = priorFindingsOf(await conversationHistory(conversation.id));
    const draft = await draftPlan({ brief, baseUrl, name, rules, priorFindings });

    written = await writeNewPlan({
      projectId: scope.projectId,
      userId: scope.userId,
      baseUrl,
      instruction: brief,
      conversationId: conversation.id,
      draft,
    });

    await record({
      userId: scope.userId,
      action: 'test_plan.drafted',
      entityType: 'test_plans',
      entityId: written.planId,
      /* `from` is what the timeline reads to say this came out of a conversation
         rather than out of the wizard. The transcript stays where it is. */
      values: {
        name: written.name,
        steps: draft.steps.length,
        model: draft.modelLabel,
        from: 'conversation',
      },
      ip: await clientIp(),
    });
  } catch (error) {
    return { error: readable(error) };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard/test-plans');
  revalidatePath('/dashboard/settings/activity');
  /* Both conversation surfaces count the plans a thread produced, and this is the
     one call that changes that number. */
  revalidatePath(CONVERSATIONS);
  revalidatePath(`${CONVERSATIONS}/${conversation.publicId}`);

  /* Outside the try, for the same reason as above. The plan is worth a page: it is
     long, it is the thing to read, and the conversation is one click back. */
  redirect(`/dashboard/test-plans/${written.publicId}`);
}
