export type KnowledgeDiffLine = { type: "same" | "added" | "removed"; text: string };

export function diffKnowledgeText(previous: string, current: string): KnowledgeDiffLine[] {
  const before = previous.split(/\r?\n/);
  const after = current.split(/\r?\n/);
  const rows: KnowledgeDiffLine[] = [];
  const max = Math.max(before.length, after.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = before[index];
    const newLine = after[index];
    if (oldLine === newLine && oldLine !== undefined) rows.push({ type: "same", text: oldLine });
    else {
      if (oldLine !== undefined) rows.push({ type: "removed", text: oldLine });
      if (newLine !== undefined) rows.push({ type: "added", text: newLine });
    }
  }
  return rows;
}
