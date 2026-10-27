import { useEffect, useState } from 'react';
import { SaveRecoveryPanel } from '@aether/session/SaveRecoveryPanel';
import type { hostedSaveRecovery } from '../host-library';
export function CADSaveGuard() {
  const [controller, setController] = useState<ReturnType<typeof hostedSaveRecovery>>(null);
  useEffect(() => {
    let active = true;
    const update = () => { void import('../host-library').then(host => { if (active) setController(host.hostedSaveRecovery()); }); };
    window.addEventListener('cad-save-recovery', update); update();
    return () => { active = false; window.removeEventListener('cad-save-recovery', update); };
  }, []);
  return <SaveRecoveryPanel controller={controller}/>;
}
