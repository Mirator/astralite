# Claude Code in this repository

@AGENTS.md

AGENTS.md above is the source of truth for how to work here; this file only imports it so Claude Code loads
it. Two parts of it are the ones most often skipped:

- **Tests must be able to fail.** Before a test is done, plant the bug it names and watch it fail with its
  own message; assert the precondition that makes the assertion meaningful; never skip or branch around an
  expect at runtime; read what the game did rather than recomputing it; keep a rule's test in the node suite
  and only its wiring in the browser suite. The full list is "Writing tests that can fail".
- **Publishing is opt-in.** Do not push, merge, deploy or trigger a workflow unless the task asks for it.
