import type { Commit, PlanDiffContext } from './mock/types';

/**
 * `from` is inclusive: it names the oldest commit in the range, because that is
 * what picking a row out of the history means. Commits are newest first.
 */
function indexOf(commits: Commit[], from: string) {
  return commits.findIndex((c) => c.shortHash === from || c.hash === from);
}

export function resolveFrom(commits: Commit[], asked: string | undefined, fallback: string) {
  if (!asked) return fallback;
  return indexOf(commits, asked) >= 0 ? asked : fallback;
}

/** The commits a draft would be written from: this one and everything newer. */
export function commitsFrom(commits: Commit[], from: string): Commit[] {
  const at = indexOf(commits, from);
  return at < 0 ? [] : commits.slice(0, at + 1);
}

export function isInRange(commits: Commit[], from: string, commit: Commit) {
  const at = indexOf(commits, from);
  return at >= 0 && commits.indexOf(commit) <= at;
}

/**
 * Collapses a range of commits into one diff. Files only — which endpoints a
 * change reaches is not knowable from a diff, so nothing here guesses at them.
 */
export function diffFrom(commits: Commit[], from: string): PlanDiffContext | null {
  const range = commitsFrom(commits, from);
  if (range.length === 0) return null;

  const byPath = new Map<string, { path: string; additions: number; deletions: number }>();
  for (const commit of range) {
    for (const file of commit.files) {
      const seen = byPath.get(file.path);
      if (seen) {
        seen.additions += file.additions;
        seen.deletions += file.deletions;
      } else {
        byPath.set(file.path, { ...file });
      }
    }
  }

  const files = [...byPath.values()].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  );

  const newest = range[0];

  return {
    branch: newest.branch,
    commit: newest.shortHash,
    message: newest.subject,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    files,
    commitCount: range.length,
  };
}

/** Search accepts a hash prefix, or any words from the subject or author. */
export function matchesCommit(commit: Commit, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    commit.hash.startsWith(q) ||
    commit.shortHash.startsWith(q) ||
    commit.subject.toLowerCase().includes(q) ||
    commit.author.toLowerCase().includes(q)
  );
}

export function searchCommits(commits: Commit[], query: string | undefined) {
  if (!query?.trim()) return commits;
  return commits.filter((c) => matchesCommit(c, query));
}

export function churnOf(commit: Commit) {
  return commit.files.reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}
