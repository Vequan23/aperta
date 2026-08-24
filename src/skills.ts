export type AgentToolId =
  | "repository.list"
  | "repository.read"
  | "repository.search"
  | "repository.write"
  | "checks.run"
  | "service.start"
  | "http.local";

export interface AgentSkillPhase {
  id: string;
  title: string;
  detail: string;
}

export interface AgentSkillProofRequirement {
  id: string;
  text: string;
  method: "checks" | "diff" | "human";
}

export interface AgentSkillContract {
  id: string;
  version: number;
  label: string;
  description: string;
  mode: "analyze" | "change" | "diagnose" | "verify" | "observe";
  allowedTools: AgentToolId[];
  phases: AgentSkillPhase[];
  proof: AgentSkillProofRequirement[];
  learningObjectives: string[];
  reason: string;
}

type SkillDefinition = Omit<AgentSkillContract, "reason"> & { score(intent: string): number };

const readTools: AgentToolId[] = ["repository.list", "repository.read", "repository.search"];
const changeTools: AgentToolId[] = [...readTools, "repository.write", "checks.run", "service.start", "http.local"];

const definitions: SkillDefinition[] = [
  {
    id: "debug-failing-behavior", version: 1, label: "Debug failing behavior", description: "Reproduce, isolate, repair, and independently verify an observed failure.", mode: "diagnose", allowedTools: changeTools,
    phases: [
      { id: "reproduce", title: "Reproduce the failure", detail: "Use the reported or detected check to establish concrete failing evidence." },
      { id: "isolate", title: "Isolate the cause", detail: "Trace the smallest code path that explains the observed output." },
      { id: "repair", title: "Repair the cause", detail: "Make the smallest coherent correction without weakening legitimate checks." },
      { id: "verify", title: "Verify the repair", detail: "Rerun the relevant check and compare the result with the original failure." },
    ],
    proof: [
      { id: "failure-observed", text: "The original failure is grounded in recorded command or repository evidence.", method: "checks" },
      { id: "cause-repaired", text: "The patch addresses the identified cause rather than suppressing its symptom.", method: "diff" },
      { id: "repair-verified", text: "The relevant project check passes after the repair.", method: "checks" },
    ],
    learningObjectives: ["Trace the failure from its observable output to the responsible execution path.", "Explain why the repair addresses the cause and not only the symptom.", "Name the first diagnostic signal to inspect if the failure returns."],
    score: (intent) => /\b(?:failing|failure|broken|error|exception|regression|doesn'?t work|not working|fix the checks?|compiler output)\b/i.test(intent) ? 100 : 0,
  },
  {
    id: "verify-project", version: 1, label: "Verify project behavior", description: "Execute detected project checks and report observed evidence without manufacturing a patch.", mode: "verify", allowedTools: [...readTools, "checks.run", "service.start", "http.local"],
    phases: [
      { id: "detect", title: "Detect verification surface", detail: "Identify the relevant allowlisted project check or bounded runtime probe." },
      { id: "execute", title: "Execute verification", detail: "Run the requested capability through Aperta and retain complete output locally." },
      { id: "interpret", title: "Interpret evidence", detail: "Report what the result proves and what remains outside its scope." },
    ],
    proof: [{ id: "observed-result", text: "The response cites an Aperta-executed check or runtime observation.", method: "checks" }],
    learningObjectives: ["Explain what the executed check covers.", "Distinguish a passing command from proof of the requested behavior.", "Identify the next check that would reduce remaining uncertainty."],
    score: (intent) => /\b(?:run|execute|rerun|re-run|verify)\b[\s\S]{0,80}\b(?:tests?|checks?|build|lint|typecheck|type-check|health|endpoint)\b/i.test(intent) ? 90 : 0,
  },
  {
    id: "observe-runtime", version: 1, label: "Observe runtime behavior", description: "Start or inspect a bounded local runtime and distinguish live evidence from configuration inference.", mode: "observe", allowedTools: [...readTools, "checks.run", "service.start", "http.local"],
    phases: [
      { id: "orient", title: "Inspect runtime configuration", detail: "Find the configured service, command, endpoint, and expected port." },
      { id: "observe", title: "Collect live evidence", detail: "Use an Aperta-managed service or localhost probe when the request requires live status." },
      { id: "interpret", title: "Separate evidence from inference", detail: "State exactly what was observed and what is known only from repository configuration." },
    ],
    proof: [{ id: "runtime-observed", text: "A bounded local capability records the runtime result when live status is requested.", method: "checks" }],
    learningObjectives: ["Trace the runtime from configuration to its observable endpoint or port.", "Explain which conclusion is directly observed and which is inferred.", "Describe how to reproduce the observation without the agent."],
    score: (intent) => /\b(?:is|are|check|inspect|probe|start|run|try|curl|request|whether|status)\b[\s\S]{0,80}\b(?:redis|postgres|mysql|mongo(?:db)?|server|service|runtime|curl|localhost|port|endpoint|running|reachable|live|health)\b/i.test(intent) || /\b(?:redis|postgres|mysql|mongo(?:db)?|server|service|runtime|curl|localhost|port|endpoint)\b[\s\S]{0,60}\b(?:running|reachable|status|available|responding|up|request)\b/i.test(intent) ? 80 : 0,
  },
  {
    id: "implement-proven-change", version: 1, label: "Implement a proven change", description: "Inspect, plan, implement, verify, and prepare a scoped patch for human promotion.", mode: "change", allowedTools: changeTools,
    phases: [
      { id: "understand", title: "Understand the requested behavior", detail: "Inspect the relevant implementation, callers, conventions, and existing evidence." },
      { id: "plan", title: "Plan the smallest coherent change", detail: "Name the affected behavior, constraints, risks, and verification strategy." },
      { id: "implement", title: "Implement the change", detail: "Modify only the repository surfaces needed for the requested outcome." },
      { id: "verify", title: "Prove the result", detail: "Run relevant detected checks and retain the resulting evidence." },
    ],
    proof: [
      { id: "requested-outcome", text: "The isolated patch implements the requested observable outcome.", method: "diff" },
      { id: "project-checks", text: "Relevant detected project checks pass after the change.", method: "checks" },
    ],
    learningObjectives: ["Trace the changed behavior through its primary execution path.", "Explain why the implementation works and where it could fail.", "Describe one safe follow-up modification and its verification check."],
    score: (intent) => /\b(?:add|build|create|change|edit|implement|update|remove|replace|refactor|make|fix|increase|decrease|enable|disable|toggle|rename|move)\b/i.test(intent) ? 70 : 0,
  },
  {
    id: "explain-code", version: 1, label: "Explain repository behavior", description: "Ground an explanation in repository evidence without changing files.", mode: "analyze", allowedTools: readTools,
    phases: [
      { id: "orient", title: "Find the relevant surfaces", detail: "Locate the entry point, implementation, configuration, and evidence relevant to the question." },
      { id: "trace", title: "Trace the behavior", detail: "Follow control and data through the smallest grounded repository path." },
      { id: "explain", title: "Explain with boundaries", detail: "Answer clearly while separating observed code from inference and unresolved runtime behavior." },
    ],
    proof: [{ id: "grounded-explanation", text: "The explanation is grounded in inspected repository evidence and names remaining uncertainty.", method: "human" }],
    learningObjectives: ["Trace the behavior from entry point to observable outcome.", "Identify the repository evidence supporting the explanation.", "Name one uncertainty that requires executable evidence."],
    score: (intent) => /\b(?:explain|how|why|what|where|understand|walk me through|trace|show me)\b/i.test(intent) ? 60 : 0,
  },
  {
    id: "explore-repository", version: 1, label: "Explore the repository", description: "Inspect and summarize repository structure without making changes.", mode: "analyze", allowedTools: readTools,
    phases: [{ id: "inspect", title: "Inspect repository evidence", detail: "Search and read only the surfaces needed to answer the request." }, { id: "summarize", title: "Summarize with uncertainty", detail: "Return a grounded answer and clearly identify what was not verified." }],
    proof: [{ id: "grounded-answer", text: "The answer is grounded in inspected repository content.", method: "human" }],
    learningObjectives: ["Identify the repository surfaces that support the answer.", "Explain the most important relationship discovered during inspection."],
    score: () => 1,
  },
];

export function selectAgentSkill(intent: string): AgentSkillContract {
  const selected = definitions.map((skill) => ({ skill, score: skill.score(intent) })).sort((a, b) => b.score - a.score)[0].skill;
  const { score: _score, ...contract } = selected;
  return { ...contract, allowedTools: [...contract.allowedTools], phases: contract.phases.map((phase) => ({ ...phase })), proof: contract.proof.map((item) => ({ ...item })), learningObjectives: [...contract.learningObjectives], reason: `Selected deterministically from the request as ${contract.mode} work.` };
}

export function toolForAgentAction(action: Record<string, unknown>): AgentToolId | null {
  if (action.action === "list") return "repository.list";
  if (action.action === "read") return "repository.read";
  if (action.action === "search") return "repository.search";
  if (action.action === "write") return "repository.write";
  if (action.action === "service") return "service.start";
  if (action.action === "run") return action.command === "curl" ? "http.local" : "checks.run";
  return null;
}

export function assertSkillAllowsAction(skill: AgentSkillContract, action: Record<string, unknown>): void {
  const tool = toolForAgentAction(action);
  if (tool && !skill.allowedTools.includes(tool)) throw new Error(`${skill.label} does not permit ${tool}. Start a change-oriented task if repository mutation is intended.`);
}

export function skillPrompt(skill: AgentSkillContract) {
  return { id: skill.id, version: skill.version, label: skill.label, mode: skill.mode, allowedTools: skill.allowedTools, phases: skill.phases, proofRequirements: skill.proof, learningObjectives: skill.learningObjectives, instruction: "Follow this Aperta skill contract. Do not use capabilities outside allowedTools. Preserve its proof requirements if you refine the implementation plan." };
}
