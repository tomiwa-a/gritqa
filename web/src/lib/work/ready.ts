import { drafting, researchConfigured } from '@/lib/agent';

/**
 * Whether there is any point in asking for agent work.
 *
 * Queueing work moves failures out of the developer's sight, which is right for the
 * failures nobody could have predicted -- a model that returned nonsense, a route the
 * agent could not find -- and wrong for the two that are knowable before anything
 * starts. There is no key, or there is no machine: both are settings, both take one
 * cheap read to establish, and both would otherwise turn a click into a row on the
 * work page that says the same thing a minute later, after the developer has already
 * navigated to it to find out.
 *
 * So the form keeps its instant answer for exactly these two, and everything past
 * them is the queue's business. Neither check builds anything: `drafting()` decides
 * what *would* be used without resolving a model, and `researchConfigured()` asks
 * whether an address exists without opening a connection to it.
 *
 * It is a pre-flight and not a guarantee. A machine can disconnect between this and
 * the work, and then `CliUnavailableError` lands on the job where it belongs -- the
 * point is not to make that impossible, it is to stop the common case being told
 * badly.
 */
export async function agentUnavailable(): Promise<string | null> {
  if (!(await drafting()).on) {
    return 'No model key yet, so there is nothing to draft with. Add one in Settings → AI.';
  }
  if (!(await researchConfigured())) {
    return 'No machine is connected for this project, so GritQA has no way to read the code. Run `gritqa` in the project and try again.';
  }
  return null;
}
