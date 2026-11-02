import fs from 'fs';
import path from 'path';

export function firstExistingPath(candidates: Array<string | undefined>): string {
  return candidates.find(candidate => candidate && !candidate.includes('Microsoft\\WindowsApps') && fs.existsSync(candidate)) || '';
}

export function resolvePythonPath(configured?: string, skillPath?: string): string {
  const windows = process.platform === 'win32';
  const local = process.env.LOCALAPPDATA || '';
  const programs = path.join(local, 'Programs', 'Python');
  const installed = fs.existsSync(programs) ? fs.readdirSync(programs).filter(name => /^Python\d+$/.test(name)).sort().reverse().map(name => path.join(programs, name, 'python.exe')) : [];
  const fromPath = (process.env.PATH || '').split(path.delimiter).flatMap(dir => windows
    ? [path.join(dir, 'python.exe')] : [path.join(dir, 'python3'), path.join(dir, 'python')]);
  return firstExistingPath([configured, skillPath ? path.join(skillPath, '.venv', windows ? 'Scripts/python.exe' : 'bin/python') : '', ...installed, ...fromPath]) || (windows ? 'python' : 'python3');
}
