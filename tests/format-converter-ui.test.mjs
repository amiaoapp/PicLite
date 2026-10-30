import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
const source = readFileSync(new URL('../app/builtin-image-tools.tsx', import.meta.url), 'utf8');
const code = ts.transpile(source.replace(/^import ['"].*\.css['"];?$/gm, ''), { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 });
// Resolve bare React imports before loading the standalone transpiled component.
const resolved = code.replace(/from "(react(?:\/jsx-runtime)?|@phosphor-icons\/react)"/g, (_, name) => `from "${import.meta.resolve(name)}"`);
const { FormatConverterPlugin } = await import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`);
test('converter exposes distinct input, settings and results regions with an actionable empty state', () => {
 const html = renderToStaticMarkup(React.createElement(FormatConverterPlugin, { language:'en', onCreateMonitor:async()=>'' }));
 for (const text of ['Source images', 'Conversion settings', 'Results', 'Converted files will appear here', 'Add images', 'Import folder']) assert.ok(html.includes(text), `missing ${text}`);
 assert.match(html, /disabled=""[^>]*>[^<]*Convert/);
 assert.ok(html.includes('Output format'));
 assert.ok(html.includes('Output location'));
});
