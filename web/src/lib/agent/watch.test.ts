import { describe, expect, it } from 'vitest';
import { recordOutcomes, type WorkNote } from './watch';

function collecting() {
  const notes: WorkNote[] = [];
  return {
    notes,
    watch: {
      note: (note: WorkNote) => {
        notes.push(note);
      },
    },
  };
}

describe('recordOutcomes', () => {
  it('pairs a db result with its call as a measurement', () => {
    const { notes, watch } = collecting();
    recordOutcomes(watch, 'research', [
      { type: 'tool-call', toolName: 'db', input: { sql: 'SELECT * FROM guests' } },
      { type: 'tool-result', output: { rows: [{}, {}, {}], columns: ['id'] } },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('tool');
    expect(notes[0].label).toContain('3 rows');
    expect(notes[0].label).toContain('SELECT * FROM guests');
    expect(notes[0].detail).toEqual({ tool: 'db', outcome: '3 rows' });
  });

  it('records a failed call with a one-line reason', () => {
    const { notes, watch } = collecting();
    recordOutcomes(watch, 'research', [
      { type: 'tool-call', toolName: 'read_file', input: { path: 'api/nope.php' } },
      { type: 'tool-error', error: 'not found in project' },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].label).toContain('failed: not found in project');
    expect(notes[0].detail).toEqual({ tool: 'read_file', failed: true });
  });

  it('skips a success that carries no measurement', () => {
    const { notes, watch } = collecting();
    recordOutcomes(watch, 'research', [
      { type: 'tool-call', toolName: 'teardown', input: {} },
      { type: 'tool-result', output: { ok: true } },
    ]);
    expect(notes).toHaveLength(0);
  });

  it('leaves a dangling call to its start note', () => {
    const { notes, watch } = collecting();
    recordOutcomes(watch, 'research', [
      { type: 'tool-call', toolName: 'db', input: { sql: 'SELECT 1' } },
    ]);
    expect(notes).toHaveLength(0);
  });

  it('measures sandbox boots and search matches', () => {
    const { notes, watch } = collecting();
    recordOutcomes(watch, 'research', [
      { type: 'tool-call', toolName: 'start_sandbox', input: {} },
      { type: 'tool-result', output: { base_url: 'http://127.0.0.1:1', tables: [] } },
      { type: 'tool-call', toolName: 'search', input: { query: 'permission' } },
      { type: 'tool-result', output: { matches: [{}, {}], files_searched: 9 } },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0].label).toContain('sandbox up');
    expect(notes[1].label).toContain('2 matches in 9 files');
  });
});
