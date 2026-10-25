import { AetherIcon, InspectorSection, ListBox, MenuButton, type MenuItem } from "@aether/ui";
import { useSyncExternalStore } from "react";
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { cadCommands } from "../../cad-command-registry";
import { cadPresentation } from "../../cad-presentation-store";

/** A view of the canonical contact sets, using the same operations as agents. */
export function AssemblyContactSets() {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const contacts = assembly.data?.contacts;
  if (!contacts) return null;
  const selected = contacts.selected;
  const editable = contacts.editable;
  const items: MenuItem[] = [
    { id: "create", label: "Create Contact Set…", icon: <AetherIcon name="plus" />, disabled: !editable || contacts.instances.filter(instance => !instance.suppressed).length < 2 },
    { id: "edit", label: "Edit Selected Contact Set…", icon: <AetherIcon name="pencil" />, disabled: !editable || !selected },
    { id: "suppress", label: selected?.suppressed ? "Restore Selected Contact Set" : "Suppress Selected Contact Set", disabled: !editable || !selected },
    { id: "remove", label: "Remove Selected Contact Set", icon: <AetherIcon name="close" />, danger: true, disabled: !editable || !selected },
    { id: "toggle", label: contacts.enabled ? "Disable Contact Checks" : "Enable Contact Checks", disabled: !editable },
    { id: "check", label: "Check Contacts", disabled: !contacts.enabled },
  ];
  const edit = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: "edit-contact-set" });
  return <InspectorSection title="Contact sets" actions={<MenuButton label="Contact actions" items={items} onSelect={id => {
    if (id === "create") cadPresentation.dispatch({ type: "show-start-dialog", dialog: "create-contact-set" });
    if (id === "edit" && selected) edit();
    if (id === "remove" && selected) cadPresentation.dispatch({ type: "remove-assembly-contact-set", source: selected });
    if (id === "suppress" && selected) cadPresentation.dispatch({ type: "update-assembly-contact-set", source: selected,
      draft: { name: selected.name, instanceIDs: selected.instance_ids, suppressed: !selected.suppressed } });
    if (id === "toggle") cadCommands.execute("assembly-toggle-contacts");
    if (id === "check") cadCommands.execute("assembly-check-contacts");
  }}>•••</MenuButton>}>
    <p className="cad-form-note">{contacts.enabled ? "Contact checks on" : "Contact checks off"}</p>
    <ListBox ariaLabel="Contact sets" showFilter={false} selectionMode="single" selectedIDs={assembly.selectedEntityIDs}
      items={contacts.sets.map(set => ({ id: set.id, label: set.name, icon: <AetherIcon name="link" />,
        badge: set.suppressed ? "Suppressed" : contacts.enabled ? "Active" : "Off", dimmed: set.suppressed,
        description: set.instance_ids.map(id => contacts.instances.find(instance => instance.id === id)?.name ?? "Missing component").join(" · ") }))}
      onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })}
      emptyState="No contact sets. With checks enabled, all active components are checked." />
  </InspectorSection>;
}
