import { useSyncExternalStore } from "react";
import type { MenuItem } from "@aether/ui";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
import { cadAppearance, type CADAppearanceSnapshot, type CADDisplayStyle, type CADFloorMode } from "../../cad-appearance-store";
import { cadPresentation } from "../../cad-presentation-store";
import { cadCommands } from "../../cad-command-registry";

const views = ["isometric", "dimetric", "trimetric"] as const;
const styles: readonly [CADDisplayStyle,string][] = [["shaded-edges","Shaded with edges"],["shaded","Shaded"],["hidden-line","Hidden line"],["wireframe","Wireframe"],["ghost","Translucent"]];
const grounds: readonly [CADFloorMode,string][] = [["none","None"],["grid","Grid"],["floor","Floor"],["both","Grid and floor"]];

export function cameraMenuItems(appearance: CADAppearanceSnapshot, sectionEnabled: boolean): MenuItem[] {
  return [
    {id:"home",label:"Home"},
    ...views.map(view=>({id:view,label:view[0].toUpperCase()+view.slice(1)})),
    {id:"graphics",label:"Graphics preferences…",separatorBefore:true},
    {id:"zoom-to-fit",label:"Zoom to fit",separatorBefore:true},
    {id:"display",label:styles.find(([id])=>id===appearance.displayStyle)![1],separatorBefore:true,
      children:styles.map(([id,label])=>({id:`display:${id}`,label,kind:"radio",checked:appearance.displayStyle===id}))},
    {id:"edges",label:"Edges visible",kind:"checkbox",checked:appearance.edgesVisible},
    {id:"ground",label:"Ground",children:grounds.map(([id,label])=>({id:`ground:${id}`,label,kind:"radio",checked:appearance.floorMode===id}))},
    {id:"shadows",label:"Contact shadows",kind:"checkbox",checked:appearance.contactShadowsVisible},
    {id:"section",label:"Section view…",separatorBefore:true,disabled:!sectionEnabled,disabledReason:"Open a part with a solid body to create a section view."},
  ];
}

export function selectCameraMenuItem(id: string): void {
  const appearance=cadAppearance.snapshot();
  if(id==="home") {cadCameraPresentation.dispatch({type:"fit-isometric"});return;}
  const view=views.find(view=>view===id);
  if(view) {cadCameraPresentation.dispatch({type:"select-view",view});return;}
  if(id==="zoom-to-fit") {cadCameraPresentation.dispatch({type:"zoom-to-fit"});return;}
  if(id==="graphics") {cadPresentation.dispatch({type:"show-start-dialog",dialog:"graphics-preferences"});return;}
  if(id==="section") {cadCommands.execute("part-section");return;}
  const style=styles.find(([style])=>`display:${style}`===id)?.[0];
  if(style) {cadAppearance.dispatch({type:"set-display-style",style});return;}
  const mode=grounds.find(([mode])=>`ground:${mode}`===id)?.[0];
  if(mode) {cadAppearance.dispatch({type:"set-floor-mode",mode});return;}
  if(id==="edges") cadAppearance.dispatch({type:"set-edges-visible",visible:!appearance.edgesVisible});
  if(id==="shadows") cadAppearance.dispatch({type:"set-contact-shadows-visible",visible:!appearance.contactShadowsVisible});
}

export function useCameraMenu() {
  const appearance=useSyncExternalStore(cadAppearance.subscribe,cadAppearance.snapshot,cadAppearance.snapshot);
  const commands=useSyncExternalStore(cadCommands.subscribe,cadCommands.snapshot,cadCommands.snapshot);
  const section=commands["part-section"];
  return {items:cameraMenuItems(appearance,section.enabled && section.registered),onSelect:selectCameraMenuItem};
}
