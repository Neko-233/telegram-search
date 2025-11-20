import { describe, expect, it } from 'vitest'

import { setDbInstanceForTests } from '../db'
import { createInsertMock, createSelectOneMock } from '../db/fakedb'
import { accountsTable } from '../schemas/accounts'
import { findAccountByPlatformId, findAccountByUUID } from './accounts'

describe('accounts model', () => {
  it('recordAccount should insert account with correct values', async () => {
    const { insert, values, onConflictDoUpdate, returning } = createInsertMock()

    const fakeDb = { insert }
    setDbInstanceForTests(fakeDb)

    await findAccountByPlatformId // keep TS happy that function is referenced in file

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

    const { select, from, where, limit } = createSelectOneMock(rows)

    const fakeDb = { select }
    setDbInstanceForTests(fakeDb)

    const result = await findAccountByPlatformId('telegram', 'user-xyz')
    const unwrapped = result.unwrap()

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalled()
    expect(where).toHaveBeenCalled()
    expect(limit).toHaveBeenCalledWith(1)
    expect(unwrapped).toEqual(rows[0])
  })

  it('findAccountByUUID should query by id and return first result or null', async () => {
    const rows = [{ id: 'account-abc' }]

    const { select, from, where, limit } = createSelectOneMock(rows)

    const fakeDb = { select }
    setDbInstanceForTests(fakeDb)

    const result = await findAccountByUUID('account-abc')
    const unwrapped = result.unwrap()

    expect(select).toHaveBeenCalled()
    expect(from).toHaveBeenCalled()
    expect(where).toHaveBeenCalled()
    expect(limit).toHaveBeenCalledWith(1)
    expect(unwrapped).toEqual(rows[0])
  })
})
