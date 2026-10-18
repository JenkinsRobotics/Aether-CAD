import { useState } from "react";
import { Button, Checkbox, FieldRow, TextField } from "@aether/ui";
import type { HarnessDocument, View } from "./model";
import { moveGroup } from "./operations";
/** Product-owned grouping editor; all controls use shared Aether UI. */
export function HarnessGroups({
  doc,
  view,
  change,
}: {
  doc: HarnessDocument;
  view: View;
  change: (d: HarnessDocument) => void;
}) {
  const [name, setName] = useState("Assembly group"),
    [members, setMembers] = useState<string[]>([]),
    [selected, setSelected] = useState(""),
    [dx, setDx] = useState(0),
    [dy, setDy] = useState(0);
  const group = doc.groups?.find((g) => g.id === selected);
  const update = (
    patch: Partial<NonNullable<HarnessDocument["groups"]>[number]>,
  ) =>
    change({
      ...doc,
      groups: doc.groups?.map((g) =>
        g.id === selected ? { ...g, ...patch } : g,
      ),
    });
  return (
    <div className="cad-harness-inspector">
      <h2>Groups</h2>
      <p>Keep related components together in both drawings.</p>
      {(doc.groups ?? []).map((g) => (
        <Button
          key={g.id}
          aria-pressed={g.id === selected}
          onClick={() => setSelected(g.id)}
        >
          {g.name} · {g.members.length}
        </Button>
      ))}
      {group ? (
        <>
          <FieldRow label="Group name">
            <TextField
              aria-label="Group name"
              value={group.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </FieldRow>
          <Checkbox
            label="Lock group"
            checked={!!group.locked}
            onChange={(e) => update({ locked: e.target.checked })}
          />
          <FieldRow label={`Move ${view} X`}>
            <TextField
              aria-label="Group move X"
              type="number"
              value={dx}
              onChange={(e) => setDx(Number(e.target.value))}
            />
          </FieldRow>
          <FieldRow label={`Move ${view} Y`}>
            <TextField
              aria-label="Group move Y"
              type="number"
              value={dy}
              onChange={(e) => setDy(Number(e.target.value))}
            />
          </FieldRow>
          <Button
            disabled={group.locked || (!dx && !dy)}
            onClick={() => change(moveGroup(doc, group.id, view, [dx, dy]))}
          >
            Move group
          </Button>
          <Button
            onClick={() => {
              change({
                ...doc,
                groups: doc.groups?.filter((g) => g.id !== group.id),
              });
              setSelected("");
            }}
          >
            Ungroup
          </Button>
          <Button onClick={() => setSelected("")}>New group</Button>
        </>
      ) : (
        <>
          <FieldRow label="Name">
            <TextField
              aria-label="New group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldRow>
          {doc.connectors.map((c) => (
            <Checkbox
              key={c.id}
              label={c.title}
              checked={members.includes(c.id)}
              onChange={(e) =>
                setMembers(
                  e.target.checked
                    ? [...members, c.id]
                    : members.filter((id) => id !== c.id),
                )
              }
            />
          ))}
          <Button
            disabled={
              !name.trim() ||
              members.filter((id) => doc.connectors.some((c) => c.id === id))
                .length < 2
            }
            onClick={() => {
              const group = {
                id: crypto.randomUUID(),
                name: name.trim(),
                members: members.filter((id) =>
                  doc.connectors.some((c) => c.id === id),
                ),
              };
              change({ ...doc, groups: [...(doc.groups ?? []), group] });
              setSelected(group.id);
              setMembers([]);
            }}
          >
            Create group
          </Button>
        </>
      )}
    </div>
  );
}
