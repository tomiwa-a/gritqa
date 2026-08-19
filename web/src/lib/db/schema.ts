import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Every table carries the dual-ID pattern from `plan/technical/entities.md`: a
 * BIGINT `id` for foreign keys, which never leaves the server, and a UUIDv7
 * `public_id` for anything a URL or an API response can see. Sequential integers
 * in URLs leak how many rows exist and let one user guess at another's; v7 keeps
 * the time-ordering that makes an index useful without being enumerable.
 *
 * `uuid_generate_v7()` is defined in `drizzle/0000_identity.sql`. Postgres only
 * ships a v7 generator from 18 onward, and this runs on 16.
 */
const identity = {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  publicId: uuid('public_id')
    .notNull()
    .unique()
    .default(sql`uuid_generate_v7()`),
};

const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const providerEnum = pgEnum('provider', ['github', 'gitlab']);
export const projectStatusEnum = pgEnum('project_status', ['active', 'archived']);
export const deviceCodeStatusEnum = pgEnum('device_code_status', [
  'pending',
  'approved',
  'denied',
  'claimed',
]);

export const users = pgTable(
  'users',
  {
    ...identity,
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    avatarUrl: text('avatar_url'),
    provider: providerEnum('provider').notNull(),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    /** AES-256-GCM ciphertext, never a readable key. See `src/lib/crypto.ts`. */
    aiApiKey: text('ai_api_key'),
    ...stamps,
  },
  (t) => [uniqueIndex('users_provider_identity_idx').on(t.provider, t.providerId)],
);

export const projects = pgTable(
  'projects',
  {
    ...identity,
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    repoUrl: text('repo_url'),
    /** Absolute path on the developer's machine. The web app never reads it. */
    localPath: text('local_path').notNull(),
    defaultBranch: varchar('default_branch', { length: 255 }).notNull().default('main'),
    status: projectStatusEnum('status').notNull().default('active'),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [
    index('projects_user_idx').on(t.userId),
    uniqueIndex('projects_user_local_path_idx').on(t.userId, t.localPath),
  ],
);

/**
 * The dashboard's mirror of the index the CLI built. The CLI's own SQLite beside
 * the files is authoritative -- it can answer about the working tree as it is
 * right now -- so nothing correctness-bearing reads from this table. It exists so
 * `/dashboard/codebase` has something to render and so a project's file count is
 * a real count rather than a stored number that can drift.
 */
export const codebaseIndex = pgTable(
  'codebase_index',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    language: varchar('language', { length: 50 }).notNull(),
    symbols: jsonb('symbols')
      .notNull()
      .default(sql`'[]'::jsonb`),
    dependencies: jsonb('dependencies')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Endpoints the CLI parsed out of this file. Counted for the overview. */
    endpoints: jsonb('endpoints')
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }).notNull().defaultNow(),
    ...stamps,
  },
  (t) => [uniqueIndex('codebase_index_project_file_idx').on(t.projectId, t.filePath)],
);

/**
 * One CLI sign-in attempt. Not in `entities.md`, because the device flow was
 * described as a screen rather than as state.
 *
 * Two codes, and the split is the security of it. `user_code` is short enough to
 * read off a terminal and type into a browser (`GRIT-4K2P`), so it is guessable
 * and confers nothing on its own -- approving it requires a signed-in session.
 * `device_code` is the long secret only the CLI ever holds, and only a SHA-256 of
 * it is stored, so a dump of this table cannot be replayed to claim a token.
 *
 * Rows are short-lived by design: `expires_at` is minutes out, and a claimed row
 * keeps no secret.
 */
export const deviceCodes = pgTable(
  'device_codes',
  {
    ...identity,
    userCode: varchar('user_code', { length: 12 }).notNull().unique(),
    deviceCodeHash: varchar('device_code_hash', { length: 64 }).notNull().unique(),
    status: deviceCodeStatusEnum('status').notNull().default('pending'),
    /** Set when a signed-in human approves, which is the only way it gets set. */
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'cascade',
    }),
    projectId: bigint('project_id', { mode: 'number' }).references(() => projects.id, {
      onDelete: 'set null',
    }),
    /** What the CLI told us about itself, for the approval screen to show. */
    hostname: varchar('hostname', { length: 255 }),
    localPath: text('local_path'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [index('device_codes_expires_idx').on(t.expiresAt)],
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  files: many(codebaseIndex),
}));

export const codebaseIndexRelations = relations(codebaseIndex, ({ one }) => ({
  project: one(projects, { fields: [codebaseIndex.projectId], references: [projects.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type DeviceCodeRow = typeof deviceCodes.$inferSelect;
