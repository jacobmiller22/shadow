# Task Tracking Guidelines

Use this guide to determine when to automatically intercept the user's workflow to log or update issues in the configured task repository using **shadow**.

## Guidelines for Proactive Tracking

The AI agent should monitor activity and take action in the following scenarios without requiring explicit instruction.

---

### Scenario A: Ad-Hoc Interruption / Task Pivot
*   **Trigger**: The user starts working on a new unscheduled request or bug report in a specific workspace.
    *   *Example*: *"I'm going to look into the staging token expiry issue QA just reported on the auth-service project."*
*   **Agent Action**:
    1. Search the backlog repository's `projects/auth-service/README.md` to retrieve local repository path (`local_path`) and design docs (`docs_url`).
    2. Invoke `search_issue` for "staging token expiry" under the project.
    3. If not found:
       - Generate a unique high-entropy scratch filename: `~/.config/shadow/scratch/scratch_20260623T024000Z_a8f9c2d7b5e43a12.md`.
       - Write the drafted issue payload to the scratch file.
       - Run `git pull --rebase` inside the backlog repository clone directory.
       - Execute the `create_issue` binding using the scratch file. If the network is offline or `gh` fails, rename and move the file to the local queue: `~/.config/shadow/queue/queue_20260623T024000Z_a8f9c2d7b5e43a12.md`.
       - If execution succeeds, delete the scratch file.
       - **Title**: Fix expired staging auth token
       - **Labels**: `type:ad-hoc`, `project:auth-service`
       - **Body**:
         ```markdown
         ---
         project: auth-service
         origin_source: QA report
         deadline: None
         status: In Progress
         context_tags: [#staging, #auth]
         ---

         # Description
         Investigating staging token expiration to unblock QA testing.

         # Scope & Checklist
         - [ ] Inspect staging authentication log streams
         - [ ] Verify staging token signature and expiration window settings

         # References
         - https://jira.company.com/browse/QA-4561
         - https://github.com/company/auth-service/actions/runs/88921

         # Technical Context
         - **Active Branch**: None
         - **Modified Files**: None
         - **Environment**: staging
         ```

---

### Scenario B: Git Branch / Feature Context Switch
*   **Trigger**: The user switches to a new feature branch or begins a planned feature.
    *   *Example*: In the `/Users/jacobmiller22/projects/shadow` directory, the branch switches to `feature/auth-refresh-token`.
*   **Agent Action**:
    1. Determine the project name by checking which directory in `projects/` contains `local_path` matching `/Users/jacobmiller22/projects/shadow` (matches `projects/shadow/README.md`).
    2. Search the repo for a matching issue to avoid duplicates.
    3. If missing:
       - Generate a unique high-entropy scratch filename: `~/.config/shadow/scratch/scratch_20260623T024005Z_e93b1d7fb8c942e1.md`.
       - Write the payload to the scratch file.
       - Run `git pull --rebase` inside the backlog repository clone directory.
       - Execute `create_issue` pointing to the scratch file (falling back to the queue directory on timeout).
       - Delete the scratch file on success.
       - **Title**: Implement auth refresh token flow
       - **Labels**: `type:jira-shadow` (if mirroring a Jira story), `project:shadow`
       - **Body**:
         ```markdown
         ---
         project: shadow
         origin_source: Self / Project Plan
         deadline: None
         status: In Progress
         context_tags: [#auth, #backend]
         ---

         # Description
         Tracking local progress, files, and commands for the auth refresh token implementation.

         # Scope & Checklist
         - [ ] Implement refresh token generation logic
         - [ ] Verify refresh token database persistence
         - [ ] Add unit tests for refresh token flow

         # References
         - https://jira.company.com/browse/SHADOW-120
         - https://github.com/jacobmiller22/shadow/pull/4

         # Technical Context
         - **Active Branch**: feature/auth-refresh-token
         - **Modified Files**: None
         - **Environment**: development
         ```

---

### Scenario C: Blockers & Dependencies
*   **Trigger**: The user encounters a blocker that halts progress on the active task.
    *   *Example*: *"I'm waiting on the DevOps team to fix the CI runner configuration."*
