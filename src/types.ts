export type ConfidenceScore = 1 | 2 | 3;
export type Authorship = "ai" | "human" | "mixed" | "unknown";

export interface BaseEvent {
  id: string;
  ts: string;
  repo: string;
  branch: string;
}

export interface IntentEvent extends BaseEvent {
  kind: "intent";
  prompt: string;
  rationale?: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  hunks: number;
}

export interface DiffEvent extends BaseEvent {
  kind: "diff";
  commitSha?: string;
  files: DiffFile[];
  authorship: Authorship;
  model?: string;
  intentId?: string;
  fingerprint?: string;
  baseTree?: string;
  resultTree?: string;
}

export interface ConfidenceEvent extends BaseEvent {
  kind: "confidence";
  diffId: string;
  score: ConfidenceScore | null;
}

export interface ExplanationEvent extends BaseEvent {
  kind: "explanation";
  diffId: string;
  text: string;
  durationMs: number;
}

export interface OwnershipAnswer {
  questionId: string;
  question: string;
  answer: string;
  path?: string;
  kind: "trace" | "challenge" | "evidence" | "debug";
}

export interface OwnershipEvidenceEvent extends BaseEvent {
  kind: "ownership-evidence";
  diffId: string;
  answers: OwnershipAnswer[];
  completedCount: number;
  requiredCount: number;
}

export interface ProofEvent extends BaseEvent {
  kind: "proof";
  diffId: string;
  runner: "maven" | "gradle" | "npm" | "pnpm" | "yarn";
  command: string;
  status: "proven" | "regressed" | "inconclusive";
  exitCode: number | null;
  durationMs: number;
  output: string;
  coveredNodeIds: string[];
}

export interface SessionCompleteEvent extends BaseEvent {
  kind: "session-complete";
  diffId: string;
  score: ConfidenceScore;
  durationMs: number;
  evidenceCount: number;
  hasExplanation: boolean;
}

export interface ProbeEvent extends BaseEvent {
  kind: "probe";
  diffId: string;
  probeId: string;
  label: string;
  status: "proven" | "disproven" | "inconclusive";
  command: string;
  durationMs: number;
  exitCode: number | null;
  output: string;
  generatedPath: string;
  sourceHash: string;
  targetNodeIds: string[];
}

export interface ReviewEvent extends BaseEvent {
  kind: "review";
  diffId: string;
  newScore: ConfidenceScore;
  note?: string;
}

export interface BypassEvent extends BaseEvent {
  kind: "bypass";
  reason: "no-verify" | "unknown";
}

export interface QueueDispositionEvent extends BaseEvent {
  kind: "queue-disposition";
  diffId: string;
  action: "skip";
}

export type LedgerEvent =
  | IntentEvent
  | DiffEvent
  | ConfidenceEvent
  | ExplanationEvent
  | OwnershipEvidenceEvent
  | ProofEvent
  | SessionCompleteEvent
  | ProbeEvent
  | ReviewEvent
  | QueueDispositionEvent
  | BypassEvent;

export interface GateConfig {
  enabled: boolean;
  trigger: "all" | "ai" | "line-threshold" | "low-confidence";
  lineThreshold: number;
  confidenceThreshold: ConfidenceScore;
}

export interface ApertaConfig {
  version: 1;
  adapter: "git-only" | "opencode";
  ratingTimeoutSeconds: number;
  confidenceHalfLifeDays: number;
  gate: GateConfig;
  review: {
    ignorePatterns: string[];
  };
}

export interface HarnessEvent {
  kind: string;
  [key: string]: unknown;
}

export type Unsubscribe = () => void;

export interface HarnessAdapter {
  name: string;
  detect(): Promise<boolean>;
  install(config: GateConfig): Promise<void>;
  uninstall(): Promise<void>;
  subscribe?(handler: (event: HarnessEvent) => void): Unsubscribe;
}
