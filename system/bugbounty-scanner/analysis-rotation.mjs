export function selectTargetsForRotation(targets, state = {}, { limit = 1 } = {}) {
  return [...targets]
    .sort((a, b) => {
      const aKey = `${a.owner}/${a.repo}`.toLowerCase();
      const bKey = `${b.owner}/${b.repo}`.toLowerCase();
      const aAt = state[aKey]?.lastSuccessAt || '';
      const bAt = state[bKey]?.lastSuccessAt || '';
      return aAt.localeCompare(bAt) || aKey.localeCompare(bKey);
    })
    .slice(0, Math.max(0, limit));
}

export function recordRotationResult(state = {}, target, result, { now = () => new Date() } = {}) {
  const key = `${target.owner}/${target.repo}`.toLowerCase();
  const ts = now().toISOString();
  return {
    ...state,
    [key]: {
      ...(state[key] || {}),
      lastAttemptAt: ts,
      ...(result.ok ? { lastSuccessAt: ts, lastCommitSha: result.headSha || null, lastError: null } : { lastError: result.reason || 'falha desconhecida' }),
    },
  };
}
