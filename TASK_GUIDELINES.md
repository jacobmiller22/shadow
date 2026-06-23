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
    3. If not found, call `create_issue`.
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
         Investigating staging token expiration to unblock QA testing.
         ```

---

### Scenario B: Git Branch / Feature Context Switch
*   **Trigger**: The user switches to a new feature branch or begins a planned feature.
    *   *Example*: In the `/Users/jacobmiller22/projects/shadow` directory, the branch switches to `feature/auth-refresh-token`.
*   **Agent Action**:
    1. Determine the project name by checking which directory in `projects/` contains `local_path` matching `/Users/jacobmiller22/projects/shadow` (matches `projects/shadow/README.md`).
    2. Search the repo for a matching issue.
    3. If missing, create a tracking issue to capture progress:
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
         Tracking local progress, files, and commands for the auth refresh token implementation.
         ```

---

### Scenario C: Blockers & Dependencies
*   **Trigger**: The user encounters a blocker that halts progress on the active task.
    *   *Example*: *"I'm waiting on the DevOps team to fix the CI runner configuration."*
*   **Agent Action**:
    1. Locate the active task issue.
    2. Update the status and add the `type:blocker` label.
       - **Comment Body**:
         ```markdown
         ---
         status: Blocked
         ---
         Blocked: Waiting for CI runner configuration fix from DevOps.
         ```

---

### Scenario D: Context Preservation (Session Wrap-up)
*   **Trigger**: The user stops work, signs off for the day, or switches to a different project workspace.
    *   *Example*: *"Done for the day on shadow, code compiles but need to fix unit tests tomorrow."*
*   **Agent Action**:
    1. Locate the active `status: In Progress` issue(s) for the current project.
    2. Post a comment summarizing the current state, modified files, and last run command.
       - **Comment Body**:
         ```markdown
         ### Session Wrap-up
         - **Status**: Code compiles; auth token is parsed successfully.
         - **Blocked on**: Unit tests failing in `auth_test.go`.
         - **Files modified**: `auth.go`, `auth_test.go`
         - **Next Step**: Debug the mock response setup in the tests.
         ```
