export class CompletionCommandHandler {
  public static generate(shell: string): void {
    const s = shell.toLowerCase();

    if (s === "zsh") {
      console.log(`#compdef shadow

_shadow_completion() {
  local -a commands
  commands=(
    'task:Manage local tasks and work breakdown structures'
    'ui:Open interactive terminal Kanban and hierarchy viewer'
    'sync:Synchronize local mutations with remote Cloudflare Edge & Jira'
    'link:Link a local task to a remote issue'
    'unlink:Unlink a local task from a remote issue'
    'audit:View sync audit logs'
    'db:Database administration, backups, and recovery'
    'hook:Install or manage non-blocking Git automation hooks'
    'completion:Generate shell autocompletion scripts'
  )

  _arguments \\
    '--json[Output response in structured JSON]' \\
    '--db-path[Explicit SQLite database path override]' \\
    '--env[Environment tier: production, development, test]' \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      _describe -t commands 'shadow command' commands
      ;;
    args)
      case $line[1] in
        task)
          local -a task_cmds
          task_cmds=(
            'add:Create a new task'
            'get:Retrieve task details by ID'
            'active:Show or auto-provision active task'
            'pivot:Pause active task and switch to another'
            'list:List tasks in current workspace'
            'edit:Update an existing task'
            'close:Close a task and mark as done'
            'checklist:Inspect or check off markdown checklist items'
            'comment:Append a progress note to the task'
            'history:View chronological audit event history'
            'claim:Claim task with worker lock lease'
            'release:Release worker claim lock'
            'template:List task decomposition templates'
            'decompose:Decompose task using predefined template'
            'delete:Permanently delete a task'
            'search:Full-text search tasks using SQLite FTS5'
            'tree:Display hierarchical task tree'
            'links:List remote links associated with this task'
          )
          _describe -t task_cmds 'shadow task command' task_cmds
          ;;
        *)
          ;;
      esac
      ;;
  esac
}

compdef _shadow_completion shadow
`);
    } else if (s === "bash") {
      console.log(`#!/usr/bin/env bash
_shadow_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  opts="task ui sync link unlink audit db hook completion --json --db-path --env"

  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
    return 0
  fi

  if [ "\${prev}" == "task" ]; then
    local task_cmds="add get active pivot list edit close checklist comment history claim release template decompose delete search tree links"
    COMPREPLY=( $(compgen -W "\${task_cmds}" -- \${cur}) )
    return 0
  fi
}
complete -F _shadow_completions shadow
`);
    } else if (s === "fish") {
      console.log(`complete -c shadow -n "__fish_use_subcommand" -a "task" -d "Manage local tasks"
complete -c shadow -n "__fish_use_subcommand" -a "ui" -d "Terminal Kanban board"
complete -c shadow -n "__fish_use_subcommand" -a "sync" -d "Synchronize mutations"
complete -c shadow -n "__fish_use_subcommand" -a "link" -d "Link remote issue"
complete -c shadow -n "__fish_use_subcommand" -a "unlink" -d "Unlink remote issue"
complete -c shadow -n "__fish_use_subcommand" -a "audit" -d "View audit logs"
complete -c shadow -n "__fish_use_subcommand" -a "db" -d "Database operations"
complete -c shadow -n "__fish_use_subcommand" -a "hook" -d "Git hook automation"
`);
    } else {
      console.error(`Unsupported shell: ${shell}. Supported shells: zsh, bash, fish.`);
      process.exitCode = 1;
    }
  }
}
