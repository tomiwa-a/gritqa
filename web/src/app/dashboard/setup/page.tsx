import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { SetupFlow } from '@/components/app/setup/setup-flow';
import { Icon } from '@/components/ui/icon';
import { getCoverageTotals, getCurrentProjectOrNull, getUser } from '@/lib/data';

export const metadata = { title: 'CLI setup · GritQA' };

const SPLIT = [
  {
    icon: 'terminal' as const,
    title: 'On your machine',
    body: 'Reading your routes and models, running the tests, holding your source. Nothing leaves the folder unless you ask for a draft.',
  },
  {
    icon: 'panel' as const,
    title: 'In this dashboard',
    body: 'Plans waiting on you, run history, the rules your team agreed on, and the mock endpoints your tests lean on.',
  },
];

const SNAGS = [
  {
    q: 'command not found: gritqa',
    a: 'The binary is not on your PATH yet. With Go, that is usually ~/go/bin.',
  },
  {
    q: 'It cannot find my project',
    a: 'Run it from the directory holding your go.mod, package.json, or requirements.txt.',
  },
  {
    q: 'Nothing showed up here',
    a: 'The first read takes a moment on a large repo. The topbar pill turns green when it lands.',
  },
];

export default async function SetupPage() {
  const [user, currentProject, coverageTotals] = await Promise.all([
    getUser(),
    getCurrentProjectOrNull(),
    getCoverageTotals(),
  ]);

  /* How far the setup has actually got, read off the record rather than stored.
     No project yet means nothing is done — which is exactly when this page matters. */
  const done =
    (currentProject?.lastIndexedLabel ? 2 : 0) +
    (user.hasAiKey ? 1 : 0) +
    (coverageTotals.approved > 0 ? 1 : 0);
  return (
    <>
      <Topbar icon="terminal" title="CLI setup" />
      <PageBody>
        <AppPageHeader
          title="Get the CLI on this machine"
          description="GritQA works from inside your project. This is the whole of it — install, connect, pick a provider, approve what it writes."
        />

        <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <SetupFlow done={done} aiKeyMasked={user.aiKeyMasked} />

          <aside className="flex flex-col gap-4">
            <div className="rounded-xl border border-rule bg-app-panel p-4 shadow-panel">
              <h3 className="text-[13px] font-medium text-ink">Where the work happens</h3>
              <div className="mt-3 flex flex-col gap-3">
                {SPLIT.map((item) => (
                  <div key={item.title} className="flex items-start gap-2.5">
                    <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rule bg-app text-ink-subtle">
                      <Icon name={item.icon} size={13} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">
                        {item.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-rule bg-app-panel p-4 shadow-panel">
              <h3 className="text-[13px] font-medium text-ink">If it does not go smoothly</h3>
              <dl className="mt-3 flex flex-col divide-y divide-rule-soft">
                {SNAGS.map((snag) => (
                  <div key={snag.q} className="py-2.5 first:pt-0 last:pb-0">
                    <dt className="font-mono text-[12px] text-ink">{snag.q}</dt>
                    <dd className="mt-1 text-[12.5px] leading-snug text-ink-muted">{snag.a}</dd>
                  </div>
                ))}
              </dl>
              <Link
                href="mailto:support@gritqa.dev"
                className="mt-3 inline-flex items-center gap-1.5 border-t border-rule-soft pt-3 text-[12.5px] font-medium text-ink transition-colors duration-150 hover:text-punch-red"
              >
                <Icon name="help" size={13} />
                Still stuck — email us
              </Link>
            </div>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
