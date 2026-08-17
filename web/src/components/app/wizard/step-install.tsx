import { Icon } from '@/components/ui/icon';
import { CopyCommand } from '../copy-command';
import { PlatformPicker, type OsKey } from './platform-picker';

export function StepInstall({ os, hrefFor }: { os: OsKey; hrefFor: (os: OsKey) => string }) {
  return (
    <div className="flex flex-col gap-4">
      <CopyCommand label="With Go on your machine" command="go install github.com/gritqa/cli@latest" />

      <PlatformPicker os={os} hrefFor={hrefFor} />

      <a
        href="https://github.com/gritqa/cli/releases"
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2.5 rounded-lg border border-rule px-3 py-2.5 transition-colors duration-150 hover:border-ink/20 hover:bg-app"
      >
        <Icon name="github" size={15} className="text-ink" />
        <span className="min-w-0 flex-1 text-[12.5px] text-ink-muted">
          <span className="font-medium text-ink">GitHub Releases</span> — builds for macOS, Linux,
          and Windows
        </span>
        <Icon
          name="external"
          size={13}
          className="text-ink-subtle transition-colors duration-150 group-hover:text-ink"
        />
      </a>

      <CopyCommand label="Check it landed" command="gritqa --version" />
    </div>
  );
}
