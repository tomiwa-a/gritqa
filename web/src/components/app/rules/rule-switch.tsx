'use client';

import { useFormStatus } from 'react-dom';
import { Switch } from '@/components/ui/switch';
import { toggleRuleAction } from '@/lib/actions/rules';

/**
 * The switch that actually turns a rule off.
 *
 * A form rather than an `onClick`, so it works with JavaScript off -- which is why
 * the server action is handed to `action` directly. Wrapping it in an inline
 * function to flip a local value first would look equivalent and quietly not be:
 * React can only render a real form target for a server reference, and an inline
 * action makes it emit `action="javascript:throw ..."` instead. The rendered HTML
 * is the check, not the intent.
 *
 * So the optimism comes from the submission itself. `useFormStatus` reports on the
 * form above it in the tree, and while a write is in flight the answer is already
 * known -- the switch shows where it is going rather than waiting on a round trip
 * and a revalidate to move, which reads as a broken control even when it works.
 *
 * The action reads nothing but the rule's public id: what "off" means is derived
 * from the row, not sent by the browser, so two tabs cannot race into both
 * believing they turned it on.
 */
export function RuleSwitch({
  publicId,
  name,
  isActive,
}: {
  publicId: string;
  name: string;
  isActive: boolean;
}) {
  return (
    <form action={toggleRuleAction} className="shrink-0">
      <input type="hidden" name="publicId" value={publicId} />
      <Toggle name={name} isActive={isActive} />
    </form>
  );
}

function Toggle({ name, isActive }: { name: string; isActive: boolean }) {
  const { pending } = useFormStatus();
  const on = pending ? !isActive : isActive;
  return <Switch type="submit" on={on} label={`Turn ${name} ${on ? 'off' : 'on'}`} />;
}
