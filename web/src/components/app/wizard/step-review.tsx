import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';

const CHECKS = [
  'Every step in order, with the request body it will send',
  'The values carried from one step into the next',
  'Each assertion, and what it is checking for',
];

const PATHS: { href: string; icon: IconName; title: string; body: string }[] = [
  {
    href: '/dashboard/settings/ai',
    icon: 'sparkle',
    title: 'Let GritQA draft them',
    body: 'Add your model key in settings and it drafts from whatever you push.',
  },
  {
    href: '/dashboard/test-plans',
    icon: 'plan',
    title: 'Write them yourself',
    body: 'No key, no drafting. Write plans by hand and GritQA just runs them.',
  },
];

export function StepReview() {
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {CHECKS.map((check) => (
          <li key={check} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
            <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
            {check}
          </li>
        ))}
      </ul>

      <div className="border-t border-rule-soft pt-4">
        <p className="text-[12.5px] font-medium text-ink">Who writes the first draft?</p>
        <div className="mt-2.5 flex flex-col gap-2">
          {PATHS.map((path) => (
            <Link
              key={path.href}
              href={path.href}
              className="group flex items-start gap-3 rounded-lg border border-rule p-3 transition-colors duration-150 hover:border-ink/20 hover:bg-app"
            >
              <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule bg-app text-ink-muted transition-colors duration-150 group-hover:text-ink">
                <Icon name={path.icon} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{path.title}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">
                  {path.body}
                </span>
              </span>
              <Icon
                name="chevronRight"
                size={14}
                className="mt-1.5 text-ink-subtle transition-colors duration-150 group-hover:text-ink"
              />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
