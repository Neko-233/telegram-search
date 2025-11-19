import { describe, expect, it, vi } from 'vitest'

import { setDbInstanceForTests } from '../db'
import { chatMessageStatsView } from '../schemas/chat_message_stats'
import { getChatMessagesStats, getChatMessageStatsByChatId } from './chat-message-stats'

describe('chat-message-stats model', () => {
  it('getChatMessagesStats should select all telegram stats', async () => {
    const rows = [
      { chat_id: '1001', message_count: 10 },
      { chat_id: '1002', message_count: 5 },
    ]

    const where = vi.fn(() => Promise.resolve(rows))
    const from = vi.fn(() => ({
      where,
    }))
    const select = vi.fn(() => ({
      from,
    }))

    const fakeDb = {
      select,
    }

    setDbInstanceForTests(fakeDb as any)

    const result = await getChatMessagesStats()
    const unwrapped = result.unwrap()

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalledWith(chatMessageStatsView)
    expect(where).toHaveBeenCalled()
    expect(unwrapped).toEqual(rows)
  })

  it('getChatMessageStatsByChatId should return first stat row for a chat', async () => {
    const rows = [
      { chat_id: '1001', message_count: 10 },
    ]

    const limit = vi.fn(() => Promise.resolve(rows))
    const where = vi.fn(() => ({
      limit,
    }))
    const from = vi.fn(() => ({
      where,
    }))
    const select = vi.fn(() => ({
      from,
    }))

    const fakeDb = {
      select,
    }

    setDbInstanceForTests(fakeDb as any)

    const resultOk = await getChatMessageStatsByChatId('1001')

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalledWith(chatMessageStatsView)
    expect(where).toHaveBeenCalled()
    expect(limit).toHaveBeenCalledWith(1)
    expect(resultOk.unwrap()).toEqual(rows[0])
  })
})
