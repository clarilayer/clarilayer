import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructionRequest, isInstructionAgent } from "../src/lib/instructions.js";

describe("current instruction handoff", () => {
  for (const [agent, target] of [
    ["claude-code", "CLAUDE.md"],
    ["cursor", ".cursor/rules/clarilayer.mdc"],
    ["codex", "AGENTS.md"],
  ] as const) {
    test(`${agent} requests only its own target and a fresh server contract`, () => {
      const request = buildInstructionRequest(agent);
      assert.ok(request.includes(`target_file is ${target}`));
      for (const other of ["CLAUDE.md", "AGENTS.md", ".cursor/rules/clarilayer.mdc"]) {
        assert.equal(request.includes(other), other === target);
      }
      assert.match(request, /get_project_stanza with mode "full"/);
      assert.match(request, /mode "runtime" once/);
      assert.match(request, /recall_context before relevant work/);
      assert.match(request, /work_context/);
      assert.match(request, /no authenticated Connect project report scope/);
      assert.match(request, /Do not invent[\s\S]*remove or rebind a scoped current block/);
      assert.match(request, /or call sync_instruction_setup/);
      assert.match(request, /re-read the complete target/);
      assert.match(request, /all surrounding bytes are unchanged/);
      assert.match(request, /edited, duplicate, malformed, unknown or newer blocks/);
      assert.match(request, /does not authorize history import/);
      assert.doesNotMatch(request, /sha256:|managed-version:|cl_YOUR|capability v\d/);
    });
  }

  test("only supported own properties are accepted as agents", () => {
    for (const value of [undefined, "", "claude", "__proto__", "constructor", "toString", "codex\n"]) {
      assert.equal(isInstructionAgent(value), false);
    }
    for (const value of ["claude-code", "cursor", "codex"]) {
      assert.equal(isInstructionAgent(value), true);
    }
  });
});
