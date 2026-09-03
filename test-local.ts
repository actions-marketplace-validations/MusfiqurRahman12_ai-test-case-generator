/**
 * Local Test Script — optimized for Gemini Free Tier
 *
 * Free tier limits:
 *   - 15 requests/minute
 *   - 1,000,000 tokens/minute
 *   - 1,500,000 tokens/day
 *
 * Optimizations applied:
 *   - Compact prompts (fewer input tokens)
 *   - File truncation with smart slicing (keep imports + exports + key functions)
 *   - Single API call (not per-file)
 *   - Controlled output size
 *
 * Usage:
 *   $env:GEMINI_API_KEY="your-key"
 *   npx ts-node test-local.ts
 *   npx ts-node test-local.ts D:\path\to\project    # test against any project
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config — tuned for free tier
// ---------------------------------------------------------------------------

const API_KEY = process.env.GEMINI_API_KEY || '';
const PROJECT_PATH = process.argv[2] || process.env.TEST_PROJECT_PATH || '.';
const MODEL = 'gemini-2.5-flash';      // Free tier model
const MAX_FILES = 8;                     // Keep context small
const MAX_FILE_CHARS = 3000;             // Truncate large files
const MAX_TOTAL_CHARS = 80_000;          // ~20K tokens input (well under 1M limit)
const MAX_OUTPUT_TOKENS = 8192;          // 8192 to account for thinking tokens + JSON payload

if (!API_KEY) {
  console.error('❌ Missing GEMINI_API_KEY');
  console.error('');
  console.error('  Get a free key: https://aistudio.google.com/apikey');
  console.error('');
  console.error('  Then run:');
  console.error('    $env:GEMINI_API_KEY="your-key-here"');
  console.error('    npx ts-node test-local.ts');
  console.error('    npx ts-node test-local.ts D:\\path\\to\\project');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Smart File Discovery — prioritize testable code
// ---------------------------------------------------------------------------

const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rb', '.php',
  '.cs', '.rs', '.swift', '.kt', '.vue', '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '__pycache__',
  'coverage', '.testcases', 'venv', '.venv', 'vendor', '.idea', '.vscode',
]);

const SKIP_PATTERNS = [
  /\.(test|spec|mock|fixture)\./i,
  /\.d\.ts$/,
  /\.config\.(ts|js|mjs)$/,
  /\.min\.(js|css)$/,
];

interface ScoredFile {
  path: string;
  relativePath: string;
  score: number;
}

function findAndPrioritize(dir: string): ScoredFile[] {
  const files: ScoredFile[] = [];

  function walk(currentDir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXT.has(ext)) continue;
        if (SKIP_PATTERNS.some((p) => p.test(entry.name))) continue;

        const rel = path.relative(dir, fullPath).replace(/\\/g, '/');
        files.push({ path: fullPath, relativePath: rel, score: scoreFile(rel) });
      }
    }
  }

  walk(dir);

  // Sort by score desc, take top N
  files.sort((a, b) => b.score - a.score);
  return files.slice(0, MAX_FILES);
}

function scoreFile(filePath: string): number {
  let s = 0;
  if (/route|controller|api|endpoint/i.test(filePath)) s += 10;
  if (/service|handler|resolver/i.test(filePath)) s += 8;
  if (/component|page|view|screen/i.test(filePath)) s += 7;
  if (/auth|login|signup|register/i.test(filePath)) s += 6;
  if (/model|schema|entity/i.test(filePath)) s += 4;
  if (/util|helper|lib/i.test(filePath)) s += 2;
  if (/index\.(ts|js)$/i.test(filePath)) s += 1;
  return s;
}

// ---------------------------------------------------------------------------
// Smart File Truncation — keep the important parts
// ---------------------------------------------------------------------------

function smartTruncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const lines = content.split('\n');

  // Always keep: first 30 lines (imports/setup) + last 10 lines
  const head = lines.slice(0, 30).join('\n');
  const tail = lines.slice(-10).join('\n');

  // From the middle, keep lines with: export, function, class, def, route, app., router.
  const importantPattern = /^(export|function|class|def |async |const \w+ = |app\.|router\.|@(Get|Post|Put|Delete|Patch|Controller|Injectable))/;
  const middleLines = lines.slice(30, -10).filter((l) => importantPattern.test(l.trim()));
  const middle = middleLines.join('\n');

  const combined = `${head}\n\n// ... (truncated for brevity) ...\n\n${middle}\n\n// ... (end of file) ...\n\n${tail}`;
  return combined.substring(0, maxChars);
}

// ---------------------------------------------------------------------------
// Compact Prompt — optimized for token efficiency
// ---------------------------------------------------------------------------

function buildPrompt(files: Array<{ path: string; content: string }>): string {
  const fileContext = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `Analyze this code and generate 3 to 5 high-priority manual test cases as valid JSON.
Keep descriptions and step texts clear and concise to ensure complete JSON output.

Each test case needs:
- id: string (e.g. TC-feature-001)
- title: string
- description: string (1-2 sentences)
- priority: "critical" | "high" | "medium" | "low"
- type: "functional" | "regression" | "edge_case" | "integration" | "ui" | "api"
- preconditions: string[]
- steps: array of {"stepNumber": number, "action": string, "expectedResult": string}
- expectedResult: string (overall expected outcome)
- sourceFiles: string[]
- tags: string[]
- featureArea: string

Respond strictly with JSON in this format:
{"testCases": [...], "warnings": []}

${fileContext}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const resolvedPath = path.resolve(PROJECT_PATH);
  console.log('');
  console.log('🤖 AI Test Case Generator — Local Test (Free Gemini Tier)');
  console.log('=========================================================');
  console.log(`📁 Project:  ${resolvedPath}`);
  console.log(`🧠 Model:    ${MODEL} (free)`);
  console.log(`📊 Limits:   ${MAX_FILES} files, ${(MAX_TOTAL_CHARS / 1000).toFixed(0)}K chars max`);
  console.log('');

  // 1. Find & prioritize files
  const scored = findAndPrioritize(resolvedPath);
  if (scored.length === 0) {
    console.error('❌ No source files found in', resolvedPath);
    process.exit(1);
  }

  console.log(`🔍 Found ${scored.length} source files (highest priority first):`);
  scored.forEach((f) => console.log(`   ${f.score >= 6 ? '⭐' : '  '} [${f.score}] ${f.relativePath}`));
  console.log('');

  // 2. Read & truncate files
  const files: Array<{ path: string; content: string }> = [];
  let totalChars = 0;

  for (const sf of scored) {
    const raw = fs.readFileSync(sf.path, 'utf-8');
    const content = smartTruncate(raw, MAX_FILE_CHARS);

    if (totalChars + content.length > MAX_TOTAL_CHARS) {
      console.log(`   ⚠️  Skipping ${sf.relativePath} (context limit reached)`);
      continue;
    }

    files.push({ path: sf.relativePath, content });
    totalChars += content.length;
  }

  const estTokens = Math.round(totalChars / 4);
  console.log(`📖 Context: ${files.length} files, ${totalChars.toLocaleString()} chars (~${estTokens.toLocaleString()} tokens)`);
  console.log(`   Free tier usage: ~${((estTokens / 1_500_000) * 100).toFixed(1)}% of daily limit`);
  console.log('');

  // 3. Call Gemini
  console.log('🤖 Calling Gemini API...');
  const startTime = Date.now();

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,  // Lower = more deterministic = fewer retries
    },
  });

  try {
    const prompt = buildPrompt(files);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Token usage
    const usage = result.response.usageMetadata;
    console.log(`   ✅ Done in ${elapsed}s`);
    if (usage) {
      console.log(`   📊 Tokens: ${usage.promptTokenCount?.toLocaleString()} in + ${usage.candidatesTokenCount?.toLocaleString()} out = ${usage.totalTokenCount?.toLocaleString()} total`);
      console.log(`   💰 Cost: $0.00 (free tier)`);
    }
    console.log('');

    // 4. Parse
    let parsed: any;
    try {
      let cleaned = text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('❌ Failed to parse JSON response. Raw output:');
      console.error(text.substring(0, 1000));
      process.exit(1);
    }

    const testCases = parsed.testCases || [];
    console.log(`📋 Generated ${testCases.length} test cases:\n`);

    // 5. Display
    const emoji: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

    for (const tc of testCases) {
      console.log(`  ${emoji[tc.priority] || '⚪'} ${tc.id}: ${tc.title}`);
      console.log(`    Priority: ${tc.priority} | Type: ${tc.type} | Area: ${tc.featureArea || 'General'}`);
      if (tc.steps) {
        for (const step of tc.steps) {
          console.log(`    ${step.stepNumber}. ${step.action}`);
          console.log(`       → ${step.expectedResult}`);
        }
      }
      console.log('');
    }

    // 6. Save output
    const outputDir = path.join(resolvedPath, '.testcases');
    fs.mkdirSync(outputDir, { recursive: true });

    // JSON
    const jsonOut = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      model: MODEL,
      tokenUsage: usage ? { prompt: usage.promptTokenCount, completion: usage.candidatesTokenCount, total: usage.totalTokenCount } : null,
      totalCount: testCases.length,
      testCases: testCases.map((tc: any) => ({
        ...tc,
        automationStatus: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
    const jsonPath = path.join(outputDir, 'test-cases.json');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));

    // Markdown
    let md = `# Test Cases\n\n> Generated by AI Test Case Generator · Gemini ${MODEL} (free) · ${new Date().toISOString()}\n\n`;
    md += `| ID | Title | Priority | Type | Area |\n|----|-------|----------|------|------|\n`;
    for (const tc of testCases) {
      md += `| ${tc.id} | ${tc.title} | ${emoji[tc.priority] || '⚪'} ${tc.priority} | ${tc.type} | ${tc.featureArea || '-'} |\n`;
    }
    md += `\n---\n\n`;

    for (const tc of testCases) {
      md += `## ${tc.id}: ${tc.title}\n\n`;
      md += `**Priority**: ${emoji[tc.priority] || '⚪'} ${tc.priority} · **Type**: ${tc.type} · **Area**: ${tc.featureArea || 'General'}\n\n`;
      md += `${tc.description}\n\n`;

      if (tc.preconditions?.length > 0) {
        md += `### Preconditions\n${tc.preconditions.map((p: string) => `- ${p}`).join('\n')}\n\n`;
      }

      if (tc.steps?.length > 0) {
        md += `### Steps\n| # | Action | Expected Result |\n|---|--------|----------------|\n`;
        for (const s of tc.steps) {
          md += `| ${s.stepNumber} | ${s.action?.replace(/\|/g, '\\|')} | ${s.expectedResult?.replace(/\|/g, '\\|')} |\n`;
        }
        md += `\n`;
      }

      md += `### Expected Result\n${tc.expectedResult}\n\n`;
      if (tc.sourceFiles?.length > 0) {
        md += `### Files\n${tc.sourceFiles.map((f: string) => `- \`${f}\``).join('\n')}\n\n`;
      }
      if (tc.tags?.length > 0) {
        md += `**Tags**: ${tc.tags.map((t: string) => `\`${t}\``).join(' ')}\n\n`;
      }
      md += `---\n\n`;
    }

    const mdPath = path.join(outputDir, 'test-cases.md');
    fs.writeFileSync(mdPath, md);

    console.log('💾 Output saved:');
    console.log(`   📄 ${jsonPath}`);
    console.log(`   📝 ${mdPath}`);
    console.log('');
    console.log('✅ Done! Open the .testcases/ folder to see your generated test cases.');
    console.log('');

  } catch (error: any) {
    const msg = error.message || String(error);
    console.error('');
    console.error(`❌ API Error: ${msg}`);

    if (msg.includes('API_KEY_INVALID') || msg.includes('INVALID_ARGUMENT')) {
      console.error('   → Your API key is invalid. Regenerate at https://aistudio.google.com/apikey');
    } else if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
      console.error('   → Rate limit hit. Wait 60 seconds and try again.');
      console.error('   → Free tier: 15 req/min, 1.5M tokens/day');
    } else if (msg.includes('PERMISSION_DENIED')) {
      console.error('   → API key lacks permission. Make sure Gemini API is enabled.');
    }

    process.exit(1);
  }
}

main();
