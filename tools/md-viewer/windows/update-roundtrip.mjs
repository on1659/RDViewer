// CI only: exercise the production installer adapter with the actual built EXE.
// No fixtures or alternate update endpoints are present in a shipped app.
import { createWindowsUpdateInstaller } from './update-install.mjs';

const [archivePath, appDirectory, cacheDirectory, version, sha256, pid] = process.argv.slice(2);
if (process.platform !== 'win32' || !pid) throw new Error('Windows update smoke arguments are required.');
await createWindowsUpdateInstaller({ appDirectory, cacheDirectory, appPID: Number(pid) })({ archivePath, version, sha256 });
console.log('Verified native updater helper is waiting for normal app exit.');
