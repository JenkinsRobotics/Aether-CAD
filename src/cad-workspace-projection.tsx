import { renderableDocument } from "./modeling/feature-errors";
import { createElement } from "react";
import { AetherIcon, ToolIcon, type ToolIconName } from "@aether/ui";
const treeIcon=(name:ToolIconName)=>createElement(ToolIcon,{name});
/** Onshape marks an under-defined sketch in the tree. Overlay a badge on the
 *  shared sketch icon rather than shipping a second icon, so the two can never
 *  drift apart. */
const sketchTreeIcon = (state: "under-constrained" | "fully-constrained" | "over-constrained" | "other") =>
  state === "fully-constrained" || state === "other"
    ? treeIcon("sketch")
    : createElement(
        "span",
        {
          className: `cad-tree-icon cad-tree-icon--${state}`,
          title: state === "under-constrained" ? "Under-defined sketch" : "Sketch error",
          "aria-label": state === "under-constrained" ? "Under-defined sketch" : "Sketch error",
        },
        treeIcon("sketch"),
        createElement(
          "span",
          { className: `cad-tree-icon-badge cad-tree-icon-badge--${state}`, "aria-hidden": true },
          state === "under-constrained" ? "-" : "!"
        ),
      );

/** A sketch feature's constraint state, for the tree badge. Only drawings carry
 *  constraints; legacy circle/polygon profiles report "other". */
const sketchState = (feature: { type: string; profile?: unknown }) => {
  const profile = (feature as { profile?: { type?: string } }).profile;
  if (!profile || profile.type === "circle" || profile.type === "polygon" || profile.type === "projection")
    return "other" as const;
  try {
    // "empty" is not under-defined: a sketch with no geometry has nothing to
    // constrain, and badging it would cry wolf on every new sketch.
    const { state } = sketchConstraintState(profile as never);
    if (state === "empty") return "other" as const;
    if (state === "invalid" || state === "over-constrained") return "over-constrained" as const;
    return state === "fully-constrained"
      ? ("fully-constrained" as const)
      : ("under-constrained" as const);
  } catch {
    return "other" as const;
  }
};
const eyeIcon=(visible:boolean)=>createElement(AetherIcon,{name:visible?"visible":"hidden"});
import {rollbackPosition,availableBodies,buildFolderedTree} from "@aether/core/document";
import { sketchConstraintState } from "@aether/core/sketch";
import type { ListBoxItem, TreeNode } from "@aether/ui";
import type {
  AppliedMate,
  MateConnector,
  PartDocument,
  SketchPlane,
} from "./aether-core";
import { rectanglePartParameters, sketchDefinitionState } from "./aether-core";
import type { CADInspectorSection } from "./cad-workspace-store";
import { buildAssemblyDocumentTree, type AssemblyPartRow } from "./assembly-tree";
import { buildPartFeatureTree } from "./part-feature-tree";
import {
  referenceGeometry,
  sketchPlaneForReference,
  type ReferenceGeometryId,
} from "./reference-geometry";

export interface CADWorkspaceProjection {
  itemNodes: readonly TreeNode[];
  /** Bodies live in their own pinned section, like Onshape's Parts list. */
  bodyNodes: readonly TreeNode[];
  selectedItemIDs: ReadonlySet<string>;
  expandedItemIDs: ReadonlySet<string>;
  historyItems: readonly ListBoxItem[];
  rollbackIndex: number;
  connectorItems: readonly ListBoxItem[];
  mateItems: readonly ListBoxItem[];
  problemItems: readonly ListBoxItem[];
  inspectorSections: readonly CADInspectorSection[];
  selectedConnectorIDs: ReadonlySet<string>;
  partCount: number;
}

