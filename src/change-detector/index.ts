/**
 * Change Detector — identifies what files changed between commits.
 *
 * On first run (no existing test cases), flags all source files for full scan.
 * On subsequent runs, uses `git diff` to find changed files and categorize them.
 * Filters out non-source files (images, lockfiles, etc.).
 */

import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { ChangeSet, FileChange, ChangeCategory } from '../test-cases/types';

// ---------------------------------------------------------------------------
// File Patterns to Ignore
// ---------------------------------------------------------------------------

const IGNORE_PATTERNS: RegExp[] = [
  // Lock files
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Gemfile\.lock$/,
  /poetry\.lock$/,
  /Pipfile\.lock$/,
  /composer\.lock$/,
  /Cargo\.lock$/,
  /go\.sum$/,

  // Binary / media
  /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|tiff)$/i,
  /\.(mp4|mov|avi|webm|mp3|wav|ogg)$/i,
  /\.(woff|woff2|ttf|eot|otf)$/i,
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
  /\.(zip|tar|gz|rar|7z)$/i,

  // Generated / build
  /^dist\//,
  /^build\//,
  /^out\//,
  /^\.next\//,
  /^node_modules\//,
  /^__pycache__\//,
  /^\.git\//,
  /^\.testcases\//,
  /^coverage\//,

  // Config files that rarely affect test cases
  /^\.github\/(?!.*\.(ts|js|py)$)/,
  /^\.(eslintrc|prettierrc|editorconfig|gitignore|dockerignore)/,
  /^LICENSE$/i,
  /^CHANGELOG/i,
];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.java', '.kt', '.kts',
  '.cs',
  '.go',
  '.rb', '.erb',
  '.php',
  '.rs',
  '.swift',
  '.vue', '.svelte',
  '.html', '.htm',
  '.css', '.scss', '.less',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect changes since the last analyzed commit.
 * If testOutputDir does not exist, performs a full scan of all source files.
 */
export async function detectChanges(testOutputDir: string): Promise<ChangeSet> {
  const context = github.context;
  const isFullScan = !fs.existsSync(testOutputDir) || isDirEmpty(testOutputDir);

  core.info(`Change detection mode: ${isFullScan ? 'FULL SCAN' : 'INCREMENTAL'}`);

  if (isFullScan) {
    return fullScan();
  }

  return incrementalScan(context);
}

// ---------------------------------------------------------------------------
// Full Scan
// ---------------------------------------------------------------------------

async function fullScan(): Promise<ChangeSet> {
  const headSha = await getOutput('git', ['rev-parse', 'HEAD']);
  const allFiles = await getOutput('git', ['ls-files']);
  const filePaths = allFiles.split('\n').filter(Boolean);

  const files: FileChange[] = [];

  for (const filePath of filePaths) {
    if (shouldIgnore(filePath)) continue;
    if (!isSourceFile(filePath)) continue;

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File might be binary or unreadable
      continue;
    }

    files.push({
      filePath,
      category: 'new_file',
      diff: '',
      content,
    });
  }

  core.info(`Full scan found ${files.length} source files`);

  return {
    files,
    isFullScan: true,
    baseSha: '',
    headSha,
  };
}

// ---------------------------------------------------------------------------
// Incremental Scan
// ---------------------------------------------------------------------------

async function incrementalScan(context: typeof github.context): Promise<ChangeSet> {
  let baseSha: string;
  let headSha: string;
  let commitMessage: string | undefined;
  let prTitle: string | undefined;
  let prBody: string | undefined;

  if (context.eventName === 'pull_request') {
    const pr = context.payload.pull_request!;
    baseSha = pr.base.sha;
    headSha = pr.head.sha;
    prTitle = pr.title;
    prBody = pr.body ?? undefined;

    // Ensure we have the base branch available for diff
    try {
      await execCommand('git', ['fetch', 'origin', pr.base.ref, '--depth=1']);
    } catch {
      core.warning('Could not fetch base ref; falling back to HEAD^ for diff');
      baseSha = 'HEAD^';
    }
  } else {
    // push event
    headSha = context.sha;
    baseSha = context.payload.before || 'HEAD^';
    const commits = context.payload.commits;
    if (commits && commits.length > 0) {
      commitMessage = commits.map((c: { message: string }) => c.message).join('\n');
    }
  }

  // Get the list of changed files with their status
  const diffOutput = await getOutput('git', [
    'diff',
    '--name-status',
    '--diff-filter=ACDMR',
    baseSha,
    headSha,
  ]);

  const files: FileChange[] = [];

  for (const line of diffOutput.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0];
    const filePath = parts.length === 3 ? parts[2] : parts[1]; // renamed: old \t new
    const previousPath = parts.length === 3 ? parts[1] : undefined;

    if (shouldIgnore(filePath)) continue;
    if (!isSourceFile(filePath)) continue;

    const category = statusToCategory(status);

    let diff = '';
    let content: string | undefined;

    try {
      if (category !== 'deleted') {
        diff = await getOutput('git', ['diff', baseSha, headSha, '--', filePath]);
        content = fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      continue;
    }

    files.push({ filePath, category, diff, content, previousPath });
  }

  core.info(`Incremental scan found ${files.length} changed source files`);

  return {
    files,
    isFullScan: false,
    baseSha,
    headSha,
    commitMessage,
    prTitle,
    prBody,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

function statusToCategory(status: string): ChangeCategory {
  const first = status.charAt(0).toUpperCase();
  switch (first) {
    case 'A':
      return 'new_file';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'M':
    case 'C':
    default:
      return 'modified';
  }
}

function isDirEmpty(dirPath: string): boolean {
  try {
    const entries = fs.readdirSync(dirPath);
    // Ignore hidden files like .sync-state.json
    return entries.filter((e) => !e.startsWith('.')).length === 0;
  } catch {
    return true;
  }
}

async function getOutput(command: string, args: string[]): Promise<string> {
  let stdout = '';
  await exec.exec(command, args, {
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
    },
    silent: true,
  });
  return stdout.trim();
}

async function execCommand(command: string, args: string[]): Promise<void> {
  await exec.exec(command, args, { silent: true });
}
