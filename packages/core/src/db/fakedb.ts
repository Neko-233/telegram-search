
import { vi } from 'vitest'

/**
 * Create a simple insert → values → onConflictDoUpdate → returning mock chain.
 *
 * This is meant for unit tests that want to verify the interaction pattern with
 * Drizzle's insert builder without pulling in a real database or driver.
 */
export function createInsertMock<T = { id: string }>(rows: T[] = [{ id: 'account-1' } as T]) {
  const values = vi.fn()
  const returning = vi.fn(async () => rows)
  const onConflictDoUpdate = vi.fn(() => ({ returning }))

  const insert = vi.fn(() => ({
    values,
    onConflictDoUpdate,
    returning,
  }))

  return { insert, values, onConflictDoUpdate, returning }
}

/**
 * Create a simple select → from → where → limit mock chain that resolves to rows.
 *
 * Useful for testing "select ... where ... limit(1)" style queries.
 */
export function createSelectOneMock<T>(rows: T[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({
    limit,
  }))
  const from = vi.fn(() => ({
    where,
  }))
  const select = vi.fn(() => ({
    from,
  }))

  return { select, from, where, limit }
}
