---
name: Connection / setup help
about: Something went wrong connecting your agent to ClariLayer
title: "[setup] "
labels: ["setup"]
---

**Which agent?**
Claude Code / Cursor / Codex / claude.ai / other:

**What did you run or paste?**
(redact your `cl_…` key)

```
paste the command or config here
```

**What happened?**
(error message, or "the tool never gets called")

**Checklist**
- [ ] I completed the selected client's authentication in Connect your AI (OAuth where supported, or a local context key)
- [ ] For Claude Code, I included `--transport http`
- [ ] I fully restarted the app (Cursor/Codex)
- [ ] For claude.ai, I added the custom connector URL and approved the OAuth prompt
- [ ] I ran Update my AI setup for the intended client and project, and checked its local result
- [ ] I checked whether `recall_context` is actually available in my client
