/**
 * Test Case Formatter — converts TestCase objects to JSON and Markdown.
 *
 * The Markdown output is designed to be human-readable and great for
 * reviewing in pull requests.
 */
import { TestCase } from './types';
/**
 * Format a single test case as Markdown.
 */
export declare function formatTestCaseMarkdown(tc: TestCase): string;
/**
 * Format a suite of test cases for a feature area as a single Markdown file.
 */
export declare function formatTestSuiteMarkdown(featureArea: string, testCases: TestCase[]): string;
/**
 * Format test cases as a JSON string for the test-cases.json file.
 */
export declare function formatTestCasesJSON(testCases: TestCase[]): string;
//# sourceMappingURL=formatter.d.ts.map