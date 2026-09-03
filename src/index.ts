/**
 * AI Test Case Generator — GitHub Action Entry Point
 *
 * Main orchestrator that coordinates all modules:
 * 1. Parse configuration
 * 2. Detect changes (full scan or incremental)
 * 3. Analyze code context
 * 4. Generate test cases via AI
 * 5. Save test cases (JSON + Markdown)
 * 6. Sync to PM tool (Jira/ClickUp/Trello)
 * 7. Generate Playwright automation
 * 8. Auto-commit results
 * 9. Create GitHub Actions job summary
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { parseConfig } from './config';
import { detectChanges } from './change-detector';
import { analyzeCode } from './code-analyzer';
import { createAIProvider } from './ai/provider';
import { generateTestCases, GenerationResult } from './test-cases/generator';
import { saveTestCases } from './test-cases/manager';
import { syncTestCases } from './sync';
import { generateAutomation, AutomationResult } from './automation/generator';
import { SyncResult } from './test-cases/types';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const startTime = Date.now();

  try {
    // -----------------------------------------------------------------------
    // 1. Parse & validate configuration
    // -----------------------------------------------------------------------
    core.startGroup('📋 Configuration');
    const config = parseConfig();
    core.info(`AI Provider: ${config.aiProvider} (model: ${config.aiModel})`);
    core.info(`PM Tool: ${config.pmTool}`);
    core.info(`Generate Automation: ${config.generateAutomation}`);
    core.info(`Max Files Per Run: ${config.maxFilesPerRun}`);
    core.info(`Test Output Dir: ${config.testOutputDir}`);
    core.info(`Auto Commit: ${config.autoCommit}`);
    core.endGroup();

    // -----------------------------------------------------------------------
    // 2. Detect changes
    // -----------------------------------------------------------------------
    core.startGroup('🔍 Change Detection');
    const changeSet = await detectChanges(config.testOutputDir);
    core.info(`Mode: ${changeSet.isFullScan ? 'Full Scan' : 'Incremental'}`);
    core.info(`Files to analyze: ${changeSet.files.length}`);
    core.endGroup();

    if (changeSet.files.length === 0) {
      core.info('No source files to analyze. Skipping.');
      setOutputs(0, 0, 0, 'skipped', 'No source files changed');
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Analyze code context
    // -----------------------------------------------------------------------
    core.startGroup('🧠 Code Analysis');
    const codeContext = await analyzeCode(changeSet, config.maxFilesPerRun);
    core.info(`Project: ${codeContext.project.language} / ${codeContext.project.frameworks.join(', ')}`);
    core.info(`Files prepared for AI: ${codeContext.files.length}`);
    core.endGroup();

    // -----------------------------------------------------------------------
    // 4. Generate test cases via AI
    // -----------------------------------------------------------------------
    core.startGroup('🤖 AI Test Case Generation');
    const aiProvider = createAIProvider(config);
    const genResult = await generateTestCases(
      aiProvider,
      codeContext,
      changeSet,
      config.testOutputDir
    );

    if (genResult.skipped) {
      core.info(`Test case generation skipped: ${genResult.skipReason}`);
      setOutputs(0, 0, 0, 'skipped', genResult.skipReason || 'AI decided no test cases needed');
      core.endGroup();
      await writeSummary(genResult, null, null, startTime);
      return;
    }

    core.info(`Generated ${genResult.newTestCases.length} new, ${genResult.updatedTestCases.length} updated test cases`);
    core.info(`Token usage: ${genResult.tokenUsage.totalTokens} total`);
    core.endGroup();

    // -----------------------------------------------------------------------
    // 5. Save test cases locally
    // -----------------------------------------------------------------------
    core.startGroup('💾 Saving Test Cases');
    saveTestCases(config.testOutputDir, genResult.newTestCases, genResult.updatedTestCases);
    core.endGroup();

    // -----------------------------------------------------------------------
    // 6. Sync to PM tool
    // -----------------------------------------------------------------------
    let syncResult: SyncResult | null = null;
    if (config.pmTool !== 'none') {
      core.startGroup(`📤 Syncing to ${config.pmTool}`);
      syncResult = await syncTestCases(
        config,
        genResult.newTestCases,
        genResult.updatedTestCases,
        config.testOutputDir
      );
      core.endGroup();
    }

    // -----------------------------------------------------------------------
    // 7. Generate Playwright automation
    // -----------------------------------------------------------------------
    let autoResult: AutomationResult | null = null;
    if (config.generateAutomation) {
      core.startGroup('🎭 Generating Playwright Automation');
      const allNewTestCases = [...genResult.newTestCases, ...genResult.updatedTestCases];
      autoResult = await generateAutomation(
        aiProvider,
        allNewTestCases,
        codeContext.project,
        config.automationOutputDir
      );

      // Re-save test cases with updated automation status
      saveTestCases(config.testOutputDir, genResult.newTestCases, genResult.updatedTestCases);
      core.endGroup();
    }

    // -----------------------------------------------------------------------
    // 8. Auto-commit generated files
    // -----------------------------------------------------------------------
    if (config.autoCommit) {
      core.startGroup('📝 Auto-Committing');
      await autoCommit(config.testOutputDir, config.automationOutputDir);
      core.endGroup();
    }

    // -----------------------------------------------------------------------
    // 9. Set outputs & create summary
    // -----------------------------------------------------------------------
    const syncStatus = syncResult
      ? `${syncResult.created} created, ${syncResult.updated} updated${syncResult.errors.length > 0 ? `, ${syncResult.errors.length} errors` : ''}`
      : 'disabled';

    setOutputs(
      genResult.newTestCases.length,
      genResult.updatedTestCases.length,
      autoResult?.filesGenerated || 0,
      syncStatus
    );

    await writeSummary(genResult, syncResult, autoResult, startTime);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    core.info(`✅ AI Test Case Generator completed in ${elapsed}s`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI Test Case Generator failed: ${errorMessage}`);
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

function setOutputs(
  created: number,
  updated: number,
  automationFiles: number,
  syncStatus: string,
  skippedReason?: string
): void {
  core.setOutput('test_cases_created', created.toString());
  core.setOutput('test_cases_updated', updated.toString());
  core.setOutput('automation_files_generated', automationFiles.toString());
  core.setOutput('sync_status', syncStatus);
  if (skippedReason) {
    core.setOutput('skipped_reason', skippedReason);
  }
}

// ---------------------------------------------------------------------------
// Auto-Commit
// ---------------------------------------------------------------------------

async function autoCommit(testOutputDir: string, automationDir: string): Promise<void> {
  try {
    // Configure git
    await exec.exec('git', ['config', 'user.name', 'AI Test Case Generator']);
    await exec.exec('git', ['config', 'user.email', 'ai-test-generator@github-actions.bot']);

    // Stage generated files
    await exec.exec('git', ['add', testOutputDir]);
    await exec.exec('git', ['add', automationDir]);

    // Also stage playwright config if it was created
    try {
      await exec.exec('git', ['add', 'playwright.config.ts']);
    } catch {
      // File may not exist, that's fine
    }

    // Check if there are changes to commit
    let hasChanges = false;
    try {
      await exec.exec('git', ['diff', '--cached', '--quiet']);
    } catch {
      hasChanges = true;
    }

    if (!hasChanges) {
      core.info('No changes to commit');
      return;
    }

    // Commit
    await exec.exec('git', [
      'commit',
      '-m',
      '🤖 Auto-generated test cases and automation\n\n[skip ci]',
    ]);

    // Push
    const context = github.context;
    if (context.eventName === 'pull_request') {
      const prBranch = context.payload.pull_request?.head.ref;
      if (prBranch) {
        await exec.exec('git', ['push', 'origin', `HEAD:${prBranch}`]);
      }
    } else {
      await exec.exec('git', ['push']);
    }

    core.info('Auto-committed and pushed generated files');
  } catch (error) {
    core.warning(`Auto-commit failed: ${error}. Generated files are available as workflow artifacts.`);
  }
}

// ---------------------------------------------------------------------------
// Job Summary
// ---------------------------------------------------------------------------

async function writeSummary(
  genResult: GenerationResult,
  syncResult: SyncResult | null,
  autoResult: AutomationResult | null,
  startTime: number
): Promise<void> {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  let summary = `## 🤖 AI Test Case Generator Results\n\n`;
  summary += `| Metric | Value |\n|--------|-------|\n`;
  summary += `| ⏱️ Duration | ${elapsed}s |\n`;

  if (genResult.skipped) {
    summary += `| ⏭️ Status | Skipped |\n`;
    summary += `| 📝 Reason | ${genResult.skipReason} |\n`;
  } else {
    summary += `| ✅ New Test Cases | ${genResult.newTestCases.length} |\n`;
    summary += `| 🔄 Updated Test Cases | ${genResult.updatedTestCases.length} |\n`;
    summary += `| 🎟️ AI Tokens Used | ${genResult.tokenUsage.totalTokens.toLocaleString()} |\n`;

    if (syncResult) {
      summary += `| 📤 PM Sync Created | ${syncResult.created} |\n`;
      summary += `| 📤 PM Sync Updated | ${syncResult.updated} |\n`;
      if (syncResult.errors.length > 0) {
        summary += `| ⚠️ Sync Errors | ${syncResult.errors.length} |\n`;
      }
    }

    if (autoResult) {
      summary += `| 🎭 Automation Files | ${autoResult.filesGenerated} |\n`;
      if (autoResult.errors.length > 0) {
        summary += `| ⚠️ Automation Errors | ${autoResult.errors.length} |\n`;
      }
    }

    // List new test cases
    if (genResult.newTestCases.length > 0) {
      summary += `\n### New Test Cases\n\n`;
      summary += `| ID | Title | Priority | Type |\n|----|-------|----------|------|\n`;
      for (const tc of genResult.newTestCases) {
        summary += `| ${tc.id} | ${tc.title} | ${tc.priority} | ${tc.type} |\n`;
      }
    }

    // List warnings
    if (genResult.warnings.length > 0) {
      summary += `\n### ⚠️ Warnings\n\n`;
      for (const warning of genResult.warnings) {
        summary += `- ${warning}\n`;
      }
    }
  }

  await core.summary.addRaw(summary).write();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

run();
