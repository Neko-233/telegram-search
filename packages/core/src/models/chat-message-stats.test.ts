import { describe, expect, it } from 'vitest'

import { setDbInstanceForTests } from '../db'
import { createSelectOneMock } from '../db/fakedb'
import { chatMessageStatsView } from '../schemas/chat_message_stats'
import { getChatMessagesStats, getChatMessageStatsByChatId } from './chat-message-stats'

describe('chat-message-stats model', () => {
  it('getChatMessagesStats should select all telegram stats', async () => {
    const rows = [
      { chat_id: '1001', message_count: 10 },
      { chat_id: '1002', message_count: 5 },
    ]

    // Simulate select->from->where->limit chain for all rows
    const { select, from, where } = createSelectOneMock(rows)

    setDbInstanceForTests({ select })

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

    const { select, from, where, limit } = createSelectOneMock(rows)

    setDbInstanceForTests({ select })

    const resultOk = await getChatMessageStatsByChatId('1001')

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalledWith(chatMessageStatsView)
    expect(where).toHaveBeenCalled()
    expect(limit).toHaveBeenCalledWith(1)
    expect(resultOk.unwrap()).toEqual(rows[0])
  })
})
