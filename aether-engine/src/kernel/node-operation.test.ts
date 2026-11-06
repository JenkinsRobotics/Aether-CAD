import { describe, expect, it } from 'vitest';
import { runNodeOperation } from './node-operation';

describe('headless operation boundaries', () => {
  it('allows cleanup turns between a stream of awaited operations', async () => {
    const events: number[] = [];
    for (let i = 0; i < 12; i++) {
      setImmediate(() => events.push(i));
      const result = await runNodeOperation([], () => {
        expect(events).toEqual(Array.from({ length: i + 1 }, (_, n) => n));
        return i;
      });
      expect(result).toBe(i);
    }
  });
  it('preserves failures and allows a subsequent operation', async () => {
    const failure = new Error('Invalid candidate');
    await expect(runNodeOperation([], () => { throw failure; })).rejects.toBe(failure);
    await expect(runNodeOperation([], () => 42)).resolves.toBe(42);
  });
});
