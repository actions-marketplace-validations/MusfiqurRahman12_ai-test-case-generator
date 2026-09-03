/**
 * Code Analyzer — inspects the project structure and prepares context for AI.
 *
 * Detects language, framework, architecture pattern, and identifies testable
 * units. Batches file contents intelligently so they fit within AI context limits.
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
  ChangeSet,
  CodeContext,
  CodeFile,
  ProjectContext,
  ProjectLanguage,
  ProjectFramework,
} from '../test-cases/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max characters of source code to send in a single AI request (~30k tokens for free tier TPM headroom) */
const MAX_CONTEXT_CHARS = 120_000;
/** Max characters per individual file to prevent huge files from dominating context */
const MAX_FILE_CHARS = 6_000;

// Framework detection patterns
const FRAMEWORK_INDICATORS: Record<ProjectFramework, string[]> = {
  react: ['react', 'react-dom', 'jsx', 'tsx'],
  nextjs: ['next', 'next.config'],
  vue: ['vue', '@vue/cli', 'nuxt'],
  angular: ['@angular/core', 'angular.json'],
  express: ['express'],
  nestjs: ['@nestjs/core', 'nest-cli.json'],
  fastapi: ['fastapi', 'uvicorn'],
  django: ['django', 'manage.py'],
  flask: ['flask'],
  spring: ['spring-boot', 'pom.xml', 'build.gradle'],
  rails: ['rails', 'Gemfile'],
  laravel: ['laravel', 'artisan'],
  dotnet: ['Microsoft.NET.Sdk', '.csproj'],
  gin: ['github.com/gin-gonic/gin'],
  actix: ['actix-web'],
  vapor: ['vapor'],
  ktor: ['io.ktor'],
  unknown: [],
};

const LANGUAGE_EXTENSIONS: Record<string, ProjectLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.go': 'go',
  '.rb': 'ruby',
  '.erb': 'ruby',
  '.php': 'php',
  '.rs': 'rust',
  '.swift': 'swift',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze the project and prepare code context for the AI provider.
 * @param changeSet  Files to analyze (from change detector)
 * @param maxFiles   Maximum files to include (cost control)
 */
export async function analyzeCode(
  changeSet: ChangeSet,
  maxFiles: number
): Promise<CodeContext> {
  const projectContext = await detectProjectContext();

  core.info(`Detected project: ${projectContext.language} / ${projectContext.frameworks.join(', ') || 'unknown'}`);

  // Filter and prioritize files
  const filesToAnalyze = prioritizeFiles(changeSet, maxFiles);

  // Build CodeFile objects with content
  const codeFiles: CodeFile[] = [];
  let totalChars = 0;

  for (const fileChange of filesToAnalyze) {
    let content = fileChange.content || '';
    if (content.length > MAX_FILE_CHARS) {
      content = smartSliceFile(content, MAX_FILE_CHARS);
    }

    if (totalChars + content.length > MAX_CONTEXT_CHARS) {
      core.info(`Reached context limit at ${codeFiles.length} files (${totalChars} chars)`);
      break;
    }

    const ext = path.extname(fileChange.filePath).toLowerCase();
    codeFiles.push({
      path: fileChange.filePath,
      content,
      language: LANGUAGE_EXTENSIONS[ext] || 'other',
    });

    totalChars += content.length;
  }

  core.info(`Prepared ${codeFiles.length} files (${totalChars} chars) for AI analysis`);

  return {
    project: projectContext,
    files: codeFiles,
  };
}

// ---------------------------------------------------------------------------
// Project Detection
// ---------------------------------------------------------------------------

async function detectProjectContext(): Promise<ProjectContext> {
  const language = detectLanguage();
  const frameworks = detectFrameworks();
  const hasFrontend = detectFrontend(frameworks);
  const hasBackend = detectBackend(frameworks);
  const { hasExistingTests, existingTestFramework } = detectExistingTests();
  const entryPoints = findEntryPoints();
  const sourceDirectories = findSourceDirectories();

  return {
    language,
    frameworks,
    hasFrontend,
    hasBackend,
    hasExistingTests,
    existingTestFramework,
    entryPoints,
    sourceDirectories,
  };
}

