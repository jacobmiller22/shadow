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
       - Generate a unique scratch filename: `~/.local/share/shadow/scratch_20260623T024000Z_fix_expired_staging_auth_token.md`.
       - Write the drafted issue payload to the scratch file.
       - Run `git pull --rebase` inside the backlog repository clone directory.
       - Execute the `create_issue` binding using the scratch file. If the network is offline or `gh` fails, rename and move the file to the local queue: `~/.config/shadow/queue/queue_20260623T024000Z_fix_expired_staging_auth_token.md`.
       - If execution succeeds, delete the scratch file.
       - **Title**: Fix expired staging auth token
       - **Labels**: `type:ad-hoc`, `type:in-progress`, `project:auth-service`
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
       - Generate a unique scratch filename: `~/.local/share/shadow/scratch_20260623T024005Z_implement_auth_refresh_token_flow.md`.
       - Write the payload to the scratch file.
       - Run `git pull --rebase` inside the backlog repository clone directory.
       - Execute `create_issue` pointing to the scratch file (falling back to the queue directory on timeout).
       - Delete the scratch file on success.
       - **Title**: Implement auth refresh token flow
       - **Labels**: `type:jira-shadow` (if mirroring a Jira story), `type:in-progress`, `project:shadow`
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
    2. Update the main issue body description status metadata to `Blocked`, remove the `type:in-progress` label (using the `remove_label` binding), and add the `type:blocker` label (using the `add_label` binding).
    3. Post a comment detailing the blocker:
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
    2. If work is paused or suspended, remove the `type:in-progress` label (using the `remove_label` binding).
    3. Post a comment summarizing the current state, modified files, references, and last run command.
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
 
1. **Lifecycle Triggers**: The shadow skill should be loaded at the start and end of every conversation, and during conversations when it appears that an item of work or as soon as meaningful progress has been made, repeating until the conversation is closed.
2. **Leverage Subagents & Silent Execution**: Always leverage a relevant subagent (like `research` or a subagent configured with the `shadow` skill) to silently initialize, synchronize, and update task states asynchronously in the background without requesting user permission or confirmation.
3. **Issue Body & Checklist Sync**: When progress is made, a task is resumed, or a task completes, the agent must update the main issue description body itself. Specifically, during active iterations or when a task is resumed, the agent must ensure that the frontmatter `status` is updated to `In Progress` (especially if it was previously `Blocked` or if it's newly reopened/resumed) and that the `type:in-progress` label is added to the issue (using the `add_label` binding). Keep the checkbox checklist `- [x]` in sync at every step. Never leave issue bodies with out-of-date statuses or unchecked checklists upon closure.
4. **Resolve Custom Labels**: If the global configuration contains `"custom_labels"`, map standard labels (such as `type:ad-hoc`, `type:blocker`, or `type:in-progress`) to the user's custom mapped labels before invoking bindings. Fall back to standard labels for keys not present in the mapping. Ensure that custom labels are verified/created on GitHub as needed.
5. **Enforce Formatting & Link Sanitization**: Always apply the strict issue body layout (Description, Scope & Checklist, References, Technical Context). Actively search and extract multiple URLs (Jira, GitHub, CI, Docs) from context, sanitizing trailing punctuation and removing duplicates.
6. **No-Duplicate & Append-Only Rules**: Check for existing open/closed issues using `search_issue` before creating new tracking tasks. Append intermediate updates as comments rather than editing the main description description for progress history.
7. **Command & Log Filtering**: When logging commands in progress comments, do **not** log read-only or trivial/informational shell commands (e.g., `git diff`, `git status`, `git branch`, `git log`, `ls`, `pwd`, `cat`, `which`, `gh auth status`, `gh issue list`). Only log state-modifying or validating commands (e.g., `git commit`, `git push`, build commands, test runs, or script executions).
8. **Comment Cleanliness & Anti-Bloat**: Issue comments **must never** contain YAML frontmatter blocks. Frontmatter belongs exclusively in the main issue description. Avoid posting automated "Still in progress" comments during routine start-of-session checks unless new files were modified or state changes occurred.
9. **Local Concurrency Drafting**: Create unique scratch files using a task-relevant combo-phrase: `scratch_<ISO8601-timestamp>_<task_slug>.md` under `~/.local/share/shadow/` for drafting payloads, and delete them immediately upon successful upload.
10. **Dual-Verification Closure & Consolidated Wrap-up**: Never close an issue if tests are failing, the build is broken, blockers remain unresolved, or subtasks in the checklist are incomplete. Before closing, ensure all checklist items in the main issue description are updated to completed (`[x]`), the metadata status frontmatter is updated to `Completed`, and the `type:in-progress` label is removed (using the `remove_label` binding). To avoid double-posting, close the issue with a single comprehensive wrap-up comment instead of posting a separate progress comment and close comment back-to-back.
11. **Git Reconciliation**: Run `git pull --rebase` inside the backlog repository before executing any commit or push to prevent lock/conflict errors. Retry up to 3 times with exponential backoff on lock rejections.
12. **Offline Local Queuing**: Catch API execution failures. If offline or timed out, rename and cache the scratch payload from `~/.local/share/shadow/` to `~/.config/shadow/queue/queue_*.md`. Process files in FIFO order at the start of the next session when connectivity returns.
13. **Configuration Recoverability**: If `config.json` is missing or corrupt, log errors to `~/.config/shadow/error.log` and fallback to executing standard vanilla CLI commands directly with default labels.

