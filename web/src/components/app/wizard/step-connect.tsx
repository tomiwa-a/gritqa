import { CodeBlock } from '@/components/ui/code-block';
import { Icon } from '@/components/ui/icon';
import { CopyCommand } from '../copy-command';

const CONFIG = `project: payments-api
path: ~/code/payments-api
branch: main
`;

const FIRST_RUN = [
  'Reads your routers, handlers, and models to learn the shape of your API',
  'Writes .gritqa/config.yaml so the next run knows where it is',
  'Links this machine to your account — no keys to copy around',
];

export function StepConnect() {
  return (
    <div className="flex flex-col gap-4">
      <CopyCommand label="In your project folder" command="gritqa" />

      <ul className="flex flex-col gap-2">
        {FIRST_RUN.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
            <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
            {line}
          </li>
        ))}
      </ul>

      <CodeBlock
        filename=".gritqa/config.yaml"
        lang="yaml"
        lineNumbers={false}
        code={CONFIG}
        caption="Written on the first run. Commit it if you want your team on the same project."
      />

      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        Every run after the first only looks at what changed, so it stays quick on a big repo.
      </p>
    </div>
  );
}
