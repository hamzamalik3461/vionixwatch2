import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import {
  calls,
  dmMessages,
  dmReads,
  dmThreads,
  profiles,
} from '../../db/schema.js'
import type {
  ApiCall,
  ApiDmMessage,
  ApiThreadSummary,
  CallKind,
  IncomingCall,
} from '@/lib/social-types'
import { requireFriends, toFriend } from './friends'
import { HttpError } from './http'
import type { SessionProfile } from './session'

/** An unanswered call stops ringing after this long and counts as missed. */
const RING_MS = 45_000

export type ThreadRow = typeof dmThreads.$inferSelect
type CallRow = typeof calls.$inferSelect

const pair = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a]

/** Finds or creates the conversation between two friends. */
export async function openThread(meId: string, friendId: string) {
  await requireFriends(meId, friendId)
  const [a, b] = pair(meId, friendId)
  const [existing] = await db
    .select()
    .from(dmThreads)
    .where(and(eq(dmThreads.userAId, a), eq(dmThreads.userBId, b)))
    .limit(1)
  if (existing) return existing
  const [row] = await db
    .insert(dmThreads)
    .values({ userAId: a, userBId: b })
    .returning()
  return row
}

/** Loads a thread the caller belongs to, plus the other side's profile. */
export async function requireThread(threadId: string, meId: string) {
  const [row] = await db
    .select()
    .from(dmThreads)
    .where(eq(dmThreads.id, threadId))
    .limit(1)
  if (!row || (row.userAId !== meId && row.userBId !== meId))
    throw new HttpError(404, 'Conversation not found')
  const otherId = row.userAId === meId ? row.userBId : row.userAId
  const [other] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, otherId))
    .limit(1)
  if (!other) throw new HttpError(404, 'Conversation not found')
  return { thread: row, other }
}

const toDmMessage = (m: typeof dmMessages.$inferSelect): ApiDmMessage => ({
  id: m.id,
  kind: m.kind === 'call' ? 'call' : 'text',
  senderId: m.senderId,
  text: m.text,
  at: m.createdAt.getTime(),
})

export async function loadDmMessages(
  threadId: string,
  after: number,
): Promise<ApiDmMessage[]> {
  const base = db.select().from(dmMessages)
  const rows =
    after > 0
      ? await base
          .where(
            and(eq(dmMessages.threadId, threadId), gt(dmMessages.id, after)),
          )
          .orderBy(asc(dmMessages.id))
          .limit(200)
      : (
          await base
            .where(eq(dmMessages.threadId, threadId))
            .orderBy(desc(dmMessages.id))
            .limit(100)
        ).reverse()
  return rows.map(toDmMessage)
}

export async function sendDm(
  me: SessionProfile,
  thread: ThreadRow,
  text: string,
  kind: 'text' | 'call' = 'text',
) {
  if (kind === 'text') {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(dmMessages)
      .where(
        and(
          eq(dmMessages.threadId, thread.id),
          eq(dmMessages.senderId, me.id),
          gte(dmMessages.createdAt, new Date(Date.now() - 10_000)),
        ),
      )
    if ((recent?.n ?? 0) >= 8)
      throw new HttpError(429, 'Easy there — sending too fast.')
  }
  const [row] = await db
    .insert(dmMessages)
    .values({ threadId: thread.id, senderId: me.id, kind, text })
    .returning()
  await db
    .update(dmThreads)
    .set({ lastMessageAt: row.createdAt })
    .where(eq(dmThreads.id, thread.id))
  await markRead(me.id, thread.id, row.id)
  return toDmMessage(row)
}

export async function markRead(meId: string, threadId: string, lastId: number) {
  await db
    .insert(dmReads)
    .values({ threadId, profileId: meId, lastReadId: lastId })
    .onConflictDoUpdate({
      target: [dmReads.threadId, dmReads.profileId],
      set: { lastReadId: sql`greatest(${dmReads.lastReadId}, ${lastId})` },
    })
}

