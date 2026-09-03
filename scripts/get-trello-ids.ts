/**
 * Helper script to find your Trello Board ID and List IDs.
 *
 * Usage:
 *   $env:TRELLO_API_KEY="your-key"
 *   $env:TRELLO_API_TOKEN="your-token"
 *   npx ts-node scripts/get-trello-ids.ts
 */

const API_KEY = process.env.TRELLO_API_KEY || '';
const API_TOKEN = process.env.TRELLO_API_TOKEN || '';

if (!API_KEY || !API_TOKEN) {
  console.error('❌ Missing TRELLO_API_KEY or TRELLO_API_TOKEN.');
  console.error('');
  console.error('1. Go to: https://trello.com/power-ups/admin');
  console.error('2. Create an integration (or click your existing one) and copy the API Key');
  console.error('3. Click "Generate a Token" right next to the API Key and copy the Token');
  console.error('');
  console.error('Then run:');
  console.error('  $env:TRELLO_API_KEY="your-api-key"');
  console.error('  $env:TRELLO_API_TOKEN="your-api-token"');
  console.error('  npx ts-node scripts/get-trello-ids.ts');
  process.exit(1);
}

async function main() {
  console.log('🔍 Connecting to Trello API...\n');

  try {
    // 1. Fetch all user boards
    const boardsRes = await fetch(
      `https://api.trello.com/1/members/me/boards?fields=name,id,url&key=${API_KEY}&token=${API_TOKEN}`
    );

    if (!boardsRes.ok) {
      const err = await boardsRes.text();
      throw new Error(`Failed to fetch boards (HTTP ${boardsRes.status}): ${err}`);
    }

    const boards = (await boardsRes.json()) as Array<{ id: string; name: string; url: string }>;

    if (boards.length === 0) {
      console.log('No boards found on this account. Please create a board on Trello first.');
      return;
    }

    console.log(`📋 Found ${boards.length} Board(s):\n`);

    for (const board of boards) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📌 Board: "${board.name}"`);
      console.log(`   Board ID: ${board.id}`);
      console.log(`   URL:      ${board.url}`);

      // 2. Fetch lists for each board
      const listsRes = await fetch(
        `https://api.trello.com/1/boards/${board.id}/lists?fields=name,id&key=${API_KEY}&token=${API_TOKEN}`
      );

      if (listsRes.ok) {
        const lists = (await listsRes.json()) as Array<{ id: string; name: string }>;
        console.log(`   Columns / Lists:`);
        for (const list of lists) {
          console.log(`     👉 "${list.name}" -> List ID: ${list.id}`);
        }
      }
      console.log('');
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log('✅ Pick the Board ID and the List ID where you want test cases added!');
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

main();
