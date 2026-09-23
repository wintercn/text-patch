import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const [sourceFile, sourceCommit, outputFile] = process.argv.slice(2);
const source = readFileSync(sourceFile, 'utf8');
const cases = [];

function literalArray(start) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let end = start; end < source.length; end++) {
    const character = source[end];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '[') {
      depth++;
    } else if (character === ']' && --depth === 0) {
      return { value: runInNewContext(source.slice(start, end + 1)), end };
    }
  }
  throw new SyntaxError('Unterminated VS Code line-array fixture');
}

for (const match of source.matchAll(/test\('([^']+)',\s*\(\)\s*=>\s*\{/g)) {
  const start = match.index + match[0].length;
  const nextTest = source.indexOf("\n\ttest('", start);
  const end = nextTest === -1 ? source.length : nextTest;
  const originalMatch = /const original = \[/.exec(source.slice(start, end));
  const modifiedMatch = /const modified = \[/.exec(source.slice(start, end));
  if (originalMatch === null || modifiedMatch === null) {
    throw new Error(`Missing original or modified line array in VS Code test: ${match[1]}`);
  }
  const originalStart = start + originalMatch.index + originalMatch[0].length - 1;
  const modifiedStart = start + modifiedMatch.index + modifiedMatch[0].length - 1;
  const original = literalArray(originalStart).value.join('\n');
  const modified = literalArray(modifiedStart).value.join('\n');
  cases.push({ name: match[1], original, modified });
}

writeFileSync(outputFile, `${JSON.stringify({ sourceCommit, cases }, null, 2)}\n`);
