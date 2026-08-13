// Stub for spec 40
// === Spec 40: max AST depth ===
const MAX = 7;
export function countAstDepth(node, cur = 0) {
  if (!node) return cur;
  if (cur > MAX) return cur;
  let m = cur;
  for (const c of node.selectionSet?.selections || []) m = Math.max(m, countAstDepth(c, cur + 1));
  return m;
}
export function enforceMaxDepth(ast, max = MAX) {
  const d = countAstDepth(ast);
  if (d > max) throw new Error(`depth ${d} > ${max}`);
  return d;
}

