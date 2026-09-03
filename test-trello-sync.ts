/**
 * Test Trello Sync Locally
 *
 * Syncs generated test cases from .testcases/test-cases.json to Trello.
 *
 * Usage:
 *   $env:TRELLO_API_KEY="your-key"
 *   $env:TRELLO_API_TOKEN="your-token"
 *   $env:TRELLO_BOARD_ID="your-board-id"
 *   $env:TRELLO_LIST_ID="your-list-id"
 *   npx ts-node test-trello-sync.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { syncToTrello } from './src/sync/trello';
import { TestCase, SyncState } from './src/test-cases/types';

const API_KEY = process.env.TRELLO_API_KEY || '';
const API_TOKEN = process.env.TRELLO_API_TOKEN || '';
const BOARD_ID = process.env.TRELLO_BOARD_ID || '';
const LIST_ID = process.env.TRELLO_LIST_ID || '';

if (!API_KEY || !API_TOKEN || !BOARD_ID || !LIST_ID) {
  console.error('❌ Missing one or more required Trello environment variables:');
  console.error('   TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID, TRELLO_LIST_ID');
  console.error('');
  console.error('Tip: run "npx ts-node scripts/get-trello-ids.ts" to find your IDs!');
  process.exit(1);
}

async function main() {
  const jsonPath = path.join('.testcases', 'test-cases.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ No test cases found at ${jsonPath}. Run "npx ts-node test-local.ts" first!`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const testCases: TestCase[] = raw.testCases || [];

  console.log(`📤 Syncing ${testCases.length} test cases to Trello (List ID: ${LIST_ID})...\n`);

  const emptySyncState: SyncState = { records: [], updatedAt: new Date().toISOString() };

  const result = await syncToTrello(
    {
      apiKey: API_KEY,
      apiToken: API_TOKEN,
      boardId: BOARD_ID,
      listId: LIST_ID,
    },
    testCases,
    [],
    emptySyncState
  );

  console.log('\n📊 Sync Results:');
  console.log(`   ✅ Created: ${result.created} card(s)`);
  console.log(`   🔄 Updated: ${result.updated} card(s)`);
  if (result.errors.length > 0) {
    console.log(`   ⚠️ Errors:  ${result.errors.length}`);
    result.errors.forEach((e) => console.log(`      - ${e}`));
  }

  console.log('\n🔗 Created Cards in Trello:');
  result.details.forEach((d) => {
    console.log(`   - ${d.testCaseId}: ${d.externalUrl}`);
  });

  console.log('\n🎉 Check your Trello board!');
}

main();
