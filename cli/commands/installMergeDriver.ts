import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureRepoRoot, red } from '../util';
import { gitTasksInvocation } from '../invocation';

const DRIVER_NAME = 'git-tasks-json';
const ATTR_LINE = '.git-tasks/**/*.json merge=git-tasks-json';
const ATTR_MARK = '# >>> git-tasks (managed)';
const ATTR_END = '# <<< git-tasks (managed)';

export function runInstallMergeDriver(): void {
  const repoRoot = ensureRepoRoot();
  const invocation = gitTasksInvocation();

  execSync(`git config merge.${DRIVER_NAME}.name "git-tasks JSON merge"`, { cwd: repoRoot });
  execSync(
    `git config merge.${DRIVER_NAME}.driver "${invocation} merge-driver %O %A %B %P"`,
    { cwd: repoRoot },
  );

  const attrPath = path.join(repoRoot, '.gitattributes');
  let existing = fs.existsSync(attrPath) ? fs.readFileSync(attrPath, 'utf8') : '';
  const re = new RegExp(`${ATTR_MARK}[\\s\\S]*?${ATTR_END}\\n?`, 'm');
  const block = `${ATTR_MARK}\n${ATTR_LINE}\n${ATTR_END}\n`;
  const next = re.test(existing)
    ? existing.replace(re, block)
    : (existing.endsWith('\n') || existing.length === 0 ? existing : existing + '\n') + block;
  fs.writeFileSync(attrPath, next, 'utf8');

  console.log('Installed git-tasks JSON merge driver.');
  console.log('  - git config merge.git-tasks-json registered in .git/config');
  console.log(`  - .gitattributes updated: ${ATTR_LINE}`);
  console.log('Commit .gitattributes so the driver applies for every collaborator.');
}

export function runUninstallMergeDriver(): void {
  const repoRoot = ensureRepoRoot();
  try {
    execSync(`git config --remove-section merge.${DRIVER_NAME}`, { cwd: repoRoot });
  } catch {
    // section may not exist; that's fine
  }
  const attrPath = path.join(repoRoot, '.gitattributes');
  if (fs.existsSync(attrPath)) {
    const existing = fs.readFileSync(attrPath, 'utf8');
    const re = new RegExp(`${ATTR_MARK}[\\s\\S]*?${ATTR_END}\\n?`, 'm');
    if (re.test(existing)) {
      const cleaned = existing.replace(re, '');
      if (cleaned.trim().length === 0) fs.unlinkSync(attrPath);
      else fs.writeFileSync(attrPath, cleaned, 'utf8');
    }
  }
  console.log('Removed git-tasks JSON merge driver.');
}

export function ensureMergeDriverInstalled(): void {
  // Sanity helper, currently unused; reserved for future doctor command.
  if (!fs.existsSync(path.join(process.cwd(), '.gitattributes'))) {
    console.error(red('git-tasks: merge driver not installed.'));
  }
}