async function unreadCount(meId: string, threadId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dmMessages)
    .leftJoin(
      dmReads,
      and(
        eq(dmReads.threadId, dmMessages.threadId),
        eq(dmReads.profileId, meId),
      ),
    )
    .where(
      and(
        eq(dmMessages.threadId, threadId),
        sql`${dmMessages.senderId} is distinct from ${meId}::uuid`,
        sql`${dmMessages.id} > coalesce(${dmReads.lastReadId}, 0)`,
      ),
    )
  return r?.n ?? 0
}

export async function myThreads(meId: string) {
  return db
    .select()
    .from(dmThreads)
    .where(or(eq(dmThreads.userAId, meId), eq(dmThreads.userBId, meId)))
    .orderBy(desc(dmThreads.lastMessageAt))
}

export async function listThreads(meId: string): Promise<ApiThreadSummary[]> {
  const threads = await myThreads(meId)
  const out: ApiThreadSummary[] = []
  for (const t of threads) {
    const otherId = t.userAId === meId ? t.userBId : t.userAId
    const [other] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, otherId))
      .limit(1)
    if (!other) continue
    const [last] = await db
      .select()
      .from(dmMessages)
      .where(eq(dmMessages.threadId, t.id))
      .orderBy(desc(dmMessages.id))
      .limit(1)
    out.push({
      id: t.id,
      friend: toFriend(other),
      lastMessage: last
        ? {
            text: last.text,
            kind: last.kind === 'call' ? 'call' : 'text',
            mine: last.senderId === meId,
          }
        : null,
      lastMessageAt: (last?.createdAt ?? t.createdAt).getTime(),
      unread: await unreadCount(meId, t.id),
    })
  }
  return out
}

export async function unreadTotal(meId: string) {
  const threads = await myThreads(meId)
  let total = 0
  for (const t of threads) total += await unreadCount(meId, t.id)
  return total
}

/* ---------------------------------- calls --------------------------------- */

export const toApiCall = (c: CallRow): ApiCall => ({
  id: c.id,
  threadId: c.threadId,
  callerId: c.callerId,
  kind: c.kind === 'video' ? 'video' : 'voice',
  status:
    c.status === 'active' ||
    c.status === 'ended' ||
    c.status === 'declined' ||
    c.status === 'missed'
      ? c.status
      : 'ringing',
  at: c.createdAt.getTime(),
})

const callLabel = (kind: string) =>
  kind === 'video' ? 'video call' : 'voice call'

/** Rings time out lazily whenever call state is read or written. */
export async function expireStaleCalls(meId: string) {
  const threads = await myThreads(meId)
  if (!threads.length) return
  const stale = await db
    .update(calls)
    .set({ status: 'missed', endedAt: new Date() })
    .where(
      and(
        inArray(
          calls.threadId,
          threads.map((t) => t.id),
        ),
        eq(calls.status, 'ringing'),
        lt(calls.createdAt, new Date(Date.now() - RING_MS)),
      ),
    )
    .returning()
  for (const c of stale)
    await db.insert(dmMessages).values({
      threadId: c.threadId,
      senderId: c.callerId,
      kind: 'call',
      text: `Missed ${callLabel(c.kind)}`,
    })
}

export async function liveCallForThread(threadId: string) {
  const [row] = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.threadId, threadId),
        inArray(calls.status, ['ringing', 'active']),
      ),
    )
    .orderBy(desc(calls.createdAt))
    .limit(1)
  return row ?? null
}

/** The latest call that still matters to the client (live, or just ended). */
export async function pulseCall(meId: string): Promise<ApiCall | null> {
  const threads = await myThreads(meId)
  if (!threads.length) return null
  const [row] = await db
    .select()
    .from(calls)
    .where(
      and(
        inArray(
          calls.threadId,
          threads.map((t) => t.id),
        ),
        or(
          inArray(calls.status, ['ringing', 'active']),
          gte(calls.endedAt, new Date(Date.now() - 15_000)),
        ),
      ),
    )
    .orderBy(desc(calls.createdAt))
    .limit(1)
  return row ? toApiCall(row) : null
}