export function buildCADWorkspaceProjection(
  partDocument: PartDocument | null,
  importedParts: readonly AssemblyPartRow[],
  expandedDocuments: ReadonlySet<string>,
  referenceVisibility: Readonly<Record<ReferenceGeometryId, boolean>>,
  selectedPlane: SketchPlane | null,
  connectors: readonly MateConnector[],
  mates: readonly AppliedMate[],
  selectedConnectorID: string | null,
  topology: { faceCount: number; candidateCount: number },
  selectedPartIDs: ReadonlySet<string> = new Set(),
  selectedFeatureIDs: ReadonlySet<string> = new Set(),
  collapsedFolders: ReadonlySet<string> = new Set(),
  /** A feature created but not yet committed; invalid until it has a plane. */
  draftSketch: { id: string; name: string; hasPlane: boolean } | null = null,
): CADWorkspaceProjection {
  const sketchStates = new Map((partDocument?.features ?? []).map(feature => [feature.id, sketchState(feature)]));
  const selected = new Set<string>();
  const bodyNodes: TreeNode[] = [];
  const expanded = new Set<string>();
  // Reference Geometry collapses like any other folder.
  if (!collapsedFolders.has("reference-folder")) expanded.add("reference-folder");
  const references: TreeNode = {
    id: "reference-folder",
    label: "Reference Geometry",
    icon: treeIcon("plane"),
    badge: "4",
    children: referenceGeometry.map((item) => {
      const id = `reference/${item.id}`;
      if (
        selectedPlane !== null &&
        sketchPlaneForReference(item.id) === selectedPlane
      ) selected.add(id);
      if (item.unavailableReason)
        return {
          id,
          label: item.label,
          icon: treeIcon(item.id === "axes" ? "point" : "plane"),
          dimmed: true,
          badge: "—",
        };
      return {
        id,
        label: item.label,
        icon: treeIcon(item.id === "origin" ? "point" : "plane"),
        dimmed: !referenceVisibility[item.id],
        actions: [
          {
            id: "toggle-visibility",
            label: `${referenceVisibility[item.id] ? "Hide" : "Show"} ${item.label}`,
            icon: eyeIcon(referenceVisibility[item.id]),
            pinned: !referenceVisibility[item.id],
          },
        ],
      };
    }),
  };

  const authored: TreeNode[] = [];
  if (partDocument) {
    const root = buildPartFeatureTree(partDocument);
    const firstSketch = partDocument.features.find((feature) => feature.type === "sketch");
    const sketchUnderDefined = firstSketch ? !sketchDefinitionState(firstSketch).fullyDefined : false;
    // Everything in a Part document is the part itself: features list flat like the native tree.
    const features = root.children.filter(f=>f.kind!=="body").map<TreeNode>((feature) => {
      const id = `feature/${feature.kind}/${feature.id}`;
      if(selectedFeatureIDs.has(feature.id))selected.add(id);
      if (
        feature.kind === "body" &&
        selectedPartIDs.has(`${partDocument.documentId}:body-1`)
      ) selected.add(id);
      return {
        id,
        label: feature.name,
        tone: feature.error ? "error" : undefined,
        badge: feature.error ? "Error" : feature.detail === "Suppressed" || feature.detail === "Rolled back" ? feature.detail : sketchUnderDefined && feature.id === firstSketch?.id ? "Under-defined" : undefined,
        dimmed: feature.detail === "Suppressed" || feature.detail === "Rolled back",
        actions:[{id:"edit-feature",label:`Edit ${feature.name}`,icon: <AetherIcon name="pencil" />},{id:"suppress-feature",label:`${feature.detail === "Suppressed"?"Unsuppress":"Suppress"} ${feature.name}`,icon:feature.detail === "Suppressed"?"▶":"Ⅱ"},{id:"rollback-before",label:`Roll back before ${feature.name}`,icon:"↥"}],
        icon: feature.error ? createElement("span", { className: "cad-tree-icon", title: feature.error }, treeIcon(feature.kind === "profile" || feature.kind === "sketch" ? "sketch" : feature.kind === "extrude" ? "extrude" : feature.kind === "plane" ? "plane" : "part"), createElement("span", { className: "cad-tree-icon-badge cad-tree-icon-badge--over-constrained" }, "!")) : feature.kind === "sketch" || feature.kind === "profile"
          ? sketchTreeIcon(sketchStates.get(feature.id) ?? "other")
          : treeIcon(feature.kind === "plane" ? "plane" : feature.kind === "extrude" ? "extrude" : feature.kind === "revolve" ? "revolve" : feature.kind === "mirror" ? "mirror" : feature.kind === "fillet" ? "fillet" : feature.kind === "chamfer" ? "chamfer" : "part"),
      };
    });
    const rowIDByFeature = new Map(root.children.filter(f=>f.kind!=="body").map(f=>[f.id,`feature/${f.kind}/${f.id}`] as const));
    const organization = partDocument.organization;
    const rowOrganization = organization ? {
      folders: organization.folders,
      membership: Object.fromEntries(Object.entries(organization.membership).flatMap(([featureID, folderID]) => {
        const rowID = rowIDByFeature.get(featureID);
        return rowID ? [[rowID, folderID] as const] : [];
      })),
    } : undefined;
    const foldered = buildFolderedTree(features, rowOrganization, (folder, children) => {
      const rowID = `folder/${folder.id}`;
      if (!collapsedFolders.has(rowID)) expanded.add(rowID);
      return {
        id: rowID,
        label: folder.name,
        icon: createElement(AetherIcon, { name: "folder" }),
        badge: String(children.length),
        actions: [
          { id: "folder-rename", label: `Rename ${folder.name}`, icon: <AetherIcon name="pencil" /> },
          ...(folder.parentID !== null ? [{ id: "folder-unnest", label: `Move ${folder.name} to top level`, icon: <AetherIcon name="open-external" /> }] : []),
          { id: "folder-delete", label: `Dissolve ${folder.name}`, icon: <AetherIcon name="close" /> },
        ],
        children,
      } as TreeNode;
    });
    // ponytail: rollback stays a top-level line; a folder straddling the boundary keeps the line after it.
    const countRows = (node: TreeNode): number => node.id.startsWith("folder/") ? (node.children ?? []).reduce((sum, child) => sum + countRows(child), 0) : node.id.startsWith("feature/") ? 1 : 0;
    let remaining = rollbackPosition(partDocument);
    let insertAt = foldered.length;
    for (let i = 0; i < foldered.length; i++) {
      if (remaining <= 0) { insertAt = i; break; }
      remaining -= countRows(foldered[i]);
    }
    foldered.splice(insertAt, 0, {id:"rollback-bar",label:`Rollback · ${rollbackPosition(partDocument)} / ${partDocument.features.length}`,variant:"divider"});
    authored.push(...foldered);
    if (draftSketch) {
      authored.push({
        id: `feature/profile/${draftSketch.id}`,
        label: draftSketch.name,
        icon: treeIcon("sketch"),
        tone: draftSketch.hasPlane ? undefined : "error",
        badge: draftSketch.hasPlane ? "Editing" : "No plane",
      });
    }
    const bodies=availableBodies(renderableDocument(partDocument)!);for(const body of bodies)if(selectedPartIDs.has(body.id))selected.add(`feature/body/${body.id}`);const bodiesID=`bodies/${partDocument.documentId}`;if(!collapsedFolders.has(bodiesID))expanded.add(bodiesID);
    bodyNodes.push({id:bodiesID,label:`Bodies (${bodies.length})`,icon:treeIcon("part"),children:bodies.map(body=>({id:`feature/body/${body.id}`,label:body.name,dimmed:!body.visible,actions:[{id:"body-visibility",label:`${body.visible?"Hide":"Show"} ${body.name}`,icon:eyeIcon(body.visible),pinned:!body.visible},{id:"body-rename",label:`Rename ${body.name}`,icon: <AetherIcon name="pencil" />}]}))});
  }

  const imported = buildAssemblyDocumentTree([...importedParts]).map<TreeNode>((document) => {
    const rootID = `document/${document.id}`;
    if (expandedDocuments.has(document.id)) expanded.add(rootID);
    return {
      id: rootID,
      label: document.name,
      icon: treeIcon("plane"),
      badge: String(document.parts.length),
      children: document.parts.map((part) => {
        const id = `part/${part.id}`;
        if (part.selected) selected.add(id);
        return {
          id,
          label: part.name,
          icon: <AetherIcon name="keyframe" />,
          badge: part.constrained ? "Fastened" : "Free",
          dimmed: !part.visible,
          actions: [
            {
              id: "toggle-visibility",
              label: `${part.visible ? "Hide" : "Show"} ${part.name}`,
              icon: eyeIcon(part.visible),
              pinned: !part.visible,
            },
          ],
        };
      }),
    };
  });

  const featureHistory: ListBoxItem[] = (partDocument?.features ?? []).map((feature) => ({
    id: `history/feature/${feature.id}`,
    label: feature.name,
    description: feature.suppressed?"Suppressed":partDocument!.features.indexOf(feature)>=rollbackPosition(partDocument!)?"Rolled back":["sketch","profile"].includes(feature.type)?"Sketch feature":"Solid feature",
    icon: feature.type === "sketch" || feature.type === "profile"
      ? sketchTreeIcon(sketchStates.get(feature.id) ?? "other")
      : treeIcon(feature.type === "plane" ? "plane" : "extrude"),
    group: "Part history",
  }));
  const importedHistory: ListBoxItem[] = [
    ...new Map(importedParts.map((part) => [part.sourceDocumentId, part.sourceName] as const)),
  ].map(([id, name]) => ({
    id: `history/document/${id}`,
    label: `Import ${name}`,
    icon: <AetherIcon name="hexagon" />,
    group: "Imports",
  }));
  const mateHistory: ListBoxItem[] = Array.from({ length: mates.length }, (_, index) => ({
    id: `history/mate/${index}`,
    label: `Fastened Mate ${index + 1}`,
    icon: <AetherIcon name="link" />,
    group: "Assembly",
  }));

  const connectorItems: ListBoxItem[] = connectors.map((connector) => ({
    id: `connector/${connector.id}`,
    label: connector.name,
    description: `${connector.partName} · ${connector.candidate.label}`,
    icon: <AetherIcon name="fit" />,
    actions: [
      { id: "pick", label: "Use in mate", icon: "Pick" },
      { id: "delete", label: "Delete connector", icon: <AetherIcon name="close" /> },
    ],
  }));
  const mateItems: ListBoxItem[] = mates.map((mate, index) => {
    const moving = connectors.find((item) => item.id === mate.movingConnectorId);
    const target = connectors.find((item) => item.id === mate.targetConnectorId);
    return {
      id: `mate/${index}`,
      label: `Fastened Mate ${index + 1}`,
      description: `${moving?.name ?? "Connector"} → ${target?.name ?? "Connector"}`,
      icon: <AetherIcon name="link" />,
    };
  });
  const sketch = partDocument?.features.find((feature) => feature.type === "sketch");
  const definition = sketch ? sketchDefinitionState(sketch) : null;
  const parameters = partDocument && sketch ? rectanglePartParameters(partDocument) : null;
  const problemItems: ListBoxItem[] = definition && !definition.fullyDefined
    ? [{
        id: "problem/sketch-under-defined",
        label: `${sketch?.name ?? "Sketch"} is under-defined`,
        description: `${definition.remainingDegreesOfFreedom} remaining degrees of freedom`,
        icon: <AetherIcon name="status-error" />,
        badge: "Warning",
        group: "Definition",
      }]
    : [];
  const inspectorSections: CADInspectorSection[] = partDocument && parameters
    ? [
        {
          id: "document",
          label: "Part document",
          badge: ".acpart",
          properties: [
            { id: "name", label: "Name", value: partDocument.name },
            { id: "units", label: "Length units", value: "Millimeters", displayUnit: "length" },
            { id: "features", label: "Features", value: String(partDocument.features.length) },
          ],
        },
        {
          id: "parameters",
          label: "Feature parameters",
          properties: [
            { id: "width", label: "Width", value: `${parameters.widthMillimeters} mm`, quantity: {si: parameters.widthMillimeters/1000, family:"length"} },
            { id: "height", label: "Height", value: `${parameters.heightMillimeters} mm`, quantity: {si: parameters.heightMillimeters/1000, family:"length"} },
            { id: "depth", label: "Extrude", value: `${parameters.depthMillimeters} mm`, quantity: {si: parameters.depthMillimeters/1000, family:"length"} },
          ],
        },
        {
          id: "definition",
          label: "Sketch definition",
          badge: definition?.label,
          properties: [
            { id: "plane", label: "Plane", value: sketch?.plane ?? "—" },
            { id: "dof", label: "Remaining DOF", value: String(definition?.remainingDegreesOfFreedom ?? 0) },
          ],
        },
        {
          id: "topology",
          label: "Exact topology",
          badge: "OCCT",
          properties: [
            { id: "faces", label: "Faces", value: String(topology.faceCount) },
            { id: "snaps", label: "Exact snaps", value: String(topology.candidateCount) },
            { id: "connectors", label: "Connectors", value: String(connectors.length) },
            { id: "mates", label: "Mates", value: String(mates.length) },
          ],
        },
      ]
    : partDocument ? [{id:"document",label:"Part document",badge:".acpart",properties:[{id:"name",label:"Name",value:partDocument.name},{id:"features",label:"Features",value:String(partDocument.features.length)},{id:"units",label:"Length units",value:"Millimeters",displayUnit:"length"}]}] : [];

  return {
    bodyNodes,
    itemNodes: [references, ...authored, ...imported],
    selectedItemIDs: selected,
    expandedItemIDs: expanded,
    historyItems: [...featureHistory, ...importedHistory, ...mateHistory],
    rollbackIndex: partDocument ? rollbackPosition(partDocument) : 0,
    connectorItems,
    mateItems,
    problemItems,
    inspectorSections,
    selectedConnectorIDs: new Set(
      selectedConnectorID ? [`connector/${selectedConnectorID}`] : [],
    ),
    partCount: (partDocument ? availableBodies(renderableDocument(partDocument)!).length : 0) + importedParts.length,
  };
}
