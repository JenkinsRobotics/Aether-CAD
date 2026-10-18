import {extrudeStartControls,layoutExtrudeStart,validateExtrudeStart,serializeExtrudeStart} from './extrude-start';
import {availableBodies,bodyIDsForFeature} from '@aether/core/document';
import {extrusionPointPicker,serializeExtrusionPoint} from './extrude-point-picker';
import {extrusionPartPicker} from './extrude-part-picker';
import {thinControls,layoutThin,serializeThin,validateThin} from './extrude-thin';
import {extrudeDirectionControls,layoutExtrudeDirection,serializeExtrudeDirection,validateExtrudeDirection} from './extrude-direction';
import { secondEndControls, layoutSecondEnd, serializeSecondEnd, validateSecondEnd } from "./extrude-second-end";
import { layoutExtrudeScope } from "./extrude-scope";
import { extrudeDraftControls, layoutExtrudeDraft, serializeExtrudeDraft, validateExtrudeDraft } from "./extrude-draft";
import { extrusionFacePicker } from "./planar-face-picker";
import { extrudeDepthDrag } from "./extrude-depth-drag";
import {mountNativeExtrusionHandles} from './extrude-native-handles';
/** Extrude editor. Selection and extents share the native preview/commit path. */
import { extrudeSelectionControls, layoutExtrudeSelections, serializeExtrudeSelections, setExtrudeProfilePicking } from "./extrude-selection";
import { bodyAndOperationTabs, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const operationValues = ["new", "add", "cut", "intersect"] as const;
export const extrudeEditor: FeatureEditor = {
  type: "extrude",
  controls(context: FeatureEditorContext): Controls {
    const { field, reference, feature, doc } = context;
    const source = reference("Sketch", ["sketch", "profile"], feature?.profileFeatureId);
    const thin=thinControls(context);
    const meshes=new Set(doc.features.filter(f=>f.type==='import-cad'&&f.meshMode==='reference').flatMap(f=>bodyIDsForFeature(doc,f)));
    const hasSolid=availableBodies(doc).some(body=>!meshes.has(body.id));
    return {
      ...thin, source, ...extrudeSelectionControls(context, source, thin.creationMode),
      ...extrudeStartControls(context), ...extrudeDirectionControls(context), ...extrudeDraftControls(context), ...secondEndControls(context),
      scopeMode:field("Merge scope mode",feature?.scopeMode??(feature?"selected":"all"),["selected","all"]),
      scope:field("Additional target parts",JSON.stringify(feature?.targetBodyIds?.filter((id:string)=>id!==feature.targetBodyId)??[])),
      operation: field("Operation", feature?.operation ?? context.initialOperation ?? (hasSolid ? "add" : "new"), [...operationValues]),
      endType: field("End condition", feature?.endType ?? "blind", ["blind", "symmetric", "through-all", "symmetric-through-all", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"]),
      offset: field("Starting offset (mm)", String(feature?.startingOffsetMillimeters ?? 0)),
      endPoint:field("Stopping point",feature?.endPointReference?JSON.stringify(feature.endPointReference):""),
      endPart:field("Stopping part identity",feature?.endPartId??""),
      endReference: field("Stopping face",feature?.endReference ? JSON.stringify(feature.endReference) : ""),
      endOffset: field("End offset (mm)", String(feature?.endOffsetMillimeters ?? 0)),
      reversed: field("Flip direction", String(feature?.reversed ?? false), ["false", "true"]),
      distance: field("Distance (mm)", String(feature?.distanceMillimeters ?? 10)),
    };
  },
  layout(context, controls) {
    const {win,form,lengthUnitLabel}=context;
    bodyAndOperationTabs(win, form, controls.operation, operationValues, controls.creationMode);
    layoutExtrudeSelections(controls);
    layoutThin(context,controls);
    layoutExtrudeScope(context,controls);
    for (const control of [controls.endType, controls.reversed]) {
      control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control);
    }
    const endValues = {Blind:"blind", "Up to next":"up-to-next", "Up to face":"up-to-face", "Up to part":"up-to-part", "Up to vertex":"up-to-vertex", "Through all":"through-all"} as const;
    const endType = win.picker(Object.keys(endValues), {ariaLabel:"End type", onChange:value=>{
      const mode=endValues[value as keyof typeof endValues];
      if(!['blind','through-all'].includes(mode))symmetric.checked=false;
      controls.endType.value=symmetric.checked?(mode==='blind'?'symmetric':'symmetric-through-all'):mode;
      sync(); controls.endType.dispatchEvent(new Event("change"));
    }});
    endType.setValue(Object.keys(endValues).find(key=>endValues[key as keyof typeof endValues]===(controls.endType.value==="symmetric-through-all"?"through-all":controls.endType.value))??"Blind");
    win.body.append(endType.element);
    controls.distance.closest("label")?.remove(); controls.distance.setAttribute("form",form.id);
    const depth=win.row("Depth",controls.distance,unitSuffix(lengthUnitLabel),extrudeDepthDrag(controls.distance,controls.reversed,lengthUnitLabel));
    controls.endOffset.closest("label")?.remove(); controls.endOffset.setAttribute("form",form.id);
    const endOffset = win.row("End offset", controls.endOffset, unitSuffix(lengthUnitLabel));
    controls.endOffset.title = "Positive stops short; negative extends beyond the stopping surface, measured along the extrusion direction.";
    const pointPicker=extrusionPointPicker(context,controls.endPoint,"Stopping point");
    const partPicker=extrusionPartPicker(context,controls.endPart,"Stopping part");
    const facePicker=extrusionFacePicker(context,controls.endReference,"End face");
    const stopHelp=document.createElement("p");stopHelp.className="cad-form-note";stopHelp.textContent="Extrude to the underlying plane or curved surface, including beyond its trimmed edges. The surface must completely stop the extrusion. Changed or ambiguous faces require reselection.";win.body.append(stopHelp);
    const symmetric=document.createElement("input"); symmetric.type="checkbox"; symmetric.setAttribute("aria-label","Symmetric"); symmetric.checked=controls.endType.value.startsWith("symmetric");
    const symmetricRow=win.row("Symmetric",symmetric);
    symmetric.onchange=()=>{const through=controls.endType.value.includes("through-all");controls.endType.value=symmetric.checked?(through?"symmetric-through-all":"symmetric"):(through?"through-all":"blind");sync();controls.endType.dispatchEvent(new Event("change"));};
    layoutExtrudeDraft(context,controls);
    const direction=win.subsection("Direction",{kind:"disclosure"});
    const reverse=document.createElement("input");reverse.type="checkbox";reverse.setAttribute("aria-label","Reverse extrusion direction");reverse.checked=controls.reversed.value==="true";
    controls.reversed.addEventListener("change",()=>{reverse.checked=controls.reversed.value==="true";});
    reverse.onchange=()=>{controls.reversed.value=String(reverse.checked);controls.reversed.dispatchEvent(new Event("change"));};
    direction.body.append(rowIn("Flip direction",reverse));
    layoutExtrudeDirection(context,controls,direction.body);
    layoutExtrudeStart(context,controls);
    layoutSecondEnd(context,controls);
    function sync(){const mode=controls.endType.value;pointPicker.setEnabled(mode==="up-to-vertex");partPicker.setEnabled(mode==="up-to-part");stopHelp.hidden=mode!=="up-to-face";facePicker.setEnabled(mode==="up-to-face");setExtrudeProfilePicking(controls,!(controls.startEnabled.value==="true"&&controls.startMode.value==="face")&&!["up-to-face","up-to-part","up-to-vertex"].includes(mode)&&!( !mode.startsWith("symmetric")&&controls.secondEnabled.value==="true"&&["up-to-face","up-to-part","up-to-vertex"].includes(controls.secondEndType.value)));endOffset.hidden=!["up-to-next","up-to-face","up-to-part","up-to-vertex"].includes(mode);depth.hidden=mode!=="blind"&&mode!=="symmetric";symmetricRow.hidden=!["blind","symmetric","through-all","symmetric-through-all"].includes(mode);symmetric.checked=mode.startsWith("symmetric");}
    for(const control of [controls.endType,controls.secondEnabled,controls.secondEndType,controls.startEnabled,controls.startMode])control.addEventListener("change",sync);sync();
    mountNativeExtrusionHandles(win.panel,controls,lengthUnitLabel);
  },
  validate(controls) {
    const draftError=validateExtrudeStart(controls)??validateThin(controls)??validateExtrudeDirection(controls)??validateExtrudeDraft(controls)??validateSecondEnd(controls);if(draftError)return draftError;
    if (["add","cut","intersect"].includes(controls.operation.value) && !controls.target?.value) return "Choose a target part to modify.";
    if(["through-all","symmetric-through-all"].includes(controls.endType.value)&&!["cut", "intersect"].includes(controls.operation.value))return "Through all requires Remove or Intersect and a target body.";
    if(["up-to-next","up-to-face","up-to-part","up-to-vertex"].includes(controls.endType.value)&&(!controls.endOffset.value.trim()||!Number.isFinite(Number(controls.endOffset.value))))return "Enter a finite end offset.";
    if(controls.endType.value==="up-to-vertex"&&!controls.endPoint.value)return "Select a stopping point.";
    if(controls.endType.value==="up-to-part"&&!controls.endPart.value)return "Select a stopping part.";
    if(controls.endType.value==="up-to-face" && !controls.endReference.value)return "Select a stopping face.";
    if(!JSON.parse(controls.selections.value).length)return controls.creationMode.value==='thin'?"Select sketch curves for the thin wall.":"Select a sketch face.";
    return null;
  },
  serialize(values,context) {
    return {
      operation:values.operation, ...serializeThin(values),
      ...serializeExtrudeDirection(values,context), ...serializeExtrudeDraft(values), ...serializeSecondEnd(values,context),
      ...(values.operation!=="new"&&values.scopeMode==="all"?{scopeMode:"all"}:{}),
      ...(values.scopeMode!=="all"&&["add","cut","intersect"].includes(values.operation)&&JSON.parse(values.scope).length?{targetBodyIds:[values.target,...JSON.parse(values.scope)]}:{}),
      ...(values.operation==="new"&&(!context.feature||context.feature.separateBodies)?{separateBodies:true,...(context.feature?.bodyOutputs?{bodyOutputs:context.feature.bodyOutputs}:{})}:{}),
      distanceMillimeters:Number(values.distance),endType:values.endType,
      ...(values.endType==="up-to-vertex"?{endPointReference:serializeExtrusionPoint(values.endPoint,context)}:{}),
      ...(values.endType==="up-to-part"?{endPartId:values.endPart}:{}),
      ...(values.endType==="up-to-face"?{endReference:JSON.parse(values.endReference)}:{}),
      ...(["up-to-next","up-to-face","up-to-part","up-to-vertex"].includes(values.endType)&&Number(values.endOffset)!==0?{endOffsetMillimeters:Number(values.endOffset)}:{}),
      ...serializeExtrudeStart(values),
      ...(values.reversed==="true"?{reversed:true}:{}),
      ...serializeExtrudeSelections(values,context),
    };
  },
};