function detectLanguage(): ProjectLanguage {
  // Check package.json for TS/JS
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['typescript']) return 'typescript';
      return 'javascript';
    } catch {
      // Fall through
    }
  }

  if (fs.existsSync('tsconfig.json')) return 'typescript';
  if (fs.existsSync('requirements.txt') || fs.existsSync('pyproject.toml') || fs.existsSync('setup.py')) return 'python';
  if (fs.existsSync('pom.xml') || fs.existsSync('build.gradle') || fs.existsSync('build.gradle.kts')) return 'java';
  if (fs.existsSync('go.mod')) return 'go';
  if (fs.existsSync('Gemfile')) return 'ruby';
  if (fs.existsSync('composer.json')) return 'php';
  if (fs.existsSync('Cargo.toml')) return 'rust';
  if (fs.existsSync('Package.swift')) return 'swift';

  // Check by looking at which extensions are most common
  const counts = countFileExtensions('.');
  let maxCount = 0;
  let maxLang: ProjectLanguage = 'other';
  for (const [ext, lang] of Object.entries(LANGUAGE_EXTENSIONS)) {
    const count = counts[ext] || 0;
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }
  return maxLang;
}

function detectFrameworks(): ProjectFramework[] {
  const frameworks: ProjectFramework[] = [];

  // Check package.json
  if (fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depNames = Object.keys(allDeps).join(' ');

      for (const [fw, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
        if (fw === 'unknown') continue;
        if (indicators.some((ind) => depNames.includes(ind))) {
          frameworks.push(fw as ProjectFramework);
        }
      }
    } catch {
      // Fall through
    }
  }

  // Check Python files
  if (fs.existsSync('requirements.txt')) {
    try {
      const reqs = fs.readFileSync('requirements.txt', 'utf-8');
      if (reqs.includes('fastapi')) frameworks.push('fastapi');
      if (reqs.includes('django') || reqs.includes('Django')) frameworks.push('django');
      if (reqs.includes('flask') || reqs.includes('Flask')) frameworks.push('flask');
    } catch {
      // Fall through
    }
  }

  // Check for specific config files
  if (fs.existsSync('next.config.js') || fs.existsSync('next.config.mjs') || fs.existsSync('next.config.ts')) {
    if (!frameworks.includes('nextjs')) frameworks.push('nextjs');
  }
  if (fs.existsSync('angular.json')) {
    if (!frameworks.includes('angular')) frameworks.push('angular');
  }
  if (fs.existsSync('nest-cli.json')) {
    if (!frameworks.includes('nestjs')) frameworks.push('nestjs');
  }

  return frameworks.length > 0 ? frameworks : ['unknown'];
}

function detectFrontend(frameworks: ProjectFramework[]): boolean {
  const frontendFrameworks: ProjectFramework[] = ['react', 'nextjs', 'vue', 'angular'];
  return frameworks.some((fw) => frontendFrameworks.includes(fw)) ||
    fs.existsSync('public/index.html') ||
    fs.existsSync('src/App.tsx') ||
    fs.existsSync('src/App.jsx') ||
    fs.existsSync('src/App.vue');
}

function detectBackend(frameworks: ProjectFramework[]): boolean {
  const backendFrameworks: ProjectFramework[] = [
    'express', 'nestjs', 'fastapi', 'django', 'flask', 'spring',
    'rails', 'laravel', 'dotnet', 'gin', 'actix', 'vapor', 'ktor',
  ];
  return frameworks.some((fw) => backendFrameworks.includes(fw));
}