*   **Agent Action**:
    1. Locate the active task issue.
    2. Update the status and add the `type:blocker` label via comment. Do not overwrite the main description.
       - Draft the comment using a unique scratch file, run `git pull --rebase` on the backlog repo, execute the update binding (e.g. `gh issue comment`), and delete the scratch file.
       - **Comment Body**:
         ```markdown
         ### Blocker Encountered
         - **Status Update**: Blocked
         - **Reason**: Waiting for CI runner configuration fix from DevOps.
         - **References**:
           - https://github.com/company/infra/issues/942
         ```

---

### Scenario D: Context Preservation (Session Wrap-up)
*   **Trigger**: The user stops work, signs off for the day, or switches to a different project workspace.
    *   *Example*: *"Done for the day on shadow, code compiles but need to fix unit tests tomorrow."*
*   **Agent Action**:
    1. Locate the active `status: In Progress` issue(s) for the current project.
    2. Post a comment summarizing the current state, modified files, references, and last run command.
       - Draft the comment payload using a unique scratch file, verify git sync, execute the comment binding, and clean up the scratch file.
       - **Comment Body**:
         ```markdown
         ### Session Wrap-up
         - **Status**: Code compiles; auth token is parsed successfully.
         - **Blocked on**: Unit tests failing in `auth_test.go`.
         - **Files modified**: `auth.go`, `auth_test.go`
         - **Next Step**: Debug the mock response setup in the tests.
         - **References**:
           - https://github.com/jacobmiller22/shadow/actions/runs/12345
           - https://github.com/jacobmiller22/shadow/actions/runs/12346
         ```

---

## Agent Execution Guidelines

To prevent interrupting the user and to maintain clean separation of concerns, agents must adhere to the following when executing shadow operations:

1. **Leverage Subagents**: Always leverage a relevant subagent (like `research` or a subagent configured with the `shadow` skill) to document task changes.
2. **Stage Updates**: Ensure the tracking issue is created or updated at every stage (at the start, periodically in between, and at the end of completing tasks).
3. **Silent & Asynchronous Execution**: All updates via shadow must run asynchronously in the background as background tasks/subagents. The agent must never request permission or confirmation from the user before executing shadow operations.
4. **Resolve Custom Labels**: If the global configuration contains `"custom_labels"`, map standard labels (such as `type:ad-hoc` or `type:blocker`) to the user's custom mapped labels before invoking bindings. Fall back to standard labels for keys not present in the mapping. Ensure that custom labels are verified/created on GitHub as needed.
5. **Enforce Formatting & Link Sanitization**: Always apply the strict issue body layout (Description, Scope & Checklist, References, Technical Context). Actively search and extract multiple URLs (Jira, GitHub, CI, Docs) from context, sanitizing trailing punctuation and removing duplicates.
6. **No-Duplicate & Append-Only Rules**: Check for existing open/closed issues using `search_issue` before creating new tracking tasks. Append all intermediate progress reports as comments rather than modifying the main description.
7. **Local Concurrency Drafting**: Create unique, high-entropy scratch files: `scratch_<ISO8601-timestamp>_<UUIDv4_or_16_char_hex>.md` under `~/.config/shadow/scratch/` for drafting payloads, and delete them immediately upon successful upload.
8. **Dual-Verification Closure**: Never close an issue if tests are failing, the build is broken, blockers remain unresolved, or subtasks in the checklist are incomplete. Require checklist completion, green tests, and runtime verification (or user confirmation) to close.
9. **Git Reconciliation**: Run `git pull --rebase` inside the backlog repository before executing any commit or push to prevent lock/conflict errors. Retry up to 3 times with exponential backoff on lock rejections.
10. **Offline Local Queuing**: Catch API execution failures. If offline or timed out, rename and cache the payload under `~/.config/shadow/queue/queue_*.md`. Process files in FIFO order at the start of the next session when connectivity returns.
11. **Configuration Recoverability**: If `config.json` is missing or corrupt, log errors to `~/.config/shadow/error.log` and fallback to executing standard vanilla CLI commands directly with default labels.

