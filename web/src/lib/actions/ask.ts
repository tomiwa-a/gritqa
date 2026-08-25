'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { requireScope } from '@/lib/db/scope';
import {
  askedIn,
  conversationHistory,
  findConversation,
  type ConversationRef,
} from '@/lib/db/conversations';
import { enqueueWork } from '@/lib/db/work';
import { NoModelKeyError, proposeBrief } from '@/lib/agent';
import { agentUnavailable } from '@/lib/work/ready';
import { runWork } from '@/lib/work/run';
import { WORK } from '@/lib/work/where';
import { NEW_CONVERSATION, askToken, withOverlayOn } from '@/lib/overlay';

/**
 * The three things the ask panel can do: answer, propose a brief, draft from one.
 *
 * Two of the three are queued now, and the exception is the interesting one.
 * `proposeBriefAction` reads a conversation that is already in front of the developer
 * and hands back a paragraph they are about to edit -- no tools, no research, seconds
 * -- so queueing it would mean a work row and a page refresh for something faster than
 * the navigation. Asking and drafting both go and read the code, which is minutes, so
 * both hand off.
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
 * The failures worth naming for the one thing here that still runs inline.
 *
 * Down to the missing key, which is the only named condition `proposeBrief` can hit:
 * it calls no tools, so there is no machine to be unreachable. The arm for that used
 * to be here and was always dead on this path -- what made it look alive was the two
 * actions that have since moved to the queue, where `run.ts` names it properly.
 */
function readable(error: unknown): string {
  if (error instanceof NoModelKeyError) {
    return 'No model key yet, so there is nothing to answer with. Add one in Settings → AI.';
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

/**
 * What comes back from asking.
 *
 * `asked` rather than `ok`, because that is now all it means: the question is a row and
 * an answer is coming. The answer itself arrives on the thread, which is the whole
 * point of the change -- there is no return value that could carry it, because this
 * request is long finished by the time it exists.
 */
export type AskState = null | { error: string } | { asked: true; turn: number };

/**
 * A question, and an answer on the way.
 *
 * The question is written here rather than by the work, and that is the design: a
 * thread you can read the moment you press the button, whether or not you stay for the
 * answer. `seq` comes back from the write and travels in the payload, so the answer
 * lands in the slot immediately after this question rather than after whatever is last
 * -- two people asking in one thread would otherwise cross their answers over.
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

  /* Before the question is written, so a project with no key and no machine does not
     collect questions nothing will ever answer. */
  const blocked = await agentUnavailable();
  if (blocked) return { error: blocked };

  const { thread, seq } = await askedIn({
    projectId: scope.projectId,
    userId: scope.userId,
    conversation,
    question,
  });

  /* No `ip` in this payload, unlike the two draft jobs: answering writes no audit row,
     so there is nothing for an address to be recorded on. */
  const job = await enqueueWork({
    projectId: scope.projectId,
    userId: scope.userId,
    type: 'answer_question',
    label: question,
    request: { conversation: thread.publicId, question, seq },
  });

  after(() => runWork(job));

  revalidatePath(pageOf(here));
  /* And the list, which sorts by activity and counts turns -- stale the moment a
     question lands, wherever it was asked from. Before the redirect below, because
     `redirect` throws and nothing after it runs. */
  revalidatePath(CONVERSATIONS);

  if (!conversation) {
    /* Asked from the pages -- including the panel opened over them, which is how a
       thread is started there -- the new thread is a page. Asked from anywhere else,
       it is the panel over the page you were reading, which is where you still are. */
    redirect(
      fromConversationPage(here)
        ? `${CONVERSATIONS}/${thread.publicId}`
        : withOverlayOn(here, askToken(thread.publicId)),
    );
  }

  return { asked: true, turn: seq };
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
 * The thread is carried as its public id rather than its row id, because the runner
 * resolves it through the project again -- a thread deleted between the click and the
 * work is then a sentence on the work page instead of a foreign key violation. It is
 * also what reads back the prior findings, so the conversation is used as it stands
 * when the draft actually runs rather than as it stood when the button was pressed.
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

  const blocked = await agentUnavailable();
  if (blocked) return { error: blocked };

  const ip = await clientIp();

  const job = await enqueueWork({
    projectId: scope.projectId,
    userId: scope.userId,
    type: 'draft_plan',
    label: name ?? brief,
    request: {
      brief,
      baseUrl,
      conversation: conversation.publicId,
      ...(name ? { name } : {}),
      ...(ip ? { ip } : {}),
    },
  });

  after(() => runWork(job));

  /* Nothing to revalidate here any more. The plan count on both conversation surfaces
     changes when the plan is written, which is now the runner's job -- and it
     revalidates both of those paths itself. */
  redirect(WORK);
}
