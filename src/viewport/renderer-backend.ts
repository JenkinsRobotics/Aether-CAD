/** Safari's WebGPU path currently leaves CAD surfaces visible behind a section
 * plane. Use Three's WebGL2 backend there; geometry, materials, clipping and
 * command behavior stay identical. Re-enable Safari WebGPU only after the real
 * Safari face-cut/flip/hover regression passes, not a Chromium or WebKit proxy.
 */
export function viewportRendererOptions(userAgent: string, vendor: string): { forceWebGL: boolean } {
  const webkit = /AppleWebKit\//.test(userAgent);
  const chromium = /(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent);
  const safari = vendor === 'Apple Computer, Inc.' || /Safari\//.test(userAgent);
  return { forceWebGL: webkit && safari && !chromium };
}
