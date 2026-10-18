import { useSyncExternalStore } from "react";
import { AetherIcon, SettingsCard, SettingsRow, type ViewportUpAxis } from "@aether/ui";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";

export function WorkspaceOrientationSettings() {
  const camera = useSyncExternalStore(cadCameraPresentation.subscribe, cadCameraPresentation.snapshot, cadCameraPresentation.snapshot);
  return <SettingsCard icon={<AetherIcon name="cube" />} title="Workspace orientation" caption="Choose the vertical axis for navigation. Saved in this browser.">
    <SettingsRow label="Up axis" caption="X stays fixed. Part and sketch coordinates stay unchanged.">
      <select aria-label="Workspace up axis" value={camera.upAxis} onChange={event => cadCameraPresentation.dispatch({ type: "set-up-axis", upAxis: event.target.value as ViewportUpAxis })}>
        <option value="z">Z-up (default)</option>
        <option value="y">Y-up</option>
      </select>
    </SettingsRow>
  </SettingsCard>;
}