function detectExistingTests(): { hasExistingTests: boolean; existingTestFramework?: string } {
  // Check for common test directories
  const testDirs = ['tests', 'test', '__tests__', 'spec', 'specs', 'cypress', 'e2e'];
  const hasTestDir = testDirs.some((dir) => fs.existsSync(dir));

  // Check for test config files
  if (fs.existsSync('jest.config.js') || fs.existsSync('jest.config.ts')) {
    return { hasExistingTests: true, existingTestFramework: 'jest' };
  }
  if (fs.existsSync('vitest.config.ts') || fs.existsSync('vitest.config.js')) {
    return { hasExistingTests: true, existingTestFramework: 'vitest' };
  }
  if (fs.existsSync('cypress.config.ts') || fs.existsSync('cypress.config.js')) {
    return { hasExistingTests: true, existingTestFramework: 'cypress' };
  }
  if (fs.existsSync('playwright.config.ts') || fs.existsSync('playwright.config.js')) {
    return { hasExistingTests: true, existingTestFramework: 'playwright' };
  }
  if (fs.existsSync('pytest.ini') || fs.existsSync('conftest.py')) {
    return { hasExistingTests: true, existingTestFramework: 'pytest' };
  }

  return { hasExistingTests: hasTestDir };
}

function findEntryPoints(): string[] {
  const candidates = [
    'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
    'src/App.tsx', 'src/App.jsx', 'src/App.vue',
    'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js',
    'app.py', 'main.py', 'manage.py',
    'src/main/java', 'cmd/main.go', 'main.go',
    'lib/main.rb', 'config/routes.rb',
    'src/main.rs',
    'pages/', 'app/', 'src/pages/', 'src/app/',
  ];

  return candidates.filter((c) => fs.existsSync(c));
}

function findSourceDirectories(): string[] {
  const candidates = ['src', 'lib', 'app', 'pages', 'api', 'routes', 'controllers', 'services', 'components', 'modules'];
  return candidates.filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

// ---------------------------------------------------------------------------
// File Prioritization
// ---------------------------------------------------------------------------

/**
 * Prioritize files for analysis. For incremental scans, new files and
 * modified files get top priority. For full scans, entry points and
 * route/controller/service files are prioritized.
 */
function prioritizeFiles(changeSet: ChangeSet, maxFiles: number) {
  const files = changeSet.files.filter((f) => f.category !== 'deleted');

  // Score each file for priority
  const scored = files.map((f) => ({
    file: f,
    score: computePriorityScore(f.filePath, f.category),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxFiles).map((s) => s.file);
}

function computePriorityScore(filePath: string, category: string): number {
  let score = 0;

  // New files are more likely to need test cases
  if (category === 'new_file') score += 10;
  if (category === 'modified') score += 5;

  // Route / API files are high priority
  if (/route|controller|api|endpoint/i.test(filePath)) score += 8;

  // Service / business logic
  if (/service|usecase|handler|resolver/i.test(filePath)) score += 7;

  // Components (UI)
  if (/component|page|view|screen/i.test(filePath)) score += 6;

  // Models / schemas
  if (/model|schema|entity|type/i.test(filePath)) score += 3;

  // Utils / helpers (lower priority)
  if (/util|helper|lib|common/i.test(filePath)) score += 2;

  // Config files (lowest priority)
  if (/config|setting/i.test(filePath)) score += 1;

  // Test files themselves — skip
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filePath)) score = -1;
  if (/test_.*\.py$/.test(filePath)) score = -1;

  return score;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function countFileExtensions(dir: string, depth = 3): Record<string, number> {
  const counts: Record<string, number> = {};
  if (depth <= 0) return counts;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subCounts = countFileExtensions(fullPath, depth - 1);
        for (const [ext, count] of Object.entries(subCounts)) {
          counts[ext] = (counts[ext] || 0) + count;
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) {
          counts[ext] = (counts[ext] || 0) + 1;
        }
      }
    }
  } catch {
    // Permission denied or similar
  }

  return counts;
}

/**
 * Truncates very large files while preserving the file header (imports, exports, signatures)
 * and the tail (bottom utilities/exports) to stay within model TPM limits.
 */
function smartSliceFile(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = Math.floor(maxChars * 0.35);
  const head = content.substring(0, headChars);
  const tail = content.substring(content.length - tailChars);
  return `${head}\n\n// ... [truncated ${content.length - headChars - tailChars} characters for AI token efficiency] ...\n\n${tail}`;
}

