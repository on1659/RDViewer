import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';

export async function buildUpdateHelper(output) {
  if (process.platform !== 'win32') throw new Error('The Windows updater must be built on Windows with the included .NET Framework compiler.');
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const root = process.env.SystemRoot || 'C:\\Windows';
  let compiler;
  for (const framework of ['Framework64', 'Framework']) {
    const candidate = path.join(root, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
    try { await access(candidate); compiler = candidate; break; } catch { }
  }
  if (!compiler) throw new Error('The Windows .NET Framework compiler is unavailable.');
  await mkdir(path.dirname(output), { recursive: true });
  execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+',
    '/reference:System.Runtime.Serialization.dll', `/out:${output}`, path.join(directory, 'UpdateInstaller.cs')], { stdio: 'inherit', windowsHide: true });
  const binary = await readFile(output);
  if (binary.length < 1024 || binary.subarray(0, 2).toString() !== 'MZ') throw new Error('The Windows update helper is not a PE executable.');
  console.log('Compiled the RDViewer GUI update helper without a console dependency.');
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('An output executable path is required.');
  await buildUpdateHelper(path.resolve(process.argv[2]));
}
