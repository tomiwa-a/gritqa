import { Icon } from '@/components/ui/icon';

/**
 * What the plan took on faith, said out loud.
 *
 * Drafting is one-shot on purpose -- somebody who typed a brief and pressed *Draft it*
 * chose a proposal to read, not an interview -- and the cost of that choice is that
 * the model cannot ask "which guest?". It has to guess, and the schema has no branch
 * for a question, so this is where the guess goes: above the steps, in a list, where
 * an assumption you disagree with is one you can reject before anything runs.
 *
 * `summary` already asks the model to admit what it could not establish, and prose is
 * where an admission goes to be skimmed past. A list is read.
 *
 * Nothing renders when there are none, which is the outcome to aim for and not the
 * common one. An older plan has an empty list because the field did not exist when it
 * was written, and silence is the honest rendering of that too.
 */
export function Assumptions({ assumptions }: { assumptions: string[] }) {
  return (
    <ul className="flex flex-col">
      {assumptions.map((assumption, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5 border-b border-rule-soft px-4 py-2.5 last:border-b-0"
        >
          <Icon name="alert" size={13} className="mt-[3px] shrink-0 text-warn" />
          <p className="text-[13px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
            {assumption}
          </p>
        </li>
      ))}
    </ul>
  );
}
