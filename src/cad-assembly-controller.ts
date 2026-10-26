import { AssemblyEditHistory } from "./assembly-edit-history";
import { liveContactSets } from "./startup/assembly-contacts";
import { assemblyContactSetPayload, assemblyContactSetDraftIssues, type AssemblyContactSetDraft } from "./cad-contact-authoring";
import { parseCustomProperties, type BodiesToComponentDraft, type PartPropertiesDraft, bodiesToComponentDraftIssues, partPropertiesDraftIssues } from "./cad-component-authoring";
import { appendDocument, availableBodies, parsePartDocument, splitDocument, type PartDocument } from "./aether-core";
import type { PartDefinitionProjection } from "./cad-assembly-bridge";
import { standardPartDocument, standardPartFromProperties, standardPartLabel, standardPartProperties, standardPartVolume, type StandardPartRequest } from "@aether/core/document";
import { asBuiltConnectorFrames, asBuiltJointDraftIssues, type AsBuiltJointDraft, type Placement, type WorldFrame } from "./cad-joint-authoring";
import {
  AssemblyBridgeClient,
  AssemblyBridgeError,
  type AssemblyMutationMethod,
  type AssemblyMutationResult,
  type AssemblyMatePreviewProjection,
  type DOFProjection,
  type AssemblyInstanceProjection,
  type MateProjection,
  type AssemblyProjectionV1,
  type AssemblySolutionProjection,
  type AssemblyWorkspaceArchive,
  type AssemblyWorkspaceDescriptor,
  type BOMProjectionV1,
} from "./cad-assembly-bridge";
import { buildCADAssemblyPresentation } from "./cad-assembly-presentation";
import { composeAssembly, type AssemblyComposeRequest, type AssemblyComposeResult } from './assembly-recipe';
import {
  normalizeAssemblyComponentDraft,
  type AssemblyComponentDraft,
} from "./cad-assembly-authoring";
import {
  normalizeAssemblyConnectorDraft,
  type AssemblyConnectorDraft,
} from "./cad-connector-authoring";
import {
  assemblyMatePayload,
  assemblyMateDOFLimitsPayload,
  assemblyMateDOFValuePayload,
  assemblyMateUpdatePayload,
  normalizeAssemblyMateDraft,
  type AssemblyMateDOFEditorDraft,
  type AssemblyMateDraft,
} from "./cad-mate-authoring";
import {
  assemblyRelationPayload,
  type AssemblyRelationDOFOption,
  type AssemblyRelationDraft,
} from "./cad-relation-authoring";
import {
  CADAssemblyWorkspaceStore,
  cadAssemblyWorkspace,
} from "./cad-assembly-workspace-store";

