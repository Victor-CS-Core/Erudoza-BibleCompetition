import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
await build({entryPoints: [root + 'review.tsx'], outfile: root + 'review.bundle.js', bundle: true, minify: true, jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}, target: 'es2022', legalComments: 'eof'});
console.log('Built character asset review. No application bundle changed.');
