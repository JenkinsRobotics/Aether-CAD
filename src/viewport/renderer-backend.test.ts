import { expect, it } from 'vitest';
import { viewportRendererOptions } from './renderer-backend';

it('uses WebGL2 for Safari and WebKit on iPad, including Safari with WebGPU available', () => {
  for (const agent of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
  ]) expect(viewportRendererOptions(agent, 'Apple Computer, Inc.')).toEqual({forceWebGL:true});
});

it('retains automatic WebGPU selection and WebGL fallback in other browsers', () => {
  for (const agent of [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    'Mozilla/5.0 AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
    'Mozilla/5.0 Gecko/20100101 Firefox/144.0',
  ]) expect(viewportRendererOptions(agent, 'Google Inc.')).toEqual({forceWebGL:false});
});
