/**
 * Change Detector — identifies what files changed between commits.
 *
 * On first run (no existing test cases), flags all source files for full scan.
 * On subsequent runs, uses `git diff` to find changed files and categorize them.
 * Filters out non-source files (images, lockfiles, etc.).
 */
import { ChangeSet } from '../test-cases/types';
/**
 * Detect changes since the last analyzed commit.
 * If testOutputDir does not exist, performs a full scan of all source files.
 */
export declare function detectChanges(testOutputDir: string): Promise<ChangeSet>;
//# sourceMappingURL=index.d.ts.map