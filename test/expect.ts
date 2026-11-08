import assert from 'node:assert/strict'

// Malý adaptér zachováva pôvodné asercie pri prenose testov z modu.
export function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.equal(actual, expected),
    toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    toBeNull: () => assert.equal(actual, null),
    not: { toBeNull: () => assert.notEqual(actual, null) },
    toMatchObject(expected: Record<string, unknown>) {
      assert.ok(actual !== null && typeof actual === 'object')
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual((actual as Record<string, unknown>)[key], value)
      }
    },
  }
}
