import { Segmented } from '@/components/ui/segmented';
import { Icon } from '@/components/ui/icon';
import { CopyCommand } from '../copy-command';

export type OsKey = 'mac' | 'linux' | 'windows';

export const OS_KEYS: OsKey[] = ['mac', 'linux', 'windows'];

const OPTIONS: { key: OsKey; label: string }[] = [
  { key: 'mac', label: 'macOS' },
  { key: 'linux', label: 'Linux' },
  { key: 'windows', label: 'Windows' },
];

const PLACEMENT: Record<OsKey, { command: string; note: string }> = {
  mac: {
    command: 'tar -xzf gritqa_*.tar.gz && sudo mv gritqa /usr/local/bin/',
    note: 'If macOS refuses to open it, clear the download flag: xattr -d com.apple.quarantine /usr/local/bin/gritqa',
  },
  linux: {
    command: 'tar -xzf gritqa_*.tar.gz && sudo mv gritqa /usr/local/bin/',
    note: 'No sudo? Move it to ~/.local/bin instead and make sure that is on your PATH.',
  },
  windows: {
    command: 'Expand-Archive gritqa_*.zip -DestinationPath .',
    note: 'Then add the folder you unpacked it into to your PATH, and open a new terminal.',
  },
};

export function PlatformPicker({ os, hrefFor }: { os: OsKey; hrefFor: (os: OsKey) => string }) {
  const placement = PLACEMENT[os];

  return (
    <div className="rounded-lg border border-rule bg-app p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-ink">Or unpack the binary yourself</p>
        <Segmented
          label="Pick your operating system"
          active={os}
          options={OPTIONS.map((option) => ({
            key: option.key,
            label: option.label,
            href: hrefFor(option.key),
          }))}
        />
      </div>

      <CopyCommand className="mt-3" command={placement.command} />

      <p className="mt-2.5 flex items-start gap-2 text-[11.5px] leading-snug text-ink-muted">
        <Icon name="alert" size={13} className="mt-[2px] shrink-0 text-ink-subtle" />
        {placement.note}
      </p>
    </div>
  );
}
