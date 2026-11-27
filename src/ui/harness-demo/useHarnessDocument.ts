import { useEffect, useRef, useState } from "react";
import { exampleHarness } from "./fixture";
import { parseDocument, type HarnessDocument } from "./model";
const KEY = "aether.cad.harness-demo.v1";
export function useHarnessDocument() {
  const [message, setMessage] = useState("Local design preview");
  const [doc, setDoc] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY);
      return saved ? parseDocument(saved) : exampleHarness();
    } catch {
      return exampleHarness();
    }
  });
  const [past, setPast] = useState<HarnessDocument[]>([]),
    [future, setFuture] = useState<HarnessDocument[]>([]);
  const current = useRef(doc),
    dragStart = useRef<HarnessDocument | null>(null);
  current.current = doc;
  const change = (next: HarnessDocument) => {
    if (next === current.current) return;
    const previous = current.current;
    setPast((p) => [...p, previous].slice(-100));
    setFuture([]);
    current.current = next;
    setDoc(next);
  };
  const preview = (next: HarnessDocument, commit: boolean) => {
    if (!dragStart.current) dragStart.current = current.current;
    current.current = next;
    setDoc(next);
    if (commit) {
      const previous = dragStart.current;
      setPast((p) => [...p, previous!].slice(-100));
      setFuture([]);
      dragStart.current = null;
    }
  };
  const undo = () => {
    if (!past.length) return;
    const previous = current.current;
    setFuture((f) => [previous, ...f]);
    const next = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    current.current = next;
    setDoc(next);
  };
  const redo = () => {
    if (!future.length) return;
    const previous = current.current;
    setPast((p) => [...p, previous]);
    const next = future[0];
    setFuture((f) => f.slice(1));
    current.current = next;
    setDoc(next);
  };
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(doc));
    } catch {
      setMessage(
        "Browser storage unavailable — export a local file to keep changes",
      );
    }
  }, [doc]);
  return {
    doc,
    change,
    preview,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    message,
    setMessage,
  };
}
export function download(
  name: string,
  text: string,
  mime = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
