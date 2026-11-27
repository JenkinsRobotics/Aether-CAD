/** Browser-local tab ordering; never changes a project's document structure. */
export function reorderTabs(ids: readonly string[], source: string, target: string): string[] {
  const from = ids.indexOf(source), to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids]; next.splice(from, 1); next.splice(to, 0, source); return next;
}
export function orderedTabs<T extends {id:string}>(tabs: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id,index) => [id,index]));
  return [...tabs].sort((a,b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
export function readTabOrder(key: string): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
}
