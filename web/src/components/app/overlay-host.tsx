import { GenerateModal } from './generate/generate-modal';
import { PlanConversation } from './plan/plan-conversation';
import { PlanPreview } from './plan/plan-preview';
import { RunPreview } from './run-preview';
import { RuleDrawer } from './rules/rule-drawer';
import { RuleEditor } from './rules/rule-editor';
import { parseOverlay, withOverlay, withoutOverlay, type PageParams } from '@/lib/overlay';

/**
 * Every page that can host an overlay renders this once, at the end. It reads the
 * one param that decides what is open — an unknown token opens nothing, the same
 * way an unknown `?plan=` selects nothing.
 */
export function OverlayHost({ params, pathname }: { params: PageParams; pathname: string }) {
  const open = typeof params.open === 'string' ? params.open : undefined;
  const token = parseOverlay(open);
  if (!token) return null;

  const closeHref = withoutOverlay(pathname, params);
  const swapTo = (next: string) => withOverlay(pathname, params, next);

  if (token.kind === 'generate') {
    return <GenerateModal params={params} pathname={pathname} closeHref={closeHref} />;
  }

  if (token.kind === 'ask') {
    return <PlanConversation id={token.id} closeHref={closeHref} />;
  }

  if (token.kind === 'rule') {
    /* One token, two jobs: reading a rule is a panel, writing one is a box. */
    return token.id === 'new' ? (
      <RuleEditor closeHref={closeHref} />
    ) : (
      <RuleDrawer id={token.id} closeHref={closeHref} />
    );
  }

  if (token.kind === 'run') {
    return <RunPreview id={token.id} closeHref={closeHref} planDrawerHref={swapTo} />;
  }

  return (
    <PlanPreview
      id={token.id}
      closeHref={closeHref}
      runDrawerHref={swapTo}
      askDrawerHref={swapTo}
    />
  );
}
