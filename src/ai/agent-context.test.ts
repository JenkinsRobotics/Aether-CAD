import {describe,it,expect} from 'vitest';
import {cadAgentContextText} from './agent-context';
import {cadAgentTools} from '../automation/live-commands';
import {assemblyAgentTools} from '../automation/assembly-agent';

describe('CAD agent modeling instructions',()=>{
  it('guides the active Part through real operations and exact/visual checks',()=>{
    const text=cadAgentContextText('Plate','modeling',{contextKey:'part',tools:cadAgentTools,execute:async()=>{}});
    expect(text).toContain('aether_cad_run_program');expect(text).toContain('aether_cad_verify');expect(text).toContain('aether_cad_preview');
    expect(text).not.toContain('assembly_compose');
  });
  it('describes the available Assembly transaction rather than Part-only proof',()=>{
    const text=cadAgentContextText('Machine','modeling',{contextKey:'assembly',tools:assemblyAgentTools,execute:async()=>{}});
    expect(text).toContain('assembly_compose');expect(text).not.toContain('aether_cad_verify');
    expect(text).toContain('share session undo/redo');expect(text).not.toContain('Only one');
  });
});
it('describes drawing tools without sending Part commands into a drawing', async () => {
  const { drawingAgentTools } = await import('../automation/drawing-agent');
  const text = cadAgentContextText('Bracket Drawing', 'drawing', { contextKey: 'drawing', tools: drawingAgentTools, execute: async () => {} });
  expect(text).toContain('expected_revision'); expect(text).toContain('drawing_refresh');
  expect(text).not.toContain('aether_cad_run_program'); expect(text).toContain('never edit that source Part');
});
