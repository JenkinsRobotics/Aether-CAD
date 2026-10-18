import { expect, it } from 'vitest';
import { applyContactShadows } from './contact-shadows';
it('keeps the shadow resource alive across repeated preset toggles while stopping hidden updates', () => {
  const shadow = { intensity: 1, autoUpdate: true, needsUpdate: false };
  const light = { castShadow: true, shadow }, floor = { receiveShadow: true };
  for (const enabled of [false,true,false,true]) {
    applyContactShadows(light,floor,enabled);
    expect(light.castShadow).toBe(true);expect(light.shadow).toBe(shadow);
    expect(shadow).toEqual({intensity:enabled?1:0,autoUpdate:enabled,needsUpdate:enabled});
    expect(floor.receiveShadow).toBe(true);
  }
});
