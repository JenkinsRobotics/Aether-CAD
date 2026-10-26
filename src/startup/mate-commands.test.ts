import { describe, expect, it, vi } from 'vitest';
import { cadCommands } from '../cad-command-registry';
import { registerMateCommands, syncMateAvailability } from './mate-commands';
describe('assembly mate buttons', () => {
  it('runs a specific mate and Solve on the first use, with workspace capability gates', () => {
    const beginMate=vi.fn(), solve=vi.fn();registerMateCommands({beginMate,solve});
    syncMateAvailability(true,true,['revolute','fastened']);
    cadCommands.execute('assembly-mate-revolute');cadCommands.execute('assembly-solve');
    expect(beginMate).toHaveBeenCalledWith('revolute');expect(solve).toHaveBeenCalledOnce();
    expect(cadCommands.snapshot()['assembly-mate-ball'].enabled).toBe(false);
    expect(cadCommands.snapshot()['assembly-mate-distance'].enabled).toBe(false);
    syncMateAvailability(false,false);
    cadCommands.execute('assembly-mate-revolute');expect(beginMate).toHaveBeenCalledTimes(1);
    expect(cadCommands.snapshot()['assembly-solve'].enabled).toBe(false);
  });
});
