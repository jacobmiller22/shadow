export interface TemplateSubtask {
  titleSuffix: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
}

export interface DecompositionTemplate {
  name: string;
  description: string;
  subtasks: TemplateSubtask[];
}

export class DecompositionTemplateService {
  private static templates: Record<string, DecompositionTemplate> = {
    feature: {
      name: "feature",
      description: "Standard end-to-end feature delivery workflow",
      subtasks: [
        {
          titleSuffix: "Specification & Interface Design",
          description: "Define technical contracts, types, and schema models.\n\n- [ ] Review architecture requirements\n- [ ] Define TypeScript types and interfaces\n- [ ] Validate backward compatibility",
          priority: "high",
        },
        {
          titleSuffix: "Core Implementation",
          description: "Implement core business logic, service handlers, and storage queries.\n\n- [ ] Implement service methods\n- [ ] Add event logging and error handling\n- [ ] Wire into CLI or API router",
          priority: "high",
        },
        {
          titleSuffix: "Unit & Integration Tests",
          description: "Write automated tests covering positive paths, error handling, and edge cases.\n\n- [ ] Unit tests for service layer\n- [ ] Integration tests with database\n- [ ] Edge cases and failure modes verified",
          priority: "medium",
        },
        {
          titleSuffix: "Documentation & Verification",
          description: "Update developer documentation and verify end-to-end flow.\n\n- [ ] Update README and CLI help text\n- [ ] End-to-end manual or automated verification passed",
          priority: "low",
        },
      ],
    },
    bugfix: {
      name: "bugfix",
      description: "Root-cause analysis, isolated reproduction, fix, and regression testing",
      subtasks: [
        {
          titleSuffix: "Reproduction & Failing Test",
          description: "Isolate bug and write minimal reproducing automated test.\n\n- [ ] Reproduce issue locally\n- [ ] Add failing test asserting expected behavior",
          priority: "critical",
        },
        {
          titleSuffix: "Fix Implementation",
          description: "Implement minimal, surgical fix resolving the root cause.\n\n- [ ] Apply code fix\n- [ ] Verify reproducing test now passes",
          priority: "high",
        },
        {
          titleSuffix: "Regression Audit & Verification",
          description: "Run full project test suite and verify no regressions introduced.\n\n- [ ] Run full test harness\n- [ ] Check for concurrency or race condition side effects",
          priority: "medium",
        },
      ],
    },
    refactor: {
      name: "refactor",
      description: "Non-breaking architectural refactor and modular extraction",
      subtasks: [
        {
          titleSuffix: "Characterization Tests",
          description: "Establish baseline test coverage of existing behavior before altering code.\n\n- [ ] Verify 100% existing test pass rate\n- [ ] Add missing tests covering target modules",
          priority: "high",
        },
        {
          titleSuffix: "Modular Extraction",
          description: "Restructure modules, clean interfaces, and eliminate dead code.\n\n- [ ] Extract modular components\n- [ ] Update dependency imports\n- [ ] Verify zero public API breaking changes",
          priority: "high",
        },
        {
          titleSuffix: "Verification & Benchmarks",
          description: "Verify clean compilation and benchmark performance.\n\n- [ ] Full test harness passing\n- [ ] Verify latency and memory overhead",
          priority: "medium",
        },
      ],
    },
    research: {
      name: "research",
      description: "Timeboxed technical spike and architectural evaluation",
      subtasks: [
        {
          titleSuffix: "Literature & Codebase Audit",
          description: "Investigate prior art, dependencies, and external documentation.\n\n- [ ] Review upstream API docs\n- [ ] Identify constraints and failure modes",
          priority: "medium",
        },
        {
          titleSuffix: "Proof-of-Concept Prototype",
          description: "Build minimal throwaway prototype validating hypotheses.\n\n- [ ] Build minimal prototype\n- [ ] Test real-world latency and edge cases",
          priority: "medium",
        },
        {
          titleSuffix: "Findings & Architecture Recommendation",
          description: "Document findings, trade-offs, and recommend implementation path.\n\n- [ ] Write decision record (ADR)\n- [ ] File shovel-ready implementation tickets",
          priority: "low",
        },
      ],
    },
  };

  public static listTemplates(): DecompositionTemplate[] {
    return Object.values(this.templates);
  }

  public static getTemplate(name: string): DecompositionTemplate | null {
    return this.templates[name.toLowerCase()] || null;
  }
}
