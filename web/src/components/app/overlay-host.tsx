import { ApproveConfirm } from './plan/approve-confirm';
import { AskPanel } from './ask/ask-panel';
import { GenerateModal } from './generate/generate-modal';
import { NewProjectModal } from './project/new-project-modal';
import { PlanConversation } from './plan/plan-conversation';
import { PlanPreview } from './plan/plan-preview';
import { RunPreview } from './run-preview';
import { RuleDrawer } from './rules/rule-drawer';
import { RuleEditor } from './rules/rule-editor';
import { getRules } from '@/lib/data';
import {
  parseOverlay,
  ruleToken,
  withOverlay,
  withoutOverlay,
  type PageParams,
} from '@/lib/overlay';

/**
 * Every page that can host an overlay renders this once, at the end. It reads the
 * one param that decides what is open — an unknown token opens nothing, the same
 * way an unknown `?plan=` selects nothing.
 */
export async function OverlayHost({ params, pathname }: { params: PageParams; pathname: string }) {
  const open = typeof params.open === 'string' ? params.open : undefined;
  const token = parseOverlay(open);
  if (!token) return null;

  const closeHref = withoutOverlay(pathname, params);
  const swapTo = (next: string) => withOverlay(pathname, params, next);

  if (token.kind === 'generate') {
    return <GenerateModal params={params} pathname={pathname} closeHref={closeHref} />;
  }

  if (token.kind === 'new-project') {
    return <NewProjectModal closeHref={closeHref} />;
  }

  if (token.kind === 'approve') {
    return <ApproveConfirm id={token.id} closeHref={closeHref} />;
  }

  if (token.kind === 'refine') {
    return <PlanConversation id={token.id} closeHref={closeHref} />;
  }

  if (token.kind === 'ask') {
    /* One token, two jobs, the same way `rule:` reads and writes: a conversation named
       is the thread, and `ask:new` is the box with your earlier ones under it. */
    return <AskPanel id={token.id} closeHref={closeHref} hrefFor={swapTo} />;
  }

  if (token.kind === 'rule') {
    /* One token, three jobs: reading a rule is a panel, writing one is a box, and
       editing one is the same box over a rule that already exists. */
    if (token.id === 'new') return <RuleEditor closeHref={closeHref} />;

    if (params.edit === '1') {
      const rule = (await getRules()).find((r) => r.publicId === token.id);
      /* A rule deleted in another tab: fall through to the drawer, which says so. */
      if (rule) return <RuleEditor closeHref={closeHref} rule={rule} />;
    }

    return (
      <RuleDrawer
        id={token.id}
        closeHref={closeHref}
        editHref={withOverlay(pathname, params, ruleToken(token.id), { edit: '1' })}
      />
    );
  }

  if (token.kind === 'run') {
    return <RunPreview id={token.id} closeHref={closeHref} planDrawerHref={swapTo} />;
  }

  if (token.kind === 'plan') {
    return (
      <PlanPreview
        id={token.id}
        closeHref={closeHref}
        runDrawerHref={swapTo}
        refineDrawerHref={swapTo}
      />
    );
  }

  return null;
}