export async function incomingCall(meId: string): Promise<IncomingCall | null> {
  await expireStaleCalls(meId)
  const threads = await myThreads(meId)
  if (!threads.length) return null
  const [row] = await db
    .select({ c: calls, p: profiles })
    .from(calls)
    .innerJoin(profiles, eq(profiles.id, calls.callerId))
    .where(
      and(
        inArray(
          calls.threadId,
          threads.map((t) => t.id),
        ),
        eq(calls.status, 'ringing'),
        sql`${calls.callerId} <> ${meId}::uuid`,
      ),
    )
    .orderBy(desc(calls.createdAt))
    .limit(1)
  return row ? { ...toApiCall(row.c), from: toFriend(row.p) } : null
}

export async function startCall(
  me: SessionProfile,
  thread: ThreadRow,
  kind: CallKind,
) {
  await expireStaleCalls(me.id)
  if (await liveCallForThread(thread.id))
    throw new HttpError(409, 'A call is already going in this conversation.')
  const [row] = await db
    .insert(calls)
    .values({ threadId: thread.id, callerId: me.id, kind })
    .returning()
  await sendDm(me, thread, `Started a ${callLabel(kind)}`, 'call')
  return row
}

async function requireCall(callId: string, meId: string) {
  const [row] = await db
    .select()
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1)
  if (!row) throw new HttpError(404, 'Call not found')
  const { thread } = await requireThread(row.threadId, meId)
  return { call: row, thread }
}

export async function acceptCall(me: SessionProfile, callId: string) {
  await expireStaleCalls(me.id)
  const { call, thread } = await requireCall(callId, me.id)
  if (call.callerId === me.id)
    throw new HttpError(400, 'You started this call.')
  if (call.status !== 'ringing')
    throw new HttpError(410, 'That call already ended.')
  const [row] = await db
    .update(calls)
    .set({ status: 'active', answeredAt: new Date() })
    .where(and(eq(calls.id, callId), eq(calls.status, 'ringing')))
    .returning()
  if (!row) throw new HttpError(410, 'That call already ended.')
  return { call: row, thread }
}

export async function declineCall(me: SessionProfile, callId: string) {
  const { call, thread } = await requireCall(callId, me.id)
  if (call.callerId === me.id)
    throw new HttpError(400, 'Use end to cancel your own call.')
  if (call.status !== 'ringing') return { call, thread }
  const [row] = await db
    .update(calls)
    .set({ status: 'declined', endedAt: new Date() })
    .where(and(eq(calls.id, callId), eq(calls.status, 'ringing')))
    .returning()
  if (row)
    await sendDm(me, thread, `Declined the ${callLabel(call.kind)}`, 'call')
  return { call: row ?? call, thread }
}

export async function endCall(me: SessionProfile, callId: string) {
  const { call, thread } = await requireCall(callId, me.id)
  if (call.status !== 'ringing' && call.status !== 'active')
    return { call, thread }
  const canceled = call.status === 'ringing' && call.callerId === me.id
  const [row] = await db
    .update(calls)
    .set({ status: 'ended', endedAt: new Date() })
    .where(
      and(eq(calls.id, callId), inArray(calls.status, ['ringing', 'active'])),
    )
    .returning()
  if (row) {
    const seconds = row.answeredAt
      ? Math.max(1, Math.round((Date.now() - row.answeredAt.getTime()) / 1000))
      : 0
    const mins = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    await sendDm(
      me,
      thread,
      canceled
        ? `Canceled the ${callLabel(call.kind)}`
        : row.answeredAt
          ? `${callLabel(call.kind) === 'video call' ? 'Video' : 'Voice'} call · ${mins}`
          : `Call ended`,
      'call',
    )
  }
  return { call: row ?? call, thread }
}
