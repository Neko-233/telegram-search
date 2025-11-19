import { describe, expect, it, vi } from 'vitest'

import { setDbInstanceForTests } from '../db'
import { accountsTable } from '../schemas/accounts'
import { findAccountByPlatformId, findAccountByUUID, recordAccount } from './accounts'

describe('accounts model', () => {
  it('recordAccount should insert account with correct values', async () => {
    const insert = vi.fn(() => ({
      values,
      onConflictDoUpdate,
      returning,
    }))
    const values = vi.fn(() => ({
      onConflictDoUpdate,
      returning,
    }))
    const onConflictDoUpdate = vi.fn(() => ({
      returning,
    }))
    const returning = vi.fn(async () => [{ id: 'account-1' }])

    const fakeDb = {
      insert,
    }

    setDbInstanceForTests(fakeDb as any)

    await recordAccount('telegram', 'user-123')

    expect(insert).toHaveBeenCalledWith(accountsTable)
    expect(values).toHaveBeenCalledWith({
      platform: 'telegram',
      platform_user_id: 'user-123',
    })
    expect(onConflictDoUpdate).toHaveBeenCalled()
    expect(returning).toHaveBeenCalled()
  })

  it('findAccountByPlatformId should query by platform and platform_user_id and return first result or null', async () => {
    const rows = [{ id: 'account-xyz' }]

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

    const result = await findAccountByPlatformId('telegram', 'user-xyz')
    const unwrapped = result.unwrap()

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalled()
    expect(where).toHaveBeenCalled()
    expect(unwrapped).toEqual(rows[0])
  })

  it('findAccountByUUID should query by id and return first result or null', async () => {
    const rows = [{ id: 'account-abc' }]

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

    const result = await findAccountByUUID('account-abc')
    const unwrapped = result.unwrap()

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalled()
    expect(where).toHaveBeenCalled()
    expect(unwrapped).toEqual(rows[0])
  })
})
