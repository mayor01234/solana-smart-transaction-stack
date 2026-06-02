import { spawn } from 'node:child_process';
import { loadConfig } from '../config.js';

const config = loadConfig();
const count = config.FIRST_PLACE_TARGET_RECORDS;
const failures = config.FIRST_PLACE_TARGET_FAILURES;

await run('tsx', ['src/cli/doctor.ts']);
await run('tsx', ['src/cli/reset-evidence.ts']);
await run('tsx', ['src/cli/run-challenge.ts', '--count', String(count), '--failures', String(failures)]);
await run('tsx', ['src/cli/export-evidence.ts']);
await run('tsx', ['src/cli/verify-evidence.ts']);
await run('tsx', ['src/cli/score-self.ts']);

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}
