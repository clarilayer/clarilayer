# Install or update ClariLayer project instructions

This file retains its historical name so existing links keep working. Do not copy the old Analytics workflow into every project. Use the current managed bootstrap returned by the connected server.

The recommended path is **[Connect your AI → Update my AI setup](https://clarilayer.com/connect-ai)**. Its request includes the selected authenticated project scope for installation reporting.

For an unscoped local update, paste the following into your connected AI in the intended project, replacing the two placeholders from this table:

| Client ID | Target |
|---|---|
| `claude-code` | `CLAUDE.md` |
| `codex` | `AGENTS.md` |
| `cursor` | `.cursor/rules/clarilayer.mdc` |

```text
Update ClariLayer instructions for CLIENT_ID in this project only, targeting TARGET.
Call get_project_stanza with mode "full" and select only that client's descriptor.
If the tool or target is unavailable or inconsistent, report the gap and change nothing.
Follow the returned managed_apply_guidance exactly, using the generic managed_block
and required preamble. No authenticated Connect report scope was supplied: do not
invent instance metadata, call sync_instruction_setup, or remove/rebind a scoped block.
For a scoped update, direct me to Connect your AI -> Update my AI setup.
Create a missing target, or append to an unmarked existing target, only as the
returned contract permits; an existing Cursor rule requires its exact preamble.
Otherwise replace only exact recognized legacy content or a managed range permitted by that
contract. Preserve all surrounding bytes and line endings. Edited, duplicate,
malformed, unknown or newer ranges and non-exact Cursor frontmatter are conflicts:
show the complete one-file diff and ask before changing them.
Re-read the whole selected target after an authorized write. Verify the returned
managed block, version and hash and unchanged surrounding bytes before reporting
installed. Otherwise report already current for an exact no-op or conflict/manual review.
Do not scan or edit other instruction files or projects. Do not import history,
enable capture, or grant provider or semantic-search consent as part of this update.
```

CLI 0.2.2 source also generates a client-specific request through `instructions --agent <id>`; see [CLI.md](../CLI.md) for release status and local usage. The request itself reads no key, performs no network request and edits no file. Your connected AI performs the explicit local update.

After installation, the bootstrap obtains `get_project_stanza` with `mode: "runtime"` once at the first relevant use in each new AI session. General recall uses `recall_context`; confirmed work saves use `remember` with `work_context`. Follow the returned workflow for correction, forget and the completion checkpoint. Runtime guidance is not proof that a client actually followed it.
