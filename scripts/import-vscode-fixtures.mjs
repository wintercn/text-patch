import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [sourceDirectory, sourceCommit, outputFile] = process.argv.slice(2);
const normalizeNewlines = text => text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

const cases = readdirSync(sourceDirectory, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => {
    const directory = join(sourceDirectory, entry.name);
    const files = readdirSync(directory);
    const originalFile = files.find(file => file.startsWith('1.'));
    const modifiedFile = files.find(file => file.startsWith('2.'));
    const original = normalizeNewlines(readFileSync(join(directory, originalFile), 'utf8'));
    const modified = normalizeNewlines(readFileSync(join(directory, modifiedFile), 'utf8'));
    const upstreamExpected = JSON.parse(readFileSync(join(directory, 'advanced.expected.diff.json'), 'utf8'));

    assert.equal(upstreamExpected.original.content, original, entry.name);
    assert.equal(upstreamExpected.modified.content, modified, entry.name);

    return {
      name: entry.name,
      originalFile,
      modifiedFile,
      original,
      modified,
      upstreamDiffs: upstreamExpected.diffs,
      upstreamMoves: upstreamExpected.moves ?? [],
    };
  });

writeFileSync(outputFile, `${JSON.stringify({ sourceCommit, cases }, null, 2)}\n`);
