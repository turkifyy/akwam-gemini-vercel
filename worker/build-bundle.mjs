import {readFile, writeFile} from 'node:fs/promises';

async function readScript(file, name) {
  const source = await readFile(new URL(`./src/${file}.js`, import.meta.url), 'utf8');
  const marker = `export const ${name} = String.raw\``;
  const start = source.indexOf(marker);
  const end = source.lastIndexOf('\`;');
  if (start < 0 || end < start) throw new Error(`Could not extract ${name}`);
  return source.slice(start + marker.length, end);
}

const [bootstrap, translator, source] = await Promise.all([
  readScript('bootstrap', 'bootstrapScript'),
  readScript('translator', 'translatorScript'),
  readFile(new URL('./src/index.js', import.meta.url), 'utf8')
]);
const worker = source
  .replace(/^import .* from ['"].*['"];\r?\n/gm, '')
  .replace('export default {', 'const worker = {')
  .trimEnd();
if (worker === source.trimEnd()) throw new Error('Could not convert Worker entry point');

const bundle = `const bootstrapScript = String.raw\`${bootstrap}\`;

const translatorScript = String.raw\`${translator}\`;

${worker}

export default worker;
`;
await writeFile(new URL('./bundle.js', import.meta.url), bundle);
