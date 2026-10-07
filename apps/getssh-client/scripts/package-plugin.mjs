// Packs plugins/system-monitor into system-monitor.zip at the repository root.
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pluginDir = path.join(root, 'plugins', 'system-monitor');
const outputFile = path.join(root, 'system-monitor.zip');

const output = createWriteStream(outputFile);
const zip = new ZipArchive({ zlib: { level: 9 } });
const done = new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
  zip.on('error', reject);
});
zip.pipe(output);
zip.directory(pluginDir, false);
await zip.finalize();
await done;
console.log(`Plugin packaged to ${outputFile} (${zip.pointer()} bytes)`);
