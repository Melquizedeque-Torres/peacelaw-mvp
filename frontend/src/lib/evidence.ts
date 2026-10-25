/** "1 anexo" / "2 anexos"; null when there is nothing to show. */
export function evidenceCountLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "anexo" : "anexos"}`;
}
