/** The Assembly authoring dialogs: one per file.
 *
 *  Four hundred lines of them sat inside AetherCADShell.tsx, between the
 *  viewport chrome and the shell itself.
 */
export { AssemblyComponentDialog } from "./component";
export { AssemblyConnectorDialog } from "./connector";
export { AssemblyMateDialog } from "./mate";
export { AssemblyMateDOFDialog } from "./mate-dof";
export { AssemblyRelationDialog } from "./relation";
export { AssemblyContactSetDialog } from "./contact-set";
export { PartPropertiesDialog } from "./part-properties";
export { BodiesToComponentDialog } from "./bodies-to-component";
export { AsBuiltJointDialog } from "./as-built";
export { ReachPointDialog, type ReachPointDraft } from "./reach-point";
