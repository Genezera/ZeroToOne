import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterFilesToChangedPaths, immutableRefForScan } from '../delta-file-selection.mjs';

test('delta aceita somente caminhos atestados pelo compare, não arquivos antigos sem cache', () => {
  const files = [
    { path: 'src/changed.js', sha: 'a' },
    { path: 'src/old-unseen.js', sha: 'b' },
    { path: 'package-lock.json', sha: 'c' },
  ];
  assert.deepEqual(
    filterFilesToChangedPaths(files, ['src/changed.js']),
    [{ path: 'src/changed.js', sha: 'a' }],
  );
  assert.deepEqual(filterFilesToChangedPaths(files, new Set(['package-lock.json'])), [files[2]]);
  assert.equal(filterFilesToChangedPaths(files, []).length, 0);
  assert.equal(filterFilesToChangedPaths(files, null), files);
});

test('scan delta fixa árvore e conteúdo no SHA observado, nunca na branch móvel', () => {
  const sha = 'b'.repeat(40);
  assert.equal(immutableRefForScan({ branch: 'main' }, { introducedCommit: sha }), sha);
  assert.equal(immutableRefForScan({ branch: 'main' }, null), 'main');
});
