import { buildInstructionRequest, isInstructionAgent } from "../lib/instructions.js";

const HELP = `Print a request for your connected AI to install or update this project's ClariLayer instructions.

Usage: npx clarilayer instructions --agent <claude-code|cursor|codex>

Paste the request into the selected AI in the intended project after connecting
ClariLayer. It fetches the current server contract and updates only that target.
This command reads no key, makes no network request and changes no files.
For authenticated per-project setup status: https://clarilayer.com/connect-ai`;

/** This read-only route deliberately does not enter init or inspect credentials. */
export function runInstructions(rest: string[]): number {
  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
    console.log(HELP);
    return 0;
  }
  const agent = rest.length === 2 && rest[0] === "--agent"
    ? rest[1]
    : rest.length === 1 && rest[0].startsWith("--agent=")
      ? rest[0].slice("--agent=".length)
      : undefined;
  if (!isInstructionAgent(agent)) {
    console.error(`Choose exactly one supported --agent.\n\n${HELP}`);
    return 2;
  }
  console.log(buildInstructionRequest(agent));
  return 0;
}
