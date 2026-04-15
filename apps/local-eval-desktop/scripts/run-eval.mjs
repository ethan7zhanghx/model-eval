import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const configPath = resolve(root, 'promptfooconfig.yaml');

const run = async () => {
  console.log('[local-eval] running promptfoo eval...', configPath);
  const subprocess = execa('npx', ['--yes', 'promptfoo@latest', 'eval', '--config', configPath], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PROMPTFOO_CONFIG_DIR: resolve(root, 'results')
    }
  });
  await subprocess;
  console.log('[local-eval] eval complete. results stored under ./results');
};

run().catch((error) => {
  console.error('[local-eval] eval failed:', error.message);
  process.exitCode = error.exitCode || 1;
});
