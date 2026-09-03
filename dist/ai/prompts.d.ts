/**
 * Prompt Templates — centralized prompts for all AI operations.
 *
 * Each prompt is designed to produce structured JSON output matching
 * our TestCase and TestDecision schemas.
 */
import { CodeContext, ChangeSet, TestCase, ProjectContext } from '../test-cases/types';
export declare const TEST_CASE_JSON_SCHEMA: {
    type: "object";
    properties: {
        testCases: {
            type: "array";
            items: {
                type: "object";
                properties: {
                    id: {
                        type: "string";
                        description: string;
                    };
                    title: {
                        type: "string";
                        description: string;
                    };
                    description: {
                        type: "string";
                        description: string;
                    };
                    priority: {
                        type: "string";
                        enum: string[];
                    };
                    type: {
                        type: "string";
                        enum: string[];
                    };
                    preconditions: {
                        type: "array";
                        items: {
                            type: "string";
                        };
                    };
                    steps: {
                        type: "array";
                        items: {
                            type: "object";
                            properties: {
                                stepNumber: {
                                    type: "number";
                                };
                                action: {
                                    type: "string";
                                };
                                expectedResult: {
                                    type: "string";
                                };
                                testData: {
                                    type: "string";
                                };
                            };
                            required: string[];
                        };
                    };
                    expectedResult: {
                        type: "string";
                        description: string;
                    };
                    sourceFiles: {
                        type: "array";
                        items: {
                            type: "string";
                        };
                    };
                    tags: {
                        type: "array";
                        items: {
                            type: "string";
                        };
                    };
                    featureArea: {
                        type: "string";
                    };
                };
                required: string[];
            };
        };
        warnings: {
            type: "array";
            items: {
                type: "string";
            };
        };
    };
    required: string[];
};
export declare const TEST_DECISION_JSON_SCHEMA: {
    type: "object";
    properties: {
        needsTestCase: {
            type: "boolean";
        };
        reasoning: {
            type: "string";
        };
        changeType: {
            type: "string";
            enum: string[];
        };
        suggestedTestCount: {
            type: "number";
        };
    };
    required: string[];
};
/**
 * Build the system prompt for test case generation.
 */
export declare function buildSystemPrompt(): string;
/**
 * Build the user prompt for full-scan test generation.
 */
export declare function buildFullScanPrompt(context: CodeContext): string;
/**
 * Build the user prompt for incremental test generation.
 */
export declare function buildIncrementalPrompt(context: CodeContext, changeSet: ChangeSet, existingTests: TestCase[]): string;
/**
 * Build the prompt for the "should we create test cases?" decision.
 */
export declare function buildDecisionPrompt(changeSet: ChangeSet): string;
/**
 * Build the prompt for generating Playwright automation code.
 */
export declare function buildAutomationPrompt(testCase: TestCase, projectContext: ProjectContext): string;
//# sourceMappingURL=prompts.d.ts.map