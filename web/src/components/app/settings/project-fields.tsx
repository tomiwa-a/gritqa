'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SettingRow } from './setting-row';

export function ProjectFields({ name, branch }: { name: string; branch: string }) {
  const [fields, setFields] = useState({ name, branch });
  const [baseline, setBaseline] = useState({ name, branch });
  const [saved, setSaved] = useState(false);

  const dirty = fields.name !== baseline.name || fields.branch !== baseline.branch;

  return (
    <>
      <SettingRow
        label="Project name"
        hint="What you see in the switcher and on every plan."
        control={
          <Input
            dense
            value={fields.name}
            onChange={(e) => {
              setFields((f) => ({ ...f, name: e.target.value }));
              setSaved(false);
            }}
            className="w-[220px]"
            aria-label="Project name"
          />
        }
      />

      <SettingRow
        label="Branch to watch"
        hint="Pushes here are what start a draft."
        control={
          <Input
            dense
            value={fields.branch}
            onChange={(e) => {
              setFields((f) => ({ ...f, branch: e.target.value }));
              setSaved(false);
            }}
            className="w-[220px] font-mono"
            aria-label="Branch to watch"
          />
        }
      />

      <div className="flex items-center gap-3 border-b border-rule-soft px-4 py-3 last:border-b-0">
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => {
            setBaseline(fields);
            setSaved(true);
          }}
        >
          Save changes
        </Button>

        {saved && !dirty && (
          <span className="flex items-center gap-1.5 text-[12px] text-pass">
            <Icon name="check" size={13} />
            Saved
          </span>
        )}

        {dirty && <span className="text-[12px] text-ink-subtle">Unsaved edits</span>}
      </div>
    </>
  );
}