export interface AssemblyControllerClient {
  newWorkspace(name: string, signal?: AbortSignal): Promise<AssemblyWorkspaceDescriptor>;
  openWorkspace(dataBase64: string, signal?: AbortSignal): Promise<AssemblyWorkspaceDescriptor>;
  saveWorkspace(handle: string, revision: string, signal?: AbortSignal): Promise<AssemblyWorkspaceArchive>;
  describeAssembly(handle: string, assemblyID: string, signal?: AbortSignal): Promise<AssemblyProjectionV1>;
  solveAssembly(handle: string, assemblyID: string, signal?: AbortSignal): Promise<AssemblySolutionProjection>;
  projectBOM(handle: string, assemblyID: string, mode: "hierarchical" | "flattened", signal?: AbortSignal): Promise<BOMProjectionV1>;
  previewMate(
    handle: string,
    assemblyID: string,
    mate: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<AssemblyMatePreviewProjection>;
  mutate(
    method: AssemblyMutationMethod,
    params: Readonly<Record<string, unknown>> & { readonly handle: string; readonly expected_revision: string },
    signal?: AbortSignal,
  ): Promise<AssemblyMutationResult>;
  release(handle: string, signal?: AbortSignal): Promise<void>;
}

export interface AssemblyDocumentSummary {
  readonly name: string;
  readonly workspaceID: string;
  readonly assemblyID: string;
  readonly revision: string;
}

export interface CADAssemblyControllerOptions {
  readonly writable?: () => boolean;
  readonly validateContacts?: (assembly: AssemblyProjectionV1) => Promise<void>;
  readonly compose?: (request: AssemblyComposeRequest, signal?: AbortSignal) => Promise<AssemblyComposeResult>;
  readonly client?: AssemblyControllerClient;
  readonly store?: CADAssemblyWorkspaceStore;
  readonly saveFile?: (fileName: string, bytes: Uint8Array) => void | Promise<void>;
  readonly onDocumentChanged?: (document: AssemblyDocumentSummary | null) => void;
  readonly onStatus?: (message: string, tone: "normal" | "error" | "success") => void;
}

interface CanonicalSnapshot {
  readonly assembly: AssemblyProjectionV1;
  readonly solution: AssemblySolutionProjection;
  readonly bom: BOMProjectionV1;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function archiveFileName(name: string): string {
  const stem = name.trim().replace(/[\\/:*?"<>|]+/g, "-") || "Untitled Assembly";
  return /\.(acad|acasm)$/i.test(stem) ? stem : `${stem.replace(/\.aether$/i, "")}.acasm`;
}

function downloadFile(fileName: string, bytes: Uint8Array): void {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const url = URL.createObjectURL(new Blob([ownedBytes.buffer], { type: "application/vnd.aether.workspace+zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function messageFor(error: unknown): string {
  if (error instanceof AssemblyBridgeError) return `${error.message}${error.path ? ` (${error.path})` : ""}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export class CADAssemblyController {
  private readonly writable: () => boolean;
  private readonly validateContacts: (assembly: AssemblyProjectionV1) => Promise<void>;
  private readonly compose: NonNullable<CADAssemblyControllerOptions['compose']>;
  private composing = false;
  private isolatedUITransaction = false;
  private readonly editHistory = new AssemblyEditHistory<AssemblyProjectionV1>();
  private readonly client: AssemblyControllerClient;
  private readonly store: CADAssemblyWorkspaceStore;
  private readonly saveFile: (fileName: string, bytes: Uint8Array) => void | Promise<void>;
  private readonly onDocumentChanged: (document: AssemblyDocumentSummary | null) => void;
  private readonly onStatus: (message: string, tone: "normal" | "error" | "success") => void;
  private descriptor: AssemblyWorkspaceDescriptor | null = null;
  private canonical: CanonicalSnapshot | null = null;
  private operation = 0;
  private readonly unsubscribeActions: () => void;

  constructor(options: CADAssemblyControllerOptions = {}) {
    this.writable = options.writable ?? (() => true);
    this.validateContacts = options.validateContacts ?? (async () => { throw Error("Exact contact validation is unavailable. No edit was applied."); });
    this.compose = options.compose ?? composeAssembly;
    this.client = options.client ?? new AssemblyBridgeClient({ baseURL: "" });
    this.store = options.store ?? cadAssemblyWorkspace;
    this.saveFile = options.saveFile ?? downloadFile;
    this.onDocumentChanged = options.onDocumentChanged ?? (() => undefined);
    this.onStatus = options.onStatus ?? (() => undefined);
    this.unsubscribeActions = this.store.subscribeActions((action) => {
      if (action.type === "select-entities") this.publishCanonical();
      if (action.type === "select-bom-mode") void this.selectBOMMode(action.mode);
    });
  }

  get document(): AssemblyDocumentSummary | null {
    const descriptor = this.descriptor;
    return descriptor ? {
      name: descriptor.name,
      workspaceID: descriptor.workspace_id,
      assemblyID: descriptor.root_assembly_id,
      revision: this.canonical?.assembly.revision ?? descriptor.revision,
    } : null;
  }

  get selectedInstance(): AssemblyInstanceProjection | null {
    const canonical = this.canonical;
    const selectedIDs = [...this.store.snapshot().selectedEntityIDs];
    if (!canonical || selectedIDs.length !== 1) return null;
    return canonical.assembly.instances.find(({ id }) => id === selectedIDs[0]) ?? null;
  }

  get canEditSelectedInstance(): boolean {
    return Boolean(
      this.selectedInstance &&
      this.canonical?.assembly.capabilities.can_edit_instances,
    );
  }

  get canEditInstances(): boolean {
    return Boolean(
      this.descriptor &&
      this.canonical?.assembly.capabilities.can_edit_instances,
    );
  }

  get canAddConnector(): boolean {
    return Boolean(
      this.selectedInstance &&
      this.canonical?.assembly.capabilities.can_edit_connectors,
    );
  }

  get canAddMate(): boolean {
    const assembly = this.canonical?.assembly;
    if (!assembly || assembly.capabilities.supported_mate_type_ids.length === 0) return false;
    const eligibleInstanceIDs = new Set(
      assembly.instances
        .filter((instance) => !instance.suppressed && assembly.connector_definitions.some(
          (connector) => !connector.suppressed && connector.part_definition_id === instance.definition_id,
        ))
        .map(({ id }) => id),
    );
    return eligibleInstanceIDs.size >= 2;
  }

  get selectedMate(): MateProjection | null {
    const canonical = this.canonical;
    const selectedIDs = [...this.store.snapshot().selectedEntityIDs];
    if (!canonical || selectedIDs.length !== 1) return null;
    return canonical.assembly.mates.find(({ id }) => id === selectedIDs[0]) ?? null;
  }

  get canEditSelectedMate(): boolean {
    const mate = this.selectedMate;
    return Boolean(
      mate && this.canonical?.assembly.capabilities.supported_mate_type_ids.includes(mate.type_id),
    );
  }

  get selectedMateDOF(): DOFProjection | null {
    const mate = this.selectedMate;
    return mate && !mate.suppressed ? mate.dofs.find(dof => dof.state === "free") ?? null : null;
  }

  get canEditSelectedMateDOF(): boolean {
    return Boolean(
      this.canEditSelectedMate &&
      !this.selectedMate?.suppressed &&
      this.selectedMateDOF?.state === "free",
    );
  }

  get canAddRelation(): boolean {
    if (!this.canonical?.assembly.capabilities.can_edit_relations) return false;
    const options = this.relationDOFOptions();
    const rotations = options.filter(({ kind }) => kind === "rotation").length;
    const translations = options.length - rotations;
    return rotations >= 2 || translations >= 2 || (rotations >= 1 && translations >= 1);
  }

  async newWorkspace(name: string): Promise<void> {
    await this.load("Creating the canonical Assembly workspace…", (signal) =>
      this.client.newWorkspace(name, signal));
  }

  get geometryProjection(): AssemblyProjectionV1 | null { return this.canonical?.assembly ?? null; }
  get solutionProjection(): AssemblySolutionProjection | null { return this.canonical?.solution ?? null; }
  get bomProjection(): BOMProjectionV1 | null { return this.canonical?.bom ?? null; }

  /** Edit an isolated canonical workspace, then swap only a fully solved,
   * still-current archive into the editor. Cancellation never leaves a hidden
   * mutation on the live handle. Uses the same native operations as UI edits. */
  async editAtomically(method: AssemblyMutationMethod, params: Readonly<Record<string, unknown>>, expectedRevision: string,
    signal = new AbortController().signal, assertCurrent: () => void = () => {}): Promise<void> {
    signal.throwIfAborted(); assertCurrent();
    if (this.composing) throw Error('An assembly edit is already rebuilding.');
    const descriptor = this.descriptor, source = this.canonical;
    if (!descriptor || !source || !this.writable()) throw Error('Open an editable Assembly first.');
    if (source.assembly.revision !== expectedRevision) throw Error('The Assembly revision changed. Inspect it before editing.');
    this.composing = true;
    let candidate: AssemblyWorkspaceDescriptor | undefined;
    let adopted = false;
    try {
      const before = await this.client.saveWorkspace(descriptor.handle, expectedRevision, signal);
      if (before.revision !== expectedRevision) throw Error('The Assembly changed before serialization.');
      candidate = await this.client.openWorkspace(before.data_base64, signal);
      if (candidate.workspace_id !== descriptor.workspace_id || candidate.revision !== expectedRevision || candidate.handle === descriptor.handle) throw Error('Unexpected isolated Assembly identity.');
      signal.throwIfAborted(); assertCurrent();
      const result = await this.client.mutate(method, { ...params, assembly_id: source.assembly.assembly_id,
        handle: candidate.handle, expected_revision: expectedRevision }, signal);
      this.assertRevision(result.revision, result.assembly, result.solution, result.bom);
      if (result.assembly.assembly_id !== source.assembly.assembly_id || result.solution.status !== 'solved' || result.solution.limit_violations.length > 0 || result.assembly.issues.some(issue => issue.severity === 'error')) throw Error('Assembly edit did not produce a solved result. No edit was applied.');
      const after = await this.client.saveWorkspace(candidate.handle, result.revision, signal);
      if (after.revision !== result.revision) throw Error('The isolated Assembly changed before serialization.');
      let bom = result.bom;
      if (bom.mode !== source.bom.mode) bom = await this.client.projectBOM(candidate.handle, source.assembly.assembly_id, source.bom.mode, signal);
      this.assertRevision(after.revision, result.assembly, result.solution, bom);
      if (liveContactSets(result.assembly).length) await this.validateContacts(result.assembly);
      signal.throwIfAborted(); assertCurrent();
      if (!this.writable() || this.descriptor !== descriptor || this.canonical !== source)
        throw Error('The Assembly changed while editing. No edit was applied.');
      if (result.assembly.workspace_id !== descriptor.workspace_id || bom.assembly_id !== source.assembly.assembly_id)
        throw Error('Unexpected isolated Assembly identity.');
      // The mutation already returned the solved projection and coherent BOM.
      // Adopt that qualified candidate instead of reopening and solving it again.
      this.descriptor = { ...candidate, revision: after.revision, graph_sha256: after.graph_sha256, root_assembly_id: source.assembly.assembly_id };
      this.canonical = { assembly: result.assembly, solution: result.solution, bom };
      this.editHistory.record(before.data_base64, after.data_base64, source.assembly, result.assembly);
      adopted = true;
      this.publishCanonical();
      this.publishDocument();
    } finally {
      if (adopted) await this.client.release(descriptor.handle).catch(() => undefined);
      else if (candidate && candidate.handle !== descriptor.handle) await this.client.release(candidate.handle).catch(() => undefined);
      this.composing = false;
    }
  }

  get canUndoRecipe(): boolean { return this.editHistory.canMove(-1, this.canonical?.assembly ?? null); }
  get canRedoRecipe(): boolean { return this.editHistory.canMove(1, this.canonical?.assembly ?? null); }

  /** Build on a serialized snapshot. Only a fully qualified, still-current result
   * replaces the live handle; failures never mutate the active document. */
  async composeRecipe(recipe: unknown, signal = new AbortController().signal, assertCurrent: () => void = () => {}): Promise<Omit<AssemblyComposeResult,'data_base64'>> {
    signal.throwIfAborted(); assertCurrent();
    if (this.composing) throw Error('An assembly edit is already rebuilding.');
    const descriptor = this.descriptor, canonical = this.canonical;
    if (!descriptor || !canonical || !this.canEditInstances || !this.writable()) throw Error('Open an editable Assembly first.');
    this.composing = true;
    try {
      signal.throwIfAborted();
      const archive = await this.client.saveWorkspace(descriptor.handle, canonical.assembly.revision, signal);
      if (archive.revision !== canonical.assembly.revision) throw Error('The Assembly changed before serialization.');
      const result = await this.compose({data_base64:archive.data_base64, expected_revision:archive.revision,
        assembly_id:canonical.assembly.assembly_id, recipe}, signal);
      const committed = await this.replaceRecipeArchive(result.data_base64, descriptor, canonical, signal, result.revision, assertCurrent);
      if (committed === this.canonical) this.editHistory.record(archive.data_base64, result.data_base64, canonical.assembly, committed.assembly);
      this.publishCanonical();
      const {data_base64: _archive, ...receipt} = result;
      this.onStatus(`Verified ${Object.keys(result.ids.parts).length} Part templates and ${Object.keys(result.ids.instances).length} new instances.`, 'success');
      return receipt;
    } finally { this.composing = false; }
  }

  async undoRecipe(direction: -1|1, signal = new AbortController().signal, assertCurrent: () => void = () => {}): Promise<void> {
    signal.throwIfAborted(); assertCurrent();
    if (!this.writable() || this.composing || !(direction === -1 ? this.canUndoRecipe : this.canRedoRecipe)) throw Error('No matching atomic Assembly edit history is available.');
    const source = this.canonical!;
    const archive = this.editHistory.target(direction, source.assembly);
    this.composing = true;
    try {
      const committed = await this.replaceRecipeArchive(archive, this.descriptor!, source, signal, undefined, assertCurrent);
      if (committed === this.canonical) this.editHistory.moved(direction, source.assembly, committed.assembly);
      this.publishCanonical();
    } finally { this.composing = false; }
  }

  private async replaceRecipeArchive(encoded:string, previous:AssemblyWorkspaceDescriptor, source:CanonicalSnapshot, signal:AbortSignal, revision?:string, assertCurrent:()=>void = () => {}):Promise<CanonicalSnapshot> {
    const fresh = await this.client.openWorkspace(encoded, signal);
    let committed = false;
    try {
      if (fresh.workspace_id !== previous.workspace_id || (revision && fresh.revision !== revision)) throw Error('Unexpected assembly archive identity.');
      const assemblyID = source.assembly.assembly_id;
      // Keep requests bounded; each uses this immutable archive in CAD's own worker.
      const assembly = await this.client.describeAssembly(fresh.handle, assemblyID, signal);
      const solution = await this.client.solveAssembly(fresh.handle, assemblyID, signal);
      const bom = await this.client.projectBOM(fresh.handle, assemblyID, source.bom.mode, signal);
      this.assertRevision(fresh.revision,assembly,solution,bom);
      if (liveContactSets(assembly).length) await this.validateContacts(assembly);
      signal.throwIfAborted(); assertCurrent();
      if (!this.writable() || this.descriptor !== previous || this.canonical !== source) throw Error('The Assembly changed while rebuilding. No recipe edit was applied.');
      this.descriptor = {...fresh,root_assembly_id:assemblyID};
      const next = {assembly,solution,bom};
      this.canonical = next;
      committed = true;
      this.publishCanonical();
      this.publishDocument();
      return next;
    } finally {
      await this.client.release(committed ? previous.handle : fresh.handle).catch(() => undefined);
    }
  }

  async selectProjectAssembly(id: string): Promise<void> {
    if (!this.descriptor) throw new Error("Open a project first.");
    this.descriptor = {...this.descriptor, root_assembly_id:id};
    await this.activate(this.descriptor, ++this.operation);
  }

  async openFile(file: Blob & { readonly name?: string }): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) throw new Error("The selected .aether workspace is empty.");
    await this.load(`Opening ${file.name ?? "Assembly workspace"}…`, (signal) =>
      this.client.openWorkspace(encodeBase64(bytes), signal));
  }

  async save(): Promise<void> {
    const descriptor = this.descriptor;
    const revision = this.canonical?.assembly.revision;
    if (!descriptor || !revision) throw new Error("No canonical Assembly workspace is open.");
    this.onStatus("Serializing the canonical Assembly workspace…", "normal");
    try {
      const archive = await this.client.saveWorkspace(descriptor.handle, revision);
      if (archive.revision !== revision) throw new Error("Core returned an incoherent workspace revision.");
      const fileName = archiveFileName(descriptor.name);
      await this.saveFile(fileName, decodeBase64(archive.data_base64));
      this.onStatus(`Saved ${fileName} through Aether Core.`, "success");
    } catch (error) {
      this.onStatus(`Assembly save failed: ${messageFor(error)}`, "error");
      throw error;
    }
  }

  async refresh(): Promise<void> {
    if (!this.descriptor) throw new Error("No canonical Assembly workspace is open.");
    await this.activate(this.descriptor, ++this.operation);
  }

  /** A compound UI action runs on a private controller and archive. Its helpers
   * can inspect intermediate IDs/poses, while the live editor sees only the
   * original state until the complete action is qualified and adopted. */
  private async compoundEdit(work: (candidate: CADAssemblyController) => Promise<void>): Promise<void> {
    if (this.composing) throw Error('An assembly edit is already rebuilding.');
    const previous = this.descriptor, source = this.canonical;
    if (!previous || !source || !this.writable()) throw Error('Open an editable Assembly first.');
    this.composing = true;
    let opened: AssemblyWorkspaceDescriptor | undefined, candidate: CADAssemblyController | undefined, adopted = false;
    let status: readonly [string, "normal" | "error" | "success"] | undefined;
    const signal = new AbortController().signal;
    try {
      const before = await this.client.saveWorkspace(previous.handle, source.assembly.revision, signal);
      if (before.revision !== source.assembly.revision) throw Error('The Assembly changed before serialization.');
      opened = await this.client.openWorkspace(before.data_base64, signal);
      if (opened.handle === previous.handle || opened.workspace_id !== previous.workspace_id || opened.revision !== source.assembly.revision)
        throw Error('Unexpected isolated Assembly identity.');
      candidate = new CADAssemblyController({ client: this.client, store: new CADAssemblyWorkspaceStore(),
        writable: () => this.writable() && this.descriptor === previous && this.canonical === source,
        onStatus: (message, tone) => { status = [message, tone]; } });
      candidate.isolatedUITransaction = true;
      candidate.descriptor = { ...opened, root_assembly_id: source.assembly.assembly_id };
      candidate.canonical = source;
      candidate.publishCanonical();
      candidate.store.dispatch({ type: "select-entities", ids: [...this.store.snapshot().selectedEntityIDs], mode: "range" });
      await work(candidate);
      const next = candidate.canonical!;
      if (next === source) { if (status) this.onStatus(...status); return; }
      if (next.assembly.assembly_id !== source.assembly.assembly_id || next.assembly.workspace_id !== previous.workspace_id
        || next.solution.status !== 'solved' || next.solution.limit_violations.length || next.assembly.issues.some(issue => issue.severity === 'error'))
        throw Error('The complete Assembly action did not produce a solved result.');
      const bom = next.bom.mode === source.bom.mode ? next.bom
        : await this.client.projectBOM(opened.handle, source.assembly.assembly_id, source.bom.mode, signal);
      this.assertRevision(next.assembly.revision, next.assembly, next.solution, bom);
      if (bom.assembly_id !== source.assembly.assembly_id) throw Error('Unexpected isolated Assembly identity.');
      if (liveContactSets(next.assembly).length) await this.validateContacts(next.assembly);
      const after = await this.client.saveWorkspace(opened.handle, next.assembly.revision, signal);
      if (after.revision !== next.assembly.revision) throw Error('The isolated Assembly changed before serialization.');
      if (!this.writable() || this.descriptor !== previous || this.canonical !== source)
        throw Error('The Assembly changed while editing.');
      this.descriptor = { ...opened, root_assembly_id: source.assembly.assembly_id, revision: after.revision, graph_sha256: after.graph_sha256 };
      this.canonical = { ...next, bom };
      this.editHistory.record(before.data_base64, after.data_base64, source.assembly, next.assembly);
      adopted = true;
      this.publishCanonical(); this.publishDocument();
      if (status) this.onStatus(...status);
    } catch (error) {
      this.onStatus(`Assembly action failed: ${messageFor(error)} No edit was applied.`, "error");
      throw error;
    } finally {
      candidate?.dispose();
      if (adopted) await this.client.release(previous.handle).catch(() => undefined);
      else if (opened && opened.handle !== previous.handle) await this.client.release(opened.handle).catch(() => undefined);
      this.composing = false;
    }
  }

  async mutate(method: AssemblyMutationMethod, params: Readonly<Record<string, unknown>>): Promise<void> {
    if (!this.writable()) throw Error('The Assembly is read-only.');
    if (this.composing) throw Error('An assembly edit is already rebuilding.');
    const descriptor = this.descriptor;
    const revision = this.canonical?.assembly.revision;
    if (!descriptor || !revision) throw new Error("No canonical Assembly workspace is open.");
    if (this.isolatedUITransaction) {
      const result = await this.client.mutate(method, { ...params, assembly_id: this.canonical!.assembly.assembly_id,
        handle: descriptor.handle, expected_revision: revision }, new AbortController().signal);
      this.assertRevision(result.revision, result.assembly, result.solution, result.bom);
      this.descriptor = { ...descriptor, revision: result.revision };
      this.canonical = { assembly: result.assembly, solution: result.solution, bom: result.bom };
      this.publishCanonical();
      return;
    }
    return this.editAtomically(method, params, revision);
  }

  async selectBOMMode(mode: "hierarchical" | "flattened"): Promise<void> {
    const descriptor = this.descriptor;
    const canonical = this.canonical;
    if (!descriptor || !canonical || canonical.bom.mode === mode) return;
    this.onStatus(`Loading ${mode} bill of materials…`, "normal");
    try {
      const bom = await this.client.projectBOM(
        descriptor.handle,
        canonical.assembly.assembly_id,
        mode,
      );
      if (this.canonical !== canonical) return;
      this.assertRevision(
        canonical.assembly.revision,
        canonical.assembly,
        canonical.solution,
        bom,
      );
      this.canonical = { ...canonical, bom };
      this.publishCanonical();
      this.onStatus(`BOM view: ${mode}.`, "success");
    } catch (error) {
      this.onStatus(`BOM projection failed: ${messageFor(error)}`, "error");
    }
  }

  async toggleSelectedInstanceGrounded(): Promise<void> {
    const instance = this.requireEditableSelectedInstance();
    await this.mutateSelectedInstance(
      "set_instance_grounded",
      { instance_id: instance.id, grounded: !instance.grounded },
      `${instance.name} is now ${instance.grounded ? "free" : "grounded"}.`,
    );
  }

  async toggleSelectedInstanceSuppressed(): Promise<void> {
    const instance = this.requireEditableSelectedInstance();
    await this.mutateSelectedInstance(
      "set_instance_suppressed",
      { instance_id: instance.id, suppressed: !instance.suppressed },
      `${instance.name} is now ${instance.suppressed ? "restored" : "suppressed"}.`,
    );
  }

  async removeSelectedInstance(): Promise<void> {
    const instance = this.requireEditableSelectedInstance();
    await this.mutateSelectedInstance(
      "remove_instance",
      { instance_id: instance.id },
      `Removed ${instance.name} from the canonical Assembly.`,
    );
  }

  async insertComponent(draft: AssemblyComponentDraft): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.insertComponent(draft));
    const normalized = normalizeAssemblyComponentDraft(draft);
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID || !this.canEditInstances) {
      throw new Error("The current Assembly workspace does not permit component insertion.");
    }
    const existingDefinitionIDs = new Set(
      this.canonical?.assembly.part_definitions.map(({ id }) => id) ?? [],
    );

    try {
      await this.mutate("add_part_definition", {
        assembly_id: assemblyID,
        part_definition: {
          name: normalized.partName,
          part_number: normalized.partNumber,
          mass_kg: normalized.massKg,
          source: {
            kind: "authored",
            label: normalized.sourceLabel,
          },
          custom_properties: [],
        },
      });
    } catch (error) {
      this.onStatus(`Component insertion failed: ${messageFor(error)}`, "error");
      throw error;
    }

    const newDefinitionIDs = this.canonical?.assembly.part_definitions
      .map(({ id }) => id)
      .filter((id) => !existingDefinitionIDs.has(id)) ?? [];
    if (newDefinitionIDs.length !== 1) {
      const error = new Error("Core did not return exactly one new Part definition ID.");
      this.onStatus(`Component insertion failed: ${error.message}`, "error");
      throw error;
    }
    const partDefinitionID = newDefinitionIDs[0];

    try {
      await this.mutate("add_instance", {
        assembly_id: assemblyID,
        instance: {
          parent_assembly_id: assemblyID,
          definition_kind: "part",
          definition_id: partDefinitionID,
          name: normalized.instanceName,
          rest_transform: {
            position_m: [...normalized.positionM],
            rotation_quaternion_xyzw: [0, 0, 0, 1],
          },
          grounded: normalized.grounded,
        },
      });
      this.onStatus(`Inserted ${normalized.instanceName} into the canonical Assembly.`, "success");
    } catch (error) {
      this.onStatus(`Component insertion failed: ${messageFor(error)}`, "error");
      throw error;
    }
  }

  async addConnector(draft: AssemblyConnectorDraft): Promise<void> {
    const normalized = normalizeAssemblyConnectorDraft(draft);
    const instance = this.selectedInstance;
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!instance || !assemblyID || !this.canAddConnector) {
      throw new Error("Select exactly one component in an editable canonical Assembly.");
    }
    const existingConnectorIDs = new Set(
      this.canonical?.assembly.connector_definitions.map(({ id }) => id) ?? [],
    );
    try {
      await this.mutate("add_connector", {
        assembly_id: assemblyID,
        connector: {
          part_definition_id: instance.definition_id,
          name: normalized.name,
          frame_part_local: {
            origin_m: [...normalized.originM],
            primary_axis_xyz: [...normalized.primaryAxisXYZ],
            secondary_axis_xyz: [...normalized.secondaryAxisXYZ],
          },
          provenance: {
            kind: "manual",
            stable_feature_id: null,
            label: normalized.provenanceLabel,
          },
        },
      });
    } catch (error) {
      this.onStatus(`Mate connector creation failed: ${messageFor(error)}`, "error");
      throw error;
    }
    const newConnectorIDs = this.canonical?.assembly.connector_definitions
      .map(({ id }) => id)
      .filter((id) => !existingConnectorIDs.has(id)) ?? [];
    if (newConnectorIDs.length !== 1) {
      const error = new Error("Core committed the connector but did not return exactly one new stable ID.");
      this.onStatus(error.message, "error");
      throw error;
    }
    this.store.dispatch({ type: "select-entities", ids: [newConnectorIDs[0]], mode: "single" });
    this.onStatus(`Added ${normalized.name} to ${instance.name}.`, "success");
  }

  async previewMate(draft: AssemblyMateDraft): Promise<AssemblyMatePreviewProjection> {
    const { descriptor, canonical, payload, normalized } = this.requireMateContext(draft);
    this.onStatus(`Previewing ${normalized.name} through Aether Core…`, "normal");
    try {
      const preview = await this.client.previewMate(
        descriptor.handle,
        canonical.assembly.assembly_id,
        payload,
      );
      if (this.canonical !== canonical || preview.revision !== canonical.assembly.revision) {
        throw new Error("Assembly changed while the mate preview was running.");
      }
      this.onStatus(
        `${normalized.name} preview: ${preview.solution.status}, ${preview.solution.remaining_free_dof_count} free DOF.`,
        preview.solution.status === "solved" ? "success" : "error",
      );
      return preview;
    } catch (error) {
      this.onStatus(`Mate preview failed: ${messageFor(error)}`, "error");
      throw error;
    }
  }

  async addMate(draft: AssemblyMateDraft): Promise<void> {
    const { canonical, payload, normalized } = this.requireMateContext(draft);
    const existingMateIDs = new Set(canonical.assembly.mates.map(({ id }) => id));
    try {
      await this.mutate("add_mate", {
        assembly_id: canonical.assembly.assembly_id,
        mate: payload,
      });
    } catch (error) {
      this.onStatus(`Mate commit failed: ${messageFor(error)}`, "error");
      throw error;
    }
    const newMateIDs = this.canonical?.assembly.mates
      .map(({ id }) => id)
      .filter((id) => !existingMateIDs.has(id)) ?? [];
    if (newMateIDs.length !== 1) {
      const error = new Error("Core committed the mate but did not return exactly one new stable ID.");
      this.onStatus(error.message, "error");
      throw error;
    }
    this.store.dispatch({ type: "select-entities", ids: [newMateIDs[0]], mode: "single" });
    this.onStatus(`Committed ${normalized.name} to the canonical Assembly.`, "success");
  }

  async toggleSelectedMateSuppressed(): Promise<void> {
    const mate = this.requireEditableSelectedMate();
    await this.mutateSelectedMate(
      "update_mate",
      { mate: assemblyMateUpdatePayload(mate, { suppressed: !mate.suppressed }) },
      `${mate.name} is now ${mate.suppressed ? "restored" : "suppressed"}.`,
    );
  }

  async removeSelectedMate(): Promise<void> {
    const mate = this.requireEditableSelectedMate();
    await this.mutateSelectedMate(
      "remove_mate",
      { mate_id: mate.id },
      `Removed ${mate.name} from the canonical Assembly.`,
    );
    this.store.dispatch({ type: "select-entities", ids: [], mode: "single" });
  }

  async setSelectedMateDOFValue(draft: AssemblyMateDOFEditorDraft): Promise<void> {
    const { dof } = this.requireEditableSelectedMateDOF(draft);
    await this.mutateSelectedMate(
      "set_dof_value",
      assemblyMateDOFValuePayload(draft),
      `Set ${dof.name} to ${draft.value}${dof.kind === "rotation" ? "°" : " m"}.`,
    );
  }

  async updateSelectedMateDOFLimits(draft: AssemblyMateDOFEditorDraft): Promise<void> {
    const { mate, dof } = this.requireEditableSelectedMateDOF(draft);
    await this.mutateSelectedMate(
      "update_mate",
      { mate: assemblyMateDOFLimitsPayload(mate, draft) },
      `${dof.name} limits are now ${draft.limitsEnabled ? "enabled" : "unbounded"}.`,
    );
  }

  get canEditContacts(): boolean {
    return this.writable() && Boolean(this.canonical?.assembly.capabilities.can_edit_contacts) && (this.canonical?.assembly.instances.filter((i) => !i.suppressed).length ?? 0) >= 2;
  }
  get contactsEnabled(): boolean { return Boolean(this.canonical?.assembly.contacts_enabled); }

  async addContactSet(draft: AssemblyContactSetDraft): Promise<void> {
    const canonical = this.canonical;
    if (!canonical || !this.canEditContacts) throw new Error("The current Assembly cannot hold contact sets.");
    try {
      this.validateContactDraft(draft);
      await this.mutate("add_contact_set", { assembly_id: canonical.assembly.assembly_id, contact_set: assemblyContactSetPayload(draft) });
    } catch (error) { this.onStatus(`Contact set creation failed: ${messageFor(error)}`, "error"); throw error; }
    this.onStatus(`Contact set added with ${new Set(draft.instanceIDs).size} occurrences.`, "success");
  }

  private validateContactDraft(draft: AssemblyContactSetDraft): void {
    const issues = [...assemblyContactSetDraftIssues(draft)];
    if (draft.instanceIDs.some(id => !this.canonical?.assembly.instances.some(instance => instance.id === id)))
      issues.push("A selected occurrence is no longer in this assembly.");
    if (issues.length) throw Error(issues.join(" "));
  }

  private assertContactSource(source: import("./cad-assembly-bridge").ContactSetProjection): void {
    if (!this.writable() || !this.canonical?.assembly.capabilities.can_edit_contacts) throw Error("The Assembly is read-only or contact editing is unavailable.");
    if (!this.canonical.assembly.contact_sets?.includes(source)) throw Error("The contact set changed. Reopen its editor before applying this change.");
  }

  async updateContactSet(source: import("./cad-assembly-bridge").ContactSetProjection, draft: AssemblyContactSetDraft): Promise<void> {
    try {
      this.assertContactSource(source); this.validateContactDraft(draft);
      await this.mutate("update_contact_set", { contact_set: { ...source, ...assemblyContactSetPayload(draft) } });
      this.onStatus("Contact set updated.", "success");
    } catch (error) { this.onStatus(`Contact set update failed: ${messageFor(error)}`, "error"); throw error; }
  }
  // ---- Components beyond insertion (SolidCraft's component.*) ----------------

  private definitionOf(instance: AssemblyInstanceProjection): PartDefinitionProjection {
    const definition = this.canonical?.assembly.part_definitions.find(({ id }) => id === instance.definition_id);
    if (!definition) throw new Error(`The part of ${instance.name} is not in the workspace.`);
    return definition;
  }
  private documentOf(definition: PartDefinitionProjection): PartDocument {
    if (!definition.feature_document) throw new Error(`${definition.name} carries no feature document to split.`);
    return parsePartDocument(JSON.stringify(definition.feature_document));
  }
  /** update_part_definition replaces the whole definition, so send it whole. */
  private async replaceDefinition(definition: PartDefinitionProjection, patch: Partial<PartDefinitionProjection>): Promise<void> {
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID) throw new Error("No canonical Assembly workspace is open.");
    const next = { ...definition, ...patch };
    // A saved Part is owned by its assigned definition ID. Copies, extracted
    // bodies and regenerated standard parts bring their own document identity.
    const part = next.feature_document === undefined ? next : { ...next,
      feature_document: { ...this.documentOf(next), documentId: next.id, name: next.name } };
    await this.mutate("update_part_definition", { assembly_id: assemblyID, part_definition: part });
  }
  /** Add a definition and occurrence inside their caller’s isolated compound action. */
  private async addDefinitionWithInstance(definition: Record<string, unknown>, instance: Record<string, unknown>): Promise<string> {
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID || !this.canEditInstances) throw new Error("The current Assembly workspace does not permit component insertion.");
    const before = new Set(this.canonical?.assembly.part_definitions.map(({ id }) => id) ?? []);
    const { feature_document: document, ...metadata } = definition;
    await this.mutate("add_part_definition", { assembly_id: assemblyID, part_definition: metadata });
    const added = (this.canonical?.assembly.part_definitions ?? []).map(({ id }) => id).filter((id) => !before.has(id));
    if (added.length !== 1) throw new Error("Core did not return exactly one new Part definition ID.");
    // The codec assigns the ID. Attach geometry only after we have it; the
    // surrounding compound action keeps this intermediate definition private.
    if (document !== undefined) {
      const assigned = this.canonical!.assembly.part_definitions.find(part => part.id === added[0])!;
      await this.replaceDefinition(assigned, { feature_document: document });
    }
    await this.mutate("add_connector", { assembly_id: assemblyID, connector: {
      part_definition_id: added[0], name: "Origin",
      frame_part_local: {origin_m:[0,0,0],primary_axis_xyz:[0,0,1],secondary_axis_xyz:[1,0,0]},
      provenance: {kind:"manual",label:"Part origin",stable_feature_id:null},
    } });
    const needsAnchor = !this.canonical!.assembly.instances.some(item => item.grounded && !item.suppressed);
    await this.mutate("add_instance", { assembly_id: assemblyID, instance: { parent_assembly_id: assemblyID, definition_kind: "part", definition_id: added[0], grounded: needsAnchor, ...instance } });
    return added[0];
  }

  /** component.metadata.set: part number, description and custom properties of the selected occurrence's part. */
  async updatePartProperties(draft: PartPropertiesDraft): Promise<void> {
    const issues = partPropertiesDraftIssues(draft);
    if (issues.length) throw new Error(issues.join(" "));
    const instance = this.requireEditableSelectedInstance();
    const definition = this.definitionOf(instance);
    try {
      await this.replaceDefinition(definition, {
        part_number: draft.partNumber.trim() || null,
        description: draft.description.trim() || null,
        custom_properties: parseCustomProperties(draft.properties),
      });
      this.onStatus(`Updated the properties of ${definition.name}.`, "success");
    } catch (error) { this.onStatus(`Part properties failed: ${messageFor(error)}`, "error"); throw error; }
  }

  /** component.paste_new: an independent copy of the selected occurrence's part, placed on top of it. */
  async copySelectedInstanceIndependent(): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.copySelectedInstanceIndependent());
    const instance = this.requireEditableSelectedInstance();
    const definition = this.definitionOf(instance);
    try {
      const { id: _id, ...rest } = definition;
      await this.addDefinitionWithInstance(
        { ...structuredClone(rest), name: `${definition.name} copy` },
        { name: `${instance.name} copy`, rest_transform: structuredClone(instance.rest_transform) },
      );
      this.onStatus(`Made ${instance.name} copy independent: its own part, edits no longer shared.`, "success");
    } catch (error) { this.onStatus(`Make independent failed: ${messageFor(error)}`, "error"); throw error; }
  }

  /** Another occurrence of the selected part: the same definition, placed on top of the original. */
  async addLinkedCopyOfSelectedInstance(): Promise<void> {
    const instance = this.requireEditableSelectedInstance();
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID) throw new Error("No canonical Assembly workspace is open.");
    const count = this.canonical?.assembly.instances.filter(({ definition_id }) => definition_id === instance.definition_id).length ?? 1;
    try {
      await this.mutate("add_instance", { assembly_id: assemblyID, instance: {
        parent_assembly_id: assemblyID, definition_kind: "part", definition_id: instance.definition_id,
        name: `${instance.name.replace(/:\d+$/, "")}:${count + 1}`, rest_transform: structuredClone(instance.rest_transform), grounded: false,
      } });
      this.onStatus(`Added another occurrence of ${this.definitionOf(instance).name}.`, "success");
    } catch (error) { this.onStatus(`Linked copy failed: ${messageFor(error)}`, "error"); throw error; }
  }

  /** component.from_bodies / move_bodies / move_sketches. A new target makes one component
   *  per body (sketches go with the first); an existing target receives them all. Every
   *  occurrence of the source part loses the moved bodies: parts are shared definitions. */
  async moveBodiesToComponent(draft: BodiesToComponentDraft): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.moveBodiesToComponent(draft));
    const issues = bodiesToComponentDraftIssues(draft);
    if (issues.length) throw new Error(issues.join(" "));
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    const source = canonical.assembly.instances.find(({ id }) => id === draft.sourceInstanceID);
    if (!source) throw new Error("The source occurrence is gone.");
    const sourceDefinition = this.definitionOf(source);
    let remaining = this.documentOf(sourceDefinition);
    const bodyNames = new Map(availableBodies(remaining).map((b) => [b.id, b.name]));
    try {
      if (draft.target === "new") {
        const picks: { bodyIds: string[]; sketchIds: string[]; name: string }[] = draft.bodyIDs.map((id, index) => ({
          bodyIds: [id], sketchIds: index === 0 ? [...draft.sketchIDs] : [], name: draft.name.trim() || bodyNames.get(id) || `Body ${index + 1}`,
        }));
        if (!picks.length) picks.push({ bodyIds: [], sketchIds: [...draft.sketchIDs], name: draft.name.trim() || "Sketches" });
        for (const pick of picks) {
          const split = splitDocument(remaining, pick, pick.name);
          remaining = split.remaining;
          await this.addDefinitionWithInstance(
            { name: pick.name, part_number: null, mass_kg: null, source: { kind: "authored", label: `${sourceDefinition.name} › ${pick.name}` }, custom_properties: [], feature_document: split.extracted },
            { name: `${pick.name}:1`, rest_transform: structuredClone(source.rest_transform) },
          );
        }
        await this.replaceDefinition(sourceDefinition, { feature_document: remaining });
        this.onStatus(`Made ${picks.length} component${picks.length === 1 ? "" : "s"} from ${source.name}.`, "success");
      } else {
        const target = canonical.assembly.instances.find(({ id }) => id === draft.target);
        if (!target) throw new Error("The target occurrence is gone.");
        const targetDefinition = this.definitionOf(target);
        if (targetDefinition.id === sourceDefinition.id) throw Error("Source and target use the same Part definition. Make an independent copy first.");
        const split = splitDocument(remaining, { bodyIds: draft.bodyIDs, sketchIds: draft.sketchIDs }, targetDefinition.name);
        await this.replaceDefinition(targetDefinition, { feature_document: appendDocument(this.documentOf(targetDefinition), split.extracted) });
        await this.replaceDefinition(sourceDefinition, { feature_document: split.remaining });
        this.onStatus(`Moved ${draft.bodyIDs.length} bod${draft.bodyIDs.length === 1 ? "y" : "ies"} and ${draft.sketchIDs.length} sketch${draft.sketchIDs.length === 1 ? "" : "es"} from ${source.name} to ${target.name}.`, "success");
      }
    } catch (error) { this.onStatus(`Bodies to component failed: ${messageFor(error)}`, "error"); throw error; }
  }

  // ---- As-built joints and rigid groups (SolidCraft's joint.as_built / rigid_group) ----

  private placementOf(instance: AssemblyInstanceProjection): Placement {
    const t = instance.solved_world_transform ?? instance.rest_transform;
    return { position_m: t.position_m, rotation_quaternion_xyzw: t.rotation_quaternion_xyzw };
  }
  private async addConnectorFrame(instance: AssemblyInstanceProjection, frame: WorldFrame, name: string): Promise<string> {
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID) throw new Error("No canonical Assembly workspace is open.");
    const before = new Set(this.canonical?.assembly.connector_definitions.map(({ id }) => id) ?? []);
    await this.mutate("add_connector", { assembly_id: assemblyID, connector: {
      part_definition_id: instance.definition_id, name,
      frame_part_local: { origin_m: [...frame.origin_m], primary_axis_xyz: [...frame.primary_axis_xyz], secondary_axis_xyz: [...frame.secondary_axis_xyz] },
      provenance: { kind: "manual", stable_feature_id: null, label: "as-built" },
    } });
    const added = (this.canonical?.assembly.connector_definitions ?? []).map(({ id }) => id).filter((id) => !before.has(id));
    if (added.length !== 1) throw new Error("Core did not return exactly one new connector ID.");
    return added[0];
  }
  /** joint.as_built: a mate between two occurrences where they stand, with connectors made to fit. */
  async addAsBuiltJoint(draft: AsBuiltJointDraft): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.addAsBuiltJoint(draft));
    const issues = asBuiltJointDraftIssues(draft);
    if (issues.length) throw new Error(issues.join(" "));
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    const a = canonical.assembly.instances.find(({ id }) => id === draft.aInstanceID), b = canonical.assembly.instances.find(({ id }) => id === draft.bInstanceID);
    if (!a || !b) throw new Error("An occurrence of the joint is gone.");
    const name = draft.name.trim() || `${draft.typeID} ${a.name} · ${b.name}`;
    try {
      const frames = asBuiltConnectorFrames(this.placementOf(a), this.placementOf(b), draft.at, draft.axis);
      const connectorA = await this.addConnectorFrame(a, frames.a, `${name} · A`);
      const connectorB = await this.addConnectorFrame(b, frames.b, `${name} · B`);
      await this.mutate("add_mate", { assembly_id: canonical.assembly.assembly_id, mate: {
        name, type_id: draft.typeID,
        endpoint_a: { instance_id: a.id, connector_definition_id: connectorA },
        endpoint_b: { instance_id: b.id, connector_definition_id: connectorB },
        dofs: [], controls: [],
      } });
      this.onStatus(`As-built ${draft.typeID} joint between ${a.name} and ${b.name}.`, "success");
    } catch (error) { this.onStatus(`As-built joint failed: ${messageFor(error)}`, "error"); throw error; }
  }
  /** joint.rigid_group: the selected occurrences move together as they are (fastened to the first). */
  async addRigidGroupFromSelection(): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.addRigidGroupFromSelection());
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    const ids = [...this.store.snapshot().selectedEntityIDs].filter((id) => canonical.assembly.instances.some((i) => i.id === id));
    if (ids.length < 2) { this.onStatus("Select two or more occurrences for a rigid group.", "error"); throw new Error("Select two or more occurrences."); }
    for (const other of ids.slice(1)) await this.addAsBuiltJoint({ name: `Rigid group · ${other}`, typeID: "fastened", aInstanceID: ids[0], bInstanceID: other });
    this.onStatus(`Rigid group of ${ids.length} occurrences.`, "success");
  }

  /** joint.reach: translate an occurrence so its origin (or `at`) lands on a world point. */
  async reachPoint(draft: { instanceID: string; pointMillimeters: readonly [number, number, number]; atMillimeters?: readonly [number, number, number] }): Promise<void> {
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    const instance = canonical.assembly.instances.find(({ id }) => id === draft.instanceID);
    if (!instance) throw new Error("The occurrence is gone.");
    if (!this.canEditInstances) throw new Error("The current Assembly workspace does not permit moving occurrences.");
    const at = draft.atMillimeters ? draft.atMillimeters.map((v) => v / 1000) : instance.rest_transform.position_m;
    const delta = draft.pointMillimeters.map((v, i) => v / 1000 - at[i]);
    const { solved_world_transform: _solved, source_status: _status, ...rest } = instance;
    try {
      await this.mutate("update_instance", { assembly_id: canonical.assembly.assembly_id, instance: { ...rest, rest_transform: { position_m: instance.rest_transform.position_m.map((v, i) => v + delta[i]), rotation_quaternion_xyzw: [...instance.rest_transform.rotation_quaternion_xyzw] } } });
      this.onStatus(`${instance.name} moved to reach the point.`, "success");
    } catch (error) { this.onStatus(`Reach point failed: ${messageFor(error)}`, "error"); throw error; }
  }

  /** parts.insert / parts.fastener: a standard part as a new definition and one occurrence. */
  async insertStandardPart(request: StandardPartRequest, positionMillimeters: readonly [number, number, number]): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.insertStandardPart(request, positionMillimeters));
    try {
      const document = standardPartDocument(request), label = standardPartLabel(request);
      const count = this.canonical?.assembly.instances.filter((i) => i.name.startsWith(`${label}:`)).length ?? 0;
      await this.addDefinitionWithInstance(
        { name: label, part_number: label, mass_kg: standardPartVolume(request) * 7850e-9, source: { kind: "authored", label }, custom_properties: standardPartProperties(request), feature_document: document },
        { name: `${label}:${count + 1}`, rest_transform: { position_m: positionMillimeters.map((v) => v / 1000), rotation_quaternion_xyzw: [0, 0, 0, 1] } },
      );
      this.onStatus(`Inserted ${label}.`, "success");
    } catch (error) { this.onStatus(`Standard part failed: ${messageFor(error)}`, "error"); throw error; }
  }
  /** parts.resize: regenerate the selected standard part at a new size; its occurrences and mates stay. */
  async resizeSelectedStandardPart(request: StandardPartRequest): Promise<void> {
    const instance = this.requireEditableSelectedInstance();
    const definition = this.definitionOf(instance);
    const current = standardPartFromProperties(definition.custom_properties);
    if (!current) throw new Error(`${definition.name} is not a standard part.`);
    if (current.family !== request.family) throw new Error("Resize keeps the family; insert a different part instead.");
    try {
      const label = standardPartLabel(request);
      await this.replaceDefinition(definition, {
        name: label, part_number: label, mass_kg: standardPartVolume(request) * 7850e-9, feature_document: standardPartDocument(request),
        custom_properties: [...definition.custom_properties.filter((p) => !p.key.startsWith("standard_part_")), ...standardPartProperties(request)],
      });
      this.onStatus(`Resized to ${label}.`, "success");
    } catch (error) { this.onStatus(`Resize failed: ${messageFor(error)}`, "error"); throw error; }
  }

  /** component.unlock: remove the fastened mates that hold the selected occurrences to each
   *  other (a rigid group, or an imported assembly's fixed joints), so they move one by one. */
  async unlockSelection(): Promise<void> {
    if (!this.isolatedUITransaction) return this.compoundEdit(candidate => candidate.unlockSelection());
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    const ids = new Set([...this.store.snapshot().selectedEntityIDs].filter((id) => canonical.assembly.instances.some((i) => i.id === id)));
    if (ids.size < 2) { this.onStatus("Select the occurrences to unlock (two or more).", "error"); throw new Error("Select two or more occurrences."); }
    const locks = canonical.assembly.mates.filter((m) => m.type_id === "fastened" && ids.has(m.endpoint_a.instance_id) && ids.has(m.endpoint_b.instance_id));
    if (!locks.length) { this.onStatus("Nothing holds these occurrences together.", "error"); return; }
    try {
      for (const mate of locks) await this.mutate("remove_mate", { assembly_id: canonical.assembly.assembly_id, mate_id: mate.id });
      this.onStatus(`Unlocked ${ids.size} occurrences: ${locks.length} fastened mate${locks.length === 1 ? "" : "s"} removed.`, "success");
    } catch (error) { this.onStatus(`Unlock failed: ${messageFor(error)}`, "error"); throw error; }
  }

  async removeContactSet(id: string, source?: import("./cad-assembly-bridge").ContactSetProjection): Promise<void> {
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    try {
      if (source) { this.assertContactSource(source); if (source.id !== id) throw Error("Contact selection changed."); }
      await this.mutate("remove_contact_set", { assembly_id: canonical.assembly.assembly_id, contact_set_id: id });
      this.onStatus("Contact set removed.", "success");
    } catch (error) { this.onStatus(`Contact set removal failed: ${messageFor(error)}`, "error"); throw error; }
  }
  async setContactsEnabled(enabled: boolean): Promise<void> {
    const canonical = this.canonical;
    if (!canonical) throw new Error("No canonical Assembly workspace is open.");
    try {
      await this.mutate("set_contacts_enabled", { assembly_id: canonical.assembly.assembly_id, enabled });
      this.onStatus(enabled ? "Contact checks enabled." : "Contact checks disabled.", "success");
    } catch (error) { this.onStatus(`Contact checks could not be changed: ${messageFor(error)}`, "error"); throw error; }
  }

  async addRelation(draft: AssemblyRelationDraft): Promise<void> {
    const canonical = this.canonical;
    if (!canonical || !this.canAddRelation) {
      throw new Error("The current Assembly does not expose compatible free DOFs for a relation.");
    }
    const payload = assemblyRelationPayload(draft, this.relationDOFOptions());
    const existingIDs = new Set(canonical.assembly.relations.map(({ id }) => id));
    try {
      await this.mutate("add_relation", {
        assembly_id: canonical.assembly.assembly_id,
        relation: payload,
      });
    } catch (error) {
      this.onStatus(`Relation creation failed: ${messageFor(error)}`, "error");
      throw error;
    }
    const newIDs = this.canonical?.assembly.relations
      .map(({ id }) => id)
      .filter((id) => !existingIDs.has(id)) ?? [];
    if (newIDs.length !== 1) {
      const error = new Error("Core committed the relation but did not return exactly one new stable ID.");
      this.onStatus(error.message, "error");
      throw error;
    }
    this.store.dispatch({ type: "select-entities", ids: [newIDs[0]], mode: "single" });
    this.onStatus(`Added ${draft.kind.replace("_", " ")} relation to the canonical Assembly.`, "success");
  }

  async close(): Promise<void> {
    const descriptor = this.descriptor;
    this.operation += 1;
    this.descriptor = null;
    this.canonical = null;
    this.editHistory.clear();
    this.store.setUnavailable();
    this.onDocumentChanged(null);
    if (descriptor) await this.client.release(descriptor.handle).catch(() => undefined);
  }

  dispose(): void {
    this.unsubscribeActions();
  }

  private async load(
    message: string,
    create: (signal: AbortSignal) => Promise<AssemblyWorkspaceDescriptor>,
  ): Promise<void> {
    const operation = ++this.operation;
    const previous = this.descriptor;
    const abort = new AbortController();
    this.store.setLoading(message);
    try {
      const descriptor = await create(abort.signal);
      if (operation !== this.operation) {
        await this.client.release(descriptor.handle).catch(() => undefined);
        return;
      }
      await this.activate(descriptor, operation);
      if (previous && previous.handle !== descriptor.handle) {
        await this.client.release(previous.handle).catch(() => undefined);
      }
      this.onStatus(`Opened canonical Assembly ${descriptor.name}.`, "success");
    } catch (error) {
      if (operation !== this.operation) return;
      const message = messageFor(error);
      this.store.setError(message);
      this.onStatus(`Assembly workspace failed: ${message}`, "error");
      throw error;
    }
  }

  private async activate(descriptor: AssemblyWorkspaceDescriptor, operation: number): Promise<void> {
    const assembly = await this.client.describeAssembly(descriptor.handle, descriptor.root_assembly_id);
    const solution = await this.client.solveAssembly(descriptor.handle, descriptor.root_assembly_id);
    const bom = await this.client.projectBOM(descriptor.handle, descriptor.root_assembly_id, "hierarchical");
    if (operation !== this.operation) return;
    this.assertRevision(descriptor.revision, assembly, solution, bom);
    this.descriptor = descriptor;
    this.canonical = { assembly, solution, bom };
    this.editHistory.clear();
    this.publishCanonical();
    this.publishDocument();
  }

  private assertRevision(
    revision: string,
    assembly: AssemblyProjectionV1,
    solution: AssemblySolutionProjection,
    bom: BOMProjectionV1,
  ): void {
    if ([assembly.revision, solution.revision, bom.revision].some((candidate) => candidate !== revision)) {
      throw new Error("Core returned mixed Assembly revisions; presentation was not updated.");
    }
  }

  private requireEditableSelectedInstance(): AssemblyInstanceProjection {
    const instance = this.selectedInstance;
    if (!instance) throw new Error("Select exactly one Assembly component instance.");
    if (!this.canonical?.assembly.capabilities.can_edit_instances) {
      throw new Error("The current Assembly workspace does not permit instance edits.");
    }
    return instance;
  }

  private requireEditableSelectedMate(): MateProjection {
    const mate = this.selectedMate;
    if (!mate) throw new Error("Select exactly one persistent Assembly mate.");
    if (!this.canonical?.assembly.capabilities.supported_mate_type_ids.includes(mate.type_id)) {
      throw new Error("The selected mate type is not editable in this Assembly.");
    }
    return mate;
  }

  private requireEditableSelectedMateDOF(
    draft: AssemblyMateDOFEditorDraft,
  ): { readonly mate: MateProjection; readonly dof: DOFProjection } {
    const mate = this.requireEditableSelectedMate();
    const dof = mate.dofs.find(dof => dof.id === draft.dofID);
    if (mate.suppressed || !dof || dof.state !== "free") {
      throw new Error("Select a free coordinate on an active mate.");
    }
    if (dof.id !== draft.dofID || dof.kind !== draft.kind) {
      throw new Error("The selected mate DOF changed.");
    }
    return { mate, dof };
  }

  private relationDOFOptions(): readonly AssemblyRelationDOFOption[] {
    return this.canonical?.assembly.mates.flatMap((mate) => mate.suppressed ? [] : mate.dofs
      .filter(({ state }) => state === "free")
      .map((dof) => ({ id: dof.id, label: `${mate.name} · ${dof.name}`, kind: dof.kind }))) ?? [];
  }

  private requireMateContext(draft: AssemblyMateDraft): {
    readonly descriptor: AssemblyWorkspaceDescriptor;
    readonly canonical: CanonicalSnapshot;
    readonly normalized: ReturnType<typeof normalizeAssemblyMateDraft>;
    readonly payload: Readonly<Record<string, unknown>>;
  } {
    const descriptor = this.descriptor;
    const canonical = this.canonical;
    const normalized = normalizeAssemblyMateDraft(draft);
    if (!descriptor || !canonical || !this.canAddMate) {
      throw new Error("The current Assembly does not have two editable connector endpoints.");
    }
    if (!canonical.assembly.capabilities.supported_mate_type_ids.includes(normalized.typeID)) {
      throw new Error(`Core does not support the ${normalized.typeID} mate type in this Assembly.`);
    }
    for (const [label, endpoint] of [["Moving", normalized.endpointA], ["Target", normalized.endpointB]] as const) {
      const instance = canonical.assembly.instances.find(({ id }) => id === endpoint.instanceID);
      const connector = canonical.assembly.connector_definitions.find(
        ({ id }) => id === endpoint.connectorDefinitionID,
      );
      if (!instance || instance.suppressed || !connector || connector.suppressed || connector.part_definition_id !== instance.definition_id) {
        throw new Error(`${label} endpoint is no longer available in the canonical Assembly.`);
      }
    }
    return { descriptor, canonical, normalized, payload: assemblyMatePayload(normalized) };
  }

  private async mutateSelectedInstance(
    method: "set_instance_grounded" | "set_instance_suppressed" | "remove_instance",
    params: Readonly<Record<string, unknown>>,
    successMessage: string,
  ): Promise<void> {
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID) throw new Error("No canonical Assembly workspace is open.");
    try {
      await this.mutate(method, { assembly_id: assemblyID, ...params });
      this.onStatus(successMessage, "success");
    } catch (error) {
      this.onStatus(`Assembly component update failed: ${messageFor(error)}`, "error");
      throw error;
    }
  }

  private async mutateSelectedMate(
    method: "update_mate" | "remove_mate" | "set_dof_value",
    params: Readonly<Record<string, unknown>>,
    successMessage: string,
  ): Promise<void> {
    const assemblyID = this.canonical?.assembly.assembly_id;
    if (!assemblyID) throw new Error("No canonical Assembly workspace is open.");
    try {
      await this.mutate(method, { assembly_id: assemblyID, ...params });
      this.onStatus(successMessage, "success");
    } catch (error) {
      this.onStatus(`Assembly mate update failed: ${messageFor(error)}`, "error");
      throw error;
    }
  }

  private publishCanonical(): void {
    if (!this.canonical) return;
    const selectedID = [...this.store.snapshot().selectedEntityIDs][0] ?? null;
    this.store.setReady(buildCADAssemblyPresentation(
      this.canonical.assembly,
      this.canonical.solution,
      this.canonical.bom,
      selectedID,
      this.writable(),
    ));
  }

  private publishDocument(): void {
    const document = this.document;
    if (document) this.onDocumentChanged(document);
  }
}
