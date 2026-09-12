import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightBundle } from './lib/cloudflare-bound-bundle.mjs';
import { closedBuild, openLocal, importSegment } from './lib/cloudflare-maintenance-local.mjs';
export async function importBundle(bundleDirectory, targetDirectory) {
    if ([bundleDirectory, targetDirectory].some(p => typeof p !== 'string' || !p || p.includes('://')))
        throw new Error('Restore blocked: only local filesystem paths are accepted');
    const bundle = await preflightBundle(bundleDirectory);
    const build = await closedBuild();
    const local = await openLocal(targetDirectory, bundle, build);
    try {
        return await importSegment(local, bundle);
    }
    finally {
        await local.close();
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--bundle' || args[2] !== '--local' || args[1].startsWith('--') || args[3].startsWith('--')) {
        console.error('Usage: node scripts/cloudflare-import.mjs --bundle <private-dir> --local <dedicated-persist-dir>');
        process.exitCode = 1;
    }
    else {
        try {
            console.log(JSON.stringify(await importBundle(args[1], args[3])));
        }
        catch (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    }
}
