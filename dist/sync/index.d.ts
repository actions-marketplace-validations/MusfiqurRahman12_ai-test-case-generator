/**
 * Sync Orchestrator — routes test cases to the configured PM tool.
 *
 * Reads sync state to know which test cases are already synced,
 * creates/updates items, and records the new sync state.
 */
import { Config } from '../config';
import { TestCase, SyncResult } from '../test-cases/types';
/**
 * Sync test cases to the configured PM tool.
 *
 * @param config         Action config
 * @param newTestCases   Newly created test cases
 * @param updatedTestCases  Updated existing test cases
 * @param testOutputDir  Where sync state is stored
 */
export declare function syncTestCases(config: Config, newTestCases: TestCase[], updatedTestCases: TestCase[], testOutputDir: string): Promise<SyncResult>;
//# sourceMappingURL=index.d.ts.map