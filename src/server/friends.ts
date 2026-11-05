import { and, eq, or } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { friendships, profiles } from '../../db/schema.js'
import type {
  ApiFriend,
  ApiFriendRequest,
  FriendsResponse,
} from '@/lib/social-types'
import { normalizeUsername } from './auth'
import { HttpError } from './http'

/** Someone counts as online while their session has been active recently. */
const ONLINE_MS = 120_000

export const isOnline = (lastSeenAt: Date) =>
  Date.now() - lastSeenAt.getTime() < ONLINE_MS

type ProfileRow = typeof profiles.$inferSelect

export function toFriend(p: ProfileRow): ApiFriend {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    username: p.username ?? '',
    online: isOnline(p.lastSeenAt),
  }
}

export async function areFriends(a: string, b: string) {
  const [row] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(
          and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
          and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
        ),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function requireFriends(a: string, b: string) {
  if (!(await areFriends(a, b)))
    throw new HttpError(403, 'You can only do that with friends')
}

export async function listFriends(meId: string): Promise<FriendsResponse> {
  const rows = await db
    .select({ f: friendships, p: profiles })
    .from(friendships)
    .innerJoin(
      profiles,
      or(
        and(
          eq(friendships.requesterId, meId),
          eq(profiles.id, friendships.addresseeId),
        ),
        and(
          eq(friendships.addresseeId, meId),
          eq(profiles.id, friendships.requesterId),
        ),
      ),
    )
    .where(
      or(eq(friendships.requesterId, meId), eq(friendships.addresseeId, meId)),
    )

  const friends: ApiFriend[] = []
  const incoming: ApiFriendRequest[] = []
  const outgoing: ApiFriendRequest[] = []
  for (const { f, p } of rows) {
    const req: ApiFriendRequest = {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      username: p.username ?? '',
      at: f.createdAt.getTime(),
    }
    if (f.status === 'accepted') friends.push(toFriend(p))
    else if (f.addresseeId === meId) incoming.push(req)
    else outgoing.push(req)
  }
  friends.sort((a, b) => Number(b.online) - Number(a.online))
  incoming.sort((a, b) => b.at - a.at)
  outgoing.sort((a, b) => b.at - a.at)
  return { friends, incoming, outgoing }
}

async function pendingBetween(requesterId: string, addresseeId: string) {
  const [row] = await db
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.requesterId, requesterId),
        eq(friendships.addresseeId, addresseeId),
        eq(friendships.status, 'pending'),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Sends a request by username; a request that crosses one coming the other way accepts it. */
export async function sendFriendRequest(meId: string, rawUsername: string) {
  const username = normalizeUsername(rawUsername)
  const [target] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1)
  if (!target) throw new HttpError(404, `No one goes by @${username} here yet.`)
  if (target.id === meId)
    throw new HttpError(400, 'That would be you — pick someone else.')
  if (await areFriends(meId, target.id))
    throw new HttpError(400, `You and @${username} are already friends.`)
  if (await pendingBetween(meId, target.id))
    throw new HttpError(400, 'Request already sent — waiting on them.')
  if (await pendingBetween(target.id, meId)) {
    await acceptFriendRequest(meId, target.id)
    return { accepted: true, friend: toFriend(target) }
  }
  await db
    .insert(friendships)
    .values({ requesterId: meId, addresseeId: target.id })
  return { accepted: false, friend: toFriend(target) }
}

export async function acceptFriendRequest(meId: string, requesterId: string) {
  const row = await pendingBetween(requesterId, meId)
  if (!row) throw new HttpError(404, 'That request is gone.')
  await db
    .update(friendships)
    .set({ status: 'accepted', respondedAt: new Date() })
    .where(
      and(
        eq(friendships.requesterId, requesterId),
        eq(friendships.addresseeId, meId),
      ),
    )
}

export async function declineFriendRequest(meId: string, requesterId: string) {
  await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.requesterId, requesterId),
        eq(friendships.addresseeId, meId),
        eq(friendships.status, 'pending'),
      ),
    )
}

export async function cancelFriendRequest(meId: string, addresseeId: string) {
  await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.requesterId, meId),
        eq(friendships.addresseeId, addresseeId),
        eq(friendships.status, 'pending'),
      ),
    )
}

export async function removeFriend(meId: string, otherId: string) {
  await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(
          and(
            eq(friendships.requesterId, meId),
            eq(friendships.addresseeId, otherId),
          ),
          and(
            eq(friendships.requesterId, otherId),
            eq(friendships.addresseeId, meId),
          ),
        ),
      ),
    )
}
