const validID = (value) => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);

// Saved positions refer to stable group IDs, so a rename never changes order.
// Membership always comes from the current folders, never from saved storage.
export function normalizeFolderOrder(ids, saved) {
  const current = Array.isArray(ids) ? [...new Set(ids.filter(validID))] : [];
  if (!Array.isArray(saved) || !current.length) return current;
  const remaining = new Set(current);
  const ordered = [];
  for (const id of saved) {
    if (remaining.delete(id)) ordered.push(id);
    if (!remaining.size) break;
  }
  return ordered.concat(current.filter((id) => remaining.has(id)));
}

export function moveFolderOrder(ids, source, target, placement = 'before') {
  const current = normalizeFolderOrder(ids);
  if (source === target || !current.includes(source) || !current.includes(target) || !['before', 'after'].includes(placement)) return current;
  const next = current.filter((id) => id !== source);
  const index = next.indexOf(target) + (placement === 'after' ? 1 : 0);
  next.splice(index, 0, source);
  return next;
}
