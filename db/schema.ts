import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * A person. Starts as an anonymous guest; registering attaches a unique
 * username + password hash to the same row, keeping room history intact.
 */
export const profiles = pgTable('profiles', {
  id: uuid().primaryKey().defaultRandom(),
  /** Lowercase handle for login and friend search. Null for guests. */
  username: text().unique(),
  passwordHash: text('password_hash'),
  /** Stable subject id from the OAuth broker (Google / GitHub sign-in). */
  oauthSub: text('oauth_sub').unique(),
  /** Email from the OAuth provider; informational, not a login key. */
  email: text(),
  name: text().notNull(),
  avatar: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** One row per signed-in device. The browser only holds the opaque token. */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('sessions_profile_idx').on(t.profileId)],
)

/** Friend graph. One row per request; status 'pending' → 'accepted'. */
export const friendships = pgTable(
  'friendships',
  {
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    status: text().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    index('friendships_addressee_idx').on(t.addresseeId, t.status),
  ],
)

/** A direct-message conversation between two friends (userAId < userBId). */
export const dmThreads = pgTable(
  'dm_threads',
  {
    id: uuid().primaryKey().defaultRandom(),
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('dm_threads_pair_idx').on(t.userAId, t.userBId),
    index('dm_threads_b_idx').on(t.userBId),
  ],
)

export const dmMessages = pgTable(
  'dm_messages',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThreads.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    /** 'text' | 'call' (call log lines). */
    kind: text().notNull().default('text'),
    text: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('dm_messages_thread_idx').on(t.threadId, t.id)],
)

/** Read markers per person per thread, for unread counts. */
export const dmReads = pgTable(
  'dm_reads',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThreads.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    lastReadId: bigint('last_read_id', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.profileId] })],
)

/** 1:1 voice/video calls inside a DM thread. */
export const calls = pgTable(
  'calls',
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThreads.id, { onDelete: 'cascade' }),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** 'voice' | 'video' */
    kind: text().notNull(),
    /** 'ringing' | 'active' | 'ended' | 'declined' | 'missed' */
    status: text().notNull().default('ringing'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('calls_thread_idx').on(t.threadId, t.createdAt)],
)

export const rooms = pgTable(
  'rooms',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    name: text().notNull(),
    description: text().notNull().default(''),
    visibility: text().notNull().default('public'),
    passwordHash: text('password_hash'),
    capacity: integer().notNull().default(12),
    locked: boolean().notNull().default(false),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('rooms_owner_idx').on(t.ownerId),
    index('rooms_visibility_idx').on(t.visibility, t.endedAt),
  ],
)

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    removed: boolean().notNull().default(false),
    /** True while the member is in the room (drives online state + join/leave notices). */
    present: boolean().notNull().default(true),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.profileId] }),
    index('room_members_seen_idx').on(t.roomId, t.lastSeenAt),
  ],
)

export const roomMessages = pgTable(
  'room_messages',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    /** 'user' | 'system' | 'reaction' */
    type: text().notNull(),
    text: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('room_messages_room_idx').on(t.roomId, t.id),
    index('room_messages_author_idx').on(t.profileId, t.createdAt),
  ],
)

export const roomVideos = pgTable(
  'room_videos',
  {
    id: uuid().primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    src: text().notNull(),
    kind: text().notNull(),
    duration: integer().notNull().default(0),
    thumbnail: text().notNull(),
    addedBy: text('added_by').notNull(),
    sort: integer().notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('room_videos_room_idx').on(t.roomId, t.sort)],
)

/** Single source of truth for shared playback. Only the owner writes it. */
export const roomPlayback = pgTable('room_playback', {
  roomId: uuid('room_id')
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  videoId: uuid('video_id'),
  playing: boolean().notNull().default(false),
  position: real().notNull().default(0),
  rate: real().notNull().default(1),
  subtitle: text().notNull().default('off'),
  audio: text().notNull().default('default'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
