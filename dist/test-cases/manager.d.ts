/**
 * Test Case Manager — handles CRUD for the local `.testcases/` directory.
 *
 * Reads, writes, and updates test case files (JSON + Markdown).
 * Also manages the sync state file that tracks PM tool integration.
 */
import { TestCase, SyncState } from './types';
/**
 * Load all test cases from the output directory.
 */
export declare function loadTestCases(testOutputDir: string): TestCase[];
/**
 * Load the sync state from the output directory.
 */
export declare function loadSyncState(testOutputDir: string): SyncState;
/**
 * Save test cases to the output directory (JSON + Markdown).
 */
export declare function saveTestCases(testOutputDir: string, newTestCases: TestCase[], updatedTestCases: TestCase[]): void;
/**
 * Save sync state to the output directory.
 */
export declare function saveSyncState(testOutputDir: string, syncState: SyncState): void;
/**
 * Compute a content hash for a test case, used to detect changes for sync.
 */
export declare function computeContentHash(testCase: TestCase): string;
//# sourceMappingURL=manager.d.ts.map