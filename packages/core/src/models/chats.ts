// https://github.com/moeru-ai/airi/blob/main/services/telegram-bot/src/models/chats.ts

import type { CoreDialog } from '../types/dialog'

import { desc, eq, sql } from 'drizzle-orm'

import { withDb } from '../db'
import { accountJoinedChatsTable } from '../schemas/account_joined_chats'
import { joinedChatsTable } from '../schemas/joined_chats'
import { parseDate } from './utils/time'

export async function fetchChats() {
  return withDb(db => db
    .select()
    .from(joinedChatsTable)
    .where(eq(joinedChatsTable.platform, 'telegram'))
    .orderBy(desc(joinedChatsTable.dialog_date)),
  )
}

/**
 * Fetch chats for a specific account
 */
export async function fetchChatsByAccountId(accountId: string) {
  return withDb(db => db
    .select({
      id: joinedChatsTable.id,
      platform: joinedChatsTable.platform,
      chat_id: joinedChatsTable.chat_id,
      chat_name: joinedChatsTable.chat_name,
      chat_type: joinedChatsTable.chat_type,
      dialog_date: joinedChatsTable.dialog_date,
      created_at: joinedChatsTable.created_at,
      updated_at: joinedChatsTable.updated_at,
    })
    .from(joinedChatsTable)
    .innerJoin(
      accountJoinedChatsTable,
      eq(joinedChatsTable.id, accountJoinedChatsTable.joined_chat_id),
    )
    .where(eq(accountJoinedChatsTable.account_id, accountId))
    .orderBy(desc(joinedChatsTable.dialog_date)),
  )
}

export async function recordChats(chats: CoreDialog[], accountId: string) {
  return withDb(async (db) => {
    // Insert or update joined_chats
    const insertedChats = await db
      .insert(joinedChatsTable)
      .values(chats.map(chat => ({
        platform: 'telegram',
        chat_id: chat.id.toString(),
        chat_name: chat.name,
        chat_type: chat.type,
        dialog_date: parseDate(chat.lastMessageDate),
      })))
      .onConflictDoUpdate({
        target: joinedChatsTable.chat_id,
        set: {
          chat_name: sql`excluded.chat_name`,
          chat_type: sql`excluded.chat_type`,
          dialog_date: sql`excluded.dialog_date`,
          updated_at: Date.now(),
        },
      })
      .returning()

    // If accountId is provided, automatically link to account_joined_chats
    if (accountId && insertedChats.length > 0) {
      await db
        .insert(accountJoinedChatsTable)
        .values(insertedChats.map(chat => ({
          account_id: accountId,
          joined_chat_id: chat.id,
        })))
        .onConflictDoNothing()
    }

    return insertedChats
  })
}
