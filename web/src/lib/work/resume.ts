import { after } from 'next/server';
import { reapHopeless, unattendedWork } from '@/lib/db/work';
import { readSession } from '@/lib/session';
import { runWork } from '@/lib/work/run';

/**
 * The scheduler, such as it is: somebody opened the page.
 *
 * There is no worker process. Work starts in `after()` on the request that asked for
 * it, and anything that never started -- or that was started by a process which has
 * since stopped speaking -- is picked up here. So the resume is triggered by a person
 * looking, which is a real limit and a deliberate one: a resident worker is a
 * deployment shape to choose once, not a thing to guess at while the idea is being
 * validated.
 *
 * All of it inside `after()`, including the two reads that decide what to run, so a
 * page whose job is to show what is happening is not itself waiting on Postgres to
 * write before it renders. That costs one thing worth naming: the row a resume just
 * revived is `pending` in the list the reader is looking at, and `claimed` a poll
 * later. Cheaper than the alternative, and the poller is four seconds away.
 *
 * Safe to call from a render. `runWork` never throws, and the session is read before
 * `after()` so that `storedKey` does not have to call `cookies()` inside it.
 */
export async function resumeWork(projectId: number): Promise<void> {
  /* Read the session before `after()`. Server Components can call `cookies()`, but
     `after()` callbacks cannot. The session is passed to `runWork` so the agent can
     resolve the developer's AI key without reading cookies inside the callback. */
  const session = await readSession();
  after(async () => {
    try {
      /* First, because a job that has spent its attempts must stop being offered:
         `unattendedWork` filters on `attempts < max_attempts`, and this is what marks
         the rest dead so the list can say so. */
      await reapHopeless(projectId);
      const ids = await unattendedWork(projectId);
      /* Together rather than in turn. Two drafts asked for a minute apart already run
         at the same time -- each in its own `after()` -- so a resume that ran them one
         after another would make recovery slower than the thing it is recovering. */
      await Promise.all(ids.map((id) => runWork(id, session)));
    } catch (error) {
      console.error('work: could not resume', error);
    }
  });
}
