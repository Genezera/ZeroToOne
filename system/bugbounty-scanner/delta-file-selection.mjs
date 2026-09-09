/** Exact path filter shared by source and dependency scanners.  In delta
 * mode, an uncached file is not automatically a changed file: only paths
 * attested by the GitHub compare response may inherit changeContext. */
export function filterFilesToChangedPaths(files = [], changedPaths = null) {
  if (changedPaths === null || changedPaths === undefined) return files;
  const allowed = changedPaths instanceof Set ? changedPaths : new Set(changedPaths);
  return files.filter((file) => allowed.has(file?.path));
}

export function immutableRefForScan(target = {}, changeContext = null) {
  return changeContext?.introducedCommit || target.branch || undefined;
}
