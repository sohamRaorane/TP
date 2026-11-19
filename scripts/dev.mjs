// Starts the API server and the Vite client together: `npm run dev:all`
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const procs = [
  ['server', spawn(npm, ['--prefix', 'server', 'run', 'dev'], { stdio: 'pipe', shell: isWin })],
  ['client', spawn(npm, ['run', 'dev'], { stdio: 'pipe', shell: isWin })],
];
for (const [name, p] of procs) {
  const tag = name === 'server' ? '\x1b[35m[server]\x1b[0m' : '\x1b[36m[client]\x1b[0m';
  const out = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`${tag} ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => {
    console.log(`${tag} exited with code ${code}`);
    procs.forEach(([, q]) => q.kill());
    process.exit(code ?? 0);
  });
}
const stop = () => procs.forEach(([, p]) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
