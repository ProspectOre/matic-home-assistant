import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { parse } from '@babel/parser';

// Projection arithmetic and spatial identity must not pull transport, Home
// Assistant adapters, rendering, or effects into the spatial model boundary.
const frontend = resolve('frontend/map-studio-v4');
const forbidden = /(?:^|\/)(?:backend|effects|hass-adapter|renderer-controller|workspace-transport)(?:\.[^/]*)?$/u;
function runtimeImports(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const imports = [];
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type'
        && (statement.specifiers.length === 0 || statement.specifiers.some(specifier => specifier.importKind !== 'type'))) imports.push(statement.source.value);
    if ((statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration')
        && statement.source && statement.exportKind !== 'type') imports.push(statement.source.value);
  }
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    assert.ok(node.type !== 'ImportExpression' && !(node.type === 'CallExpression'
      && (node.callee?.type === 'Import' || (node.callee?.type === 'Identifier' && node.callee.name === 'require'))),
    'projection arithmetic must not load dependencies dynamically');
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast.program);
  return imports;
}
test('spatial model cannot depend on integration effects', async () => {
  const visited = new Set();
  async function check(path) {
    if (visited.has(path)) return;
    visited.add(path);
    for (const dependency of runtimeImports(await readFile(path, 'utf8'))) {
      assert.ok(dependency.startsWith('.'), `${path} imports external ${dependency}`);
      assert.ok(!forbidden.test(dependency), `${path} imports integration boundary ${dependency}`);
      await check(resolve(dirname(path), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`));
    }
  }
  for (const source of ['renderer-math.ts', 'spatial-identity.ts']) await check(resolve(frontend, source));
});
test('boundary distinguishes type-only references and runtime imports', () => {
  assert.deepEqual(runtimeImports('import type { T } from "./backend"; import { type A, b } from "./effects"; export { c } from "./renderer-controller";'), ['./effects', './renderer-controller']);
  assert.throws(() => runtimeImports('import("./effects")'), /dynamically/);
  for (const path of ['./effects', './renderer-controller', './backend', './workspace-transport']) assert.match(path, forbidden);
});
