/**
 * Sync Orchestrator — routes test cases to the configured PM tool.
 *
 * Reads sync state to know which test cases are already synced,
 * creates/updates items, and records the new sync state.
 */

import * as core from '@actions/core';
import { Config } from '../config';
import { TestCase, SyncState, SyncResult, SyncRecord } from '../test-cases/types';
import { loadSyncState, saveSyncState, computeContentHash } from '../test-cases/manager';
import { syncToJira } from './jira';
import { syncToClickUp } from './clickup';
import { syncToTrello } from './trello';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync test cases to the configured PM tool.
 *
 * @param config         Action config
 * @param newTestCases   Newly created test cases
 * @param updatedTestCases  Updated existing test cases
 * @param testOutputDir  Where sync state is stored
 */
export async function syncTestCases(
  config: Config,
  newTestCases: TestCase[],
  updatedTestCases: TestCase[],
  testOutputDir: string
): Promise<SyncResult> {
  if (config.pmTool === 'none') {
    core.info('PM tool sync disabled (pm_tool=none)');
    return { created: 0, updated: 0, skipped: 0, errors: [], details: [] };
  }

  core.info(`Syncing test cases to ${config.pmTool}...`);

  // Load existing sync state
  const syncState = loadSyncState(testOutputDir);

  // Determine what needs to be created vs updated
  const toCreate = filterForCreation(newTestCases, syncState);
  const toUpdate = filterForUpdate(updatedTestCases, syncState);

  core.info(`Sync plan: ${toCreate.length} to create, ${toUpdate.length} to update`);

  let result: SyncResult;

  try {
    switch (config.pmTool) {
      case 'jira':
        result = await syncToJira(config.jira!, toCreate, toUpdate, syncState);
        break;
      case 'clickup':
        result = await syncToClickUp(config.clickup!, toCreate, toUpdate, syncState);
        break;
      case 'trello':
        result = await syncToTrello(config.trello!, toCreate, toUpdate, syncState);
        break;
      default:
        result = { created: 0, updated: 0, skipped: 0, errors: [], details: [] };
    }
  } catch (error) {
    core.error(`Sync failed: ${error}`);
    result = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [`Sync to ${config.pmTool} failed: ${error}`],
      details: [],
    };
  }

  // Save updated sync state
  const updatedSyncState: SyncState = {
    records: mergeRecords(syncState.records, result.details),
    updatedAt: new Date().toISOString(),
  };
  saveSyncState(testOutputDir, updatedSyncState);

  // Log results
  core.info(`Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
  if (result.errors.length > 0) {
    core.warning(`Sync errors: ${result.errors.join('; ')}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterForCreation(testCases: TestCase[], syncState: SyncState): TestCase[] {
  const syncedIds = new Set(syncState.records.map((r) => r.testCaseId));
  return testCases.filter((tc) => !syncedIds.has(tc.id));
}

function filterForUpdate(testCases: TestCase[], syncState: SyncState): TestCase[] {
  const syncedMap = new Map(syncState.records.map((r) => [r.testCaseId, r]));

  return testCases.filter((tc) => {
    const record = syncedMap.get(tc.id);
    if (!record) return false; // Not synced yet, will be caught by creation
    const currentHash = computeContentHash(tc);
    return currentHash !== record.contentHash;
  });
}

function mergeRecords(existing: SyncRecord[], newRecords: SyncRecord[]): SyncRecord[] {
  const merged = new Map<string, SyncRecord>();

  for (const record of existing) {
    merged.set(record.testCaseId, record);
  }

  for (const record of newRecords) {
    merged.set(record.testCaseId, record);
  }

  return Array.from(merged.values());
}
