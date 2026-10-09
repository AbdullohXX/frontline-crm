export function mergeQuoDetails(previous: any, incoming: any) {
  const merged = { ...previous, ...incoming };
  if (!incoming?.summary?.summary?.length && previous?.summary?.summary?.length)
    merged.summary = previous.summary;
  if (!incoming?.transcripts?.length && previous?.transcripts?.length)
    merged.transcripts = previous.transcripts;
  return merged;
}

export function quoCallDetailsPath(id: string) {
  const query = new URLSearchParams();
  query.append("include", "summary");
  query.append("include", "voicemail");
  return "/calls/" + encodeURIComponent(id) + "?" + query;
}
