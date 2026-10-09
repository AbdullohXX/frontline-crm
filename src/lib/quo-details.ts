export function mergeQuoDetails(previous: any, incoming: any) {
  const merged = { ...previous, ...incoming };
  if (!incoming?.summary?.summary?.length && previous?.summary?.summary?.length)
    merged.summary = previous.summary;
  if (!incoming?.transcripts?.length && previous?.transcripts?.length)
    merged.transcripts = previous.transcripts;
  return merged;
}
