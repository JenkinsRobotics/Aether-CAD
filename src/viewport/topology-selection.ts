/** IDs embed the full body ID, which itself can contain colons. */
export function selectedCandidateId(item: {id:string;partId:string}): string | null {
  for(const kind of ['edge','vertex']) {
    const prefix=`${kind}:${item.partId}:`;
    if(item.id.startsWith(prefix))return item.id.slice(prefix.length);
  }
  return null;
}
