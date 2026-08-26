<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Box,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Code2,
  CornerDownRight,
  Ellipsis,
  FileCode,
  FlaskConical,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  LayoutGrid,
  ListChecks,
  ListTree,
  LoaderCircle,
  LogIn,
  NotebookPen,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Server,
  Settings,
  Settings2,
  ShieldCheck,
  SquarePen,
  Sparkles,
  TriangleAlert,
  Play,
  Plus,
  X,
} from "@lucide/vue";
import { parsePatch } from "./diff.ts";
import { tokenizeLine } from "./syntax.ts";
import AgentMarkdown from "./AgentMarkdown.vue";
import RepoTreeNode, { type TreeNode } from "./RepoTreeNode.vue";

type FileRow = {
  path: string;
  score: number | null;
  aiRatio: number;
  totalLines: number;
  lowConfidenceCount: number;
  explainedLowConfidence: number;
};
type Diff = {
  id: string;
  ts: string;
  authorship: string;
  model?: string;
  files: Array<{ path: string; added: number; removed: number; hunks: number }>;
};
type QueueItem = {
  kind: string;
  priority: string;
  diffId: string;
  ts: string;
  label: string;
  score: 1 | 2 | 3 | null;
  files: Diff["files"];
  model?: string;
  skippedAt?: string;
  supersededCount?: number;
};
type LearnItem = {
  diffId: string;
  dueAt: string;
  due: boolean;
  stale: boolean;
  score: 1 | 2 | 3 | null;
  files: Diff["files"];
  label: string;
};
type GitWorkingFile = { path: string; status: string; code: string };
type GitWorkingStatus = { branch: string; staged: GitWorkingFile[]; unstaged: GitWorkingFile[]; untracked: GitWorkingFile[] };
type OwnershipQuestion = {
  id: string;
  text: string;
  path: string | null;
  kind: "trace" | "challenge" | "evidence" | "debug";
  requiredForOwned: boolean;
};
type CoachStatus = {
  enabled: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  reason?: string;
};
type CoachDebrief = {
  orientation: string;
  focus: { title: string; why: string; path: string | null };
  questions: Array<OwnershipQuestion & { rationale: string }>;
  uncertainties: string[];
  provider: string;
  model: string;
};
type Note = {
  id: string;
  ts: string;
  text: string;
  durationMs: number;
  diffId: string;
};
type Answer = {
  questionId: string;
  question: string;
  answer: string;
  path?: string;
  kind: OwnershipQuestion["kind"];
};
type EvidenceRun = {
  id: string;
  ts: string;
  answers: Answer[];
  completedCount: number;
  requiredCount: number;
};
type ChangeStory = {
  title: string;
  risk: "low" | "medium" | "high";
  changedLines: number;
  areas: string[];
  symbols: string[];
  behaviors: string[];
  provenance: string;
  testStatus: string;
  expectedMinutes: number;
};
type AnalysisEvidence = {
  level: "observed" | "inferred" | "proven";
  source: "git" | "structural" | "compiler" | "runtime";
  detail: string;
};
type AnalysisCapability = {
  id: "capture" | "structure" | "semantics" | "runtime";
  label: string;
  status: "available" | "partial" | "unavailable";
  detail: string;
};
type ImpactNode = {
  id: string;
  label: string;
  kind:
    | "file"
    | "class"
    | "method"
    | "dependency"
    | "test"
    | "config"
    | "entrypoint";
  status: "added" | "modified" | "removed" | "related";
  path?: string;
  detail?: string;
  evidence: AnalysisEvidence;
};
type ImpactEdge = {
  from: string;
  to: string;
  kind:
    | "defines"
    | "calls"
    | "depends-on"
    | "configures"
    | "covers"
    | "replaces"
    | "invalidates";
  evidence: AnalysisEvidence;
};
type ImpactGraph = {
  analyzer: string;
  languages: string[];
  capabilities: AnalysisCapability[];
  headline: string;
  narrative: string;
  risk: "low" | "medium" | "high";
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  insights: string[];
  unproven: string[];
  staleNotes: Array<{ diffId: string; text: string; paths: string[] }>;
};
type ProofRun = {
  id: string;
  ts: string;
  runner: string;
  command: string;
  status: "proven" | "regressed" | "inconclusive";
  exitCode: number | null;
  durationMs: number;
  output: string;
  coveredNodeIds: string[];
};
type ProofBrief = {
  plan: {
    available: boolean;
    runner?: string;
    command?: string;
    scope: string;
    tests: string[];
    coveredNodeIds: string[];
    proposedProbes: Array<{ id: string; label: string; reason: string }>;
  };
  history: ProofRun[];
  latest: ProofRun | null;
  verdicts: Array<{
    nodeId: string;
    verdict: "proven" | "inferred" | "unproven" | "regressed";
  }>;
};
type ProbeRun = {
  id: string;
  ts: string;
  probeId: string;
  label: string;
  status: "proven" | "disproven" | "inconclusive";
  command: string;
  durationMs: number;
  exitCode: number | null;
  output: string;
  targetNodeIds: string[];
};
type Probe = {
  id: string;
  label: string;
  hypothesis: string;
  why: string;
  language: string;
  framework: string;
  readiness: "ready" | "needs-context";
  generatedPath: string;
  source: string;
  command?: string;
  targetNodeIds: string[];
  latest: ProbeRun | null;
};
type ProbeLab = { diffId: string; probes: Probe[]; history: ProbeRun[] };
type ExecutionJob = {
  id: string;
  kind: "proof" | "probe" | "coach" | "agent";
  state: "queued" | "running" | "completed" | "failed" | "canceled";
  label: string;
  error?: string;
  result?: unknown;
};
type AgentVerificationCheck = {
  id: string;
  label: string;
  command: string;
  status: "passed" | "failed" | "timed-out";
  exitCode: number | null;
  durationMs: number;
  output: string;
};
type AgentVerificationAttempt = {
  index: number;
  ts: string;
  status: "passed" | "failed";
  checks: AgentVerificationCheck[];
};
type AgentCriterion = {
  id: string;
  text: string;
  method: "checks" | "diff" | "human";
  required: boolean;
  status: "pending" | "proven" | "supported" | "failed" | "unproven";
  evidence: string[];
};
type AgentContract = {
  goal: string;
  constraints: string[];
  steps: Array<{
    id: string;
    title: string;
    detail: string;
    status: "pending" | "active" | "complete" | "blocked";
  }>;
  criteria: AgentCriterion[];
  risks: string[];
  source: "harness" | "model" | "skill";
  status: "draft" | "active" | "ready-for-review" | "blocked" | "satisfied";
  updatedAt: string;
};
type AgentCritique = {
  status: "passed" | "warning" | "blocked";
  findings: Array<{
    severity: "info" | "warning" | "blocker";
    title: string;
    detail: string;
  }>;
  reviewedAt: string;
};
type AgentRun = {
  id: string;
  conversationId: string;
  turnIndex: number;
  intent: string;
  status:
    | "running"
    | "verifying"
    | "ready"
    | "verification-failed"
    | "no-changes"
    | "applied"
    | "failed"
    | "canceled";
  provider: string;
  model: string;
  createdAt: string;
  finishedAt?: string;
  summary?: string;
  files: Diff["files"];
  patch: string;
  actions: Array<{
    index: number;
    action: string;
    path?: string;
    detail: string;
    ts: string;
    durationMs?: number;
    status?: "success" | "error";
    errorClass?: string;
    command?: string;
    output?: string;
    evidenceStatus?: string;
  }>;
  capabilities?: Array<{
    id: string;
    kind: "project-check" | "service-probe";
    label: string;
    status: string;
    summary: string;
    command?: string;
    durationMs: number;
    privacy: "local-full-provider-status" | "local-observation";
    ts: string;
  }>;
  skill: {
    id: string;
    version: number;
    label: string;
    description: string;
    mode: "analyze" | "change" | "diagnose" | "verify" | "observe";
    allowedTools: string[];
    phases: Array<{ id: string; title: string; detail: string }>;
    proof: Array<{ id: string; text: string; method: "checks" | "diff" | "human" }>;
    learningObjectives: string[];
    reason: string;
  };
  verification: {
    status: "unavailable" | "passed" | "failed";
    plan: string[];
    baseline?: AgentVerificationAttempt;
    attempts: AgentVerificationAttempt[];
  };
  contract: AgentContract;
  critique?: AgentCritique;
  promotion: {
    status: "blocked" | "review-required" | "verified";
    allowed: boolean;
    requiresHumanReview: boolean;
    reason: string;
  };
  context?: {
    maxInputChars: number;
    estimatedMaxInputTokens: number;
    lastInputChars: number;
    estimatedLastInputTokens: number;
    maxOutputTokens: number;
    retryMaxOutputTokens: number;
  };
  evidenceGraph?: {
    generatedAt: string;
    nodes: Array<{ id: string; kind: string; label: string; detail: string; status: string; path?: string }>;
    edges: Array<{ from: string; to: string; relation: string }>;
  };
  understanding?: {
    generatedAt: string;
    changedBehavior: string;
    proof: string[];
    uncertainties: string[];
    questions: Array<{ id: "trace" | "evidence" | "debug" | "modify"; label: string; text: string }>;
    responses: Record<string, string>;
    completedAt?: string;
  };
  appliedAt?: string;
  error?: string;
};
type AgentConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  runs: AgentRun[];
};
type HarnessHealth = {
  generatedAt: string;
  privacy: string;
  summary: {
    runs: number;
    completed: number;
    firstPassRate: number | null;
    repairRate: number | null;
    promotionRate: number | null;
    keepRate: number | null;
    keptLines: number;
    sampledLines: number;
    toolReliability: number | null;
    averageProviderLatencyMs: number | null;
  };
  models: Array<{
    key: string;
    provider: string;
    model: string;
    runs: number;
    completionRate: number;
    firstPassRate: number | null;
    repairRate: number | null;
    toolReliability: number | null;
    averageProviderLatencyMs: number | null;
  }>;
  tools: Array<{
    action: string;
    calls: number;
    errors: number;
    reliability: number;
    averageLatencyMs: number | null;
  }>;
  errors: Array<{ class: string; count: number; share: number }>;
  signals: Array<{
    level: "healthy" | "warning" | "critical";
    title: string;
    detail: string;
  }>;
  recent: Array<{
    id: string;
    ts: string;
    provider: string;
    model: string;
    intent: string;
    status: string;
    firstPass: boolean;
    repaired: boolean;
    promoted: boolean;
    errors: string[];
  }>;
};
type RepositoryProofClaim = {
  id: string;
  source: "agent-run" | "captured-change";
  title: string;
  detail: string;
  ts: string;
  files: string[];
  status: "proven" | "understood" | "supported" | "stale" | "regressed" | "unproven";
  evidence: Array<{ id: string; kind: string; label: string; status: string; detail: string; ts: string }>;
  assuranceAt: string | null;
  invalidatedAt?: string;
  invalidatedBy?: string;
  invalidatedFiles: string[];
};
type RepositoryProofGraph = {
  generatedAt: string;
  claims: RepositoryProofClaim[];
  summary: { claims: number; proven: number; understood: number; supported: number; stale: number; regressed: number; unproven: number; coveredFiles: number };
};
type ObserverActivity = {
  ts: string;
  type: "started" | "branch" | "grouping" | "captured" | "error" | "stopped";
  branch?: string;
  message: string;
  files?: Diff["files"];
  diffId?: string;
  mode: "embedded" | "daemon";
};
type Project = { id: string; name: string; available: boolean };
type Session = {
  diffId: string;
  ts: string;
  files: Diff["files"];
  authorship: string;
  model?: string;
  score: 1 | 2 | 3 | null;
  notes: Note[];
  evidence: EvidenceRun[];
  completions: Array<{
    id: string;
    ts: string;
    score: number;
    durationMs: number;
    evidenceCount: number;
    hasExplanation: boolean;
  }>;
  reviewed: boolean;
  demonstrated: boolean;
  durationMs: number;
};
type OwnershipBrief = {
  diff: Diff;
  intent: string | null;
  patch: string;
  story: ChangeStory;
  impact: ImpactGraph;
  changedLines: number;
  focusFiles: Diff["files"];
  signals: string[];
  questions: OwnershipQuestion[];
  priorNotes: Note[];
  priorEvidence: EvidenceRun[];
  ratingHistory: Array<{ ts: string; score: number }>;
};
type State = {
  generatedAt: string;
  repo: string;
  branch: string;
  files: FileRow[];
  repositoryFiles: string[];
  diffs: Diff[];
  queue: QueueItem[];
  learnNext: LearnItem[];
  timeline: Array<{ ts: string; score: number; diffId: string }>;
  sessions: Session[];
  observer?: {
    state: "watching" | "grouping" | "captured" | "error";
    mode?: "embedded" | "daemon";
    branch?: string;
    error?: string;
    pending?: { changedLines: number; files: Diff["files"] };
  };
  observerActivity: ObserverActivity[];
  projectId: string;
  initialization: {
    initialized: boolean;
    repositoryIdentity: string;
    privateDirectory: string | null;
  };
  projects: Project[];
  summary: {
    averageScore: number | null;
    aiRatio: number;
    unknownFiles: number;
    reviewCount: number;
    fileCount: number;
    ownershipCoverage: number;
    learnCount: number;
  };
};

const state = ref<State | null>(null);
const error = ref("");
const initializingProject = ref(false);
const initializationError = ref("");
type DashboardView =
  | "map"
  | "queue"
  | "learn"
  | "impact"
  | "proofgraph"
  | "journal"
  | "activity"
  | "harness"
  | "git"
  | "settings"
  | "agents";
const view = ref<DashboardView>("map");
const viewHistory = ref<DashboardView[]>(["map"]);
const viewHistoryIndex = ref(0);
const replayingViewHistory = ref(false);
const canNavigateBack = computed(() => viewHistoryIndex.value > 0);
const canNavigateForward = computed(() => viewHistoryIndex.value < viewHistory.value.length - 1);
watch(view, (next) => {
  if (replayingViewHistory.value) {
    replayingViewHistory.value = false;
    return;
  }
  if (viewHistory.value[viewHistoryIndex.value] === next) return;
  viewHistory.value = [...viewHistory.value.slice(0, viewHistoryIndex.value + 1), next].slice(-50);
  viewHistoryIndex.value = viewHistory.value.length - 1;
});
const selectedPath = ref("");
type Theme = "snow" | "panther" | "plain";
const savedTheme = localStorage.getItem("aperta-theme");
const theme = ref<Theme>(
  savedTheme === "plain" || savedTheme === "snow" || savedTheme === "panther"
    ? savedTheme
    : "panther",
);
const sidebarCollapsed = ref(
  localStorage.getItem("aperta-sidebar-collapsed") === "true",
);
const navTooltip = ref<{ label: string; top: number; left: number } | null>(null);
const savedRepositoryWidth = Number(
  localStorage.getItem("aperta-repository-width"),
);
const repositoryPanelWidth = ref(
  Number.isFinite(savedRepositoryWidth) &&
    savedRepositoryWidth >= 240 &&
    savedRepositoryWidth <= 480
    ? savedRepositoryWidth
    : 320,
);
const savedAgentPanelWidth = Number(
  localStorage.getItem("aperta-agent-panel-width"),
);
const agentPanelWidth = ref(
  Number.isFinite(savedAgentPanelWidth) &&
    savedAgentPanelWidth >= 340 &&
    savedAgentPanelWidth <= 520
    ? savedAgentPanelWidth
    : 420,
);
const savedOwnershipLeftWidth = Number(
  localStorage.getItem("aperta-ownership-left-width"),
);
const ownershipLeftWidth = ref(
  Number.isFinite(savedOwnershipLeftWidth) &&
    savedOwnershipLeftWidth >= 260 &&
    savedOwnershipLeftWidth <= 520
    ? savedOwnershipLeftWidth
    : 360,
);
const savedOwnershipRightWidth = Number(
  localStorage.getItem("aperta-ownership-right-width"),
);
const ownershipRightWidth = ref(
  Number.isFinite(savedOwnershipRightWidth) &&
    savedOwnershipRightWidth >= 340 &&
    savedOwnershipRightWidth <= 620
    ? savedOwnershipRightWidth
    : 460,
);
const agentPaneOpen = ref(
  localStorage.getItem("aperta-agent-pane-open") !== "false",
);
const reviewItem = ref<QueueItem | null>(null);
const queueActionId = ref("");
const brief = ref<OwnershipBrief | null>(null);
const reviewScore = ref<1 | 2 | 3 | null>(null);
const explanation = ref("");
const reviewError = ref("");
const reviewSaving = ref(false);
const reviewStartedAt = ref(0);
const selectedReviewPath = ref("");
const diffMode = ref<"unified" | "split">("unified");
const wrapDiff = ref(false);
const completion = ref<{
  before: number | null;
  after: number;
  durationMs: number;
} | null>(null);
const journalSearch = ref("");
const answers = ref<Record<string, string>>({});
const projectId = ref(localStorage.getItem("aperta-project") ?? "");
const impact = ref<ImpactGraph | null>(null);
const impactDiffId = ref("");
const impactLoading = ref(false);
const selectedImpactNodeId = ref("");
const proof = ref<ProofBrief | null>(null);
const proofRunning = ref(false);
const proofJob = ref<ExecutionJob | null>(null);
const proofError = ref("");
const proofOutputOpen = ref(false);
const probeLab = ref<ProbeLab | null>(null);
const selectedProbeId = ref("");
const probeRunningId = ref("");
const probeJob = ref<ExecutionJob | null>(null);
const probeError = ref("");
const probeOutputOpen = ref(false);
const coachStatus = ref<CoachStatus | null>(null);
const coachDebrief = ref<CoachDebrief | null>(null);
const coachRunning = ref(false);
const coachJob = ref<ExecutionJob | null>(null);
const coachError = ref("");
type ModelProfile = {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "google" | "deepseek" | "ollama" | "openrouter" | "groq" | "openai-compatible";
  model: string;
  baseUrl: string;
  credentialSource: string;
  credentialConfigured: boolean;
  toolTransport?: "native" | "json";
  capabilities?: {
    status: "untested" | "connected" | "degraded";
    nativeTools: boolean;
    modelDiscovery: boolean;
    testedAt?: string;
    latencyMs?: number;
    detail?: string;
  };
};
type ModelRole = "builder" | "coach" | "verifier";
const modelRoles: ModelRole[] = ["builder", "coach"];
type ProviderPreset = { id: ModelProfile["provider"]; label: string; description: string; category: string; baseUrl: string };
type ProviderInspection = {
  baseUrl: string;
  testedModel: string;
  models: Array<{ id: string; name: string; nativeTools?: boolean; contextWindow?: number }>;
  capabilities: NonNullable<ModelProfile["capabilities"]>;
};
type AgentRuntimeStatus = {
  kind: "aperta" | "cursor" | "claude" | "opencode";
  model: string;
  command: string;
  available: boolean;
  version?: string;
  detail: string;
};
type ModelSettings = {
  activeCoachProfileId: string | null;
  activeProfileIds: Partial<Record<ModelRole, string>>;
  profiles: ModelProfile[];
  providers: ProviderPreset[];
  agentRuntime: AgentRuntimeStatus;
  agentRuntimes: AgentRuntimeStatus[];
  secureStorage: string;
};
const modelSettings = ref<ModelSettings | null>(null);
const activeBuilderProfile = computed(() => modelSettings.value?.profiles.find((profile) => profile.id === modelSettings.value?.activeProfileIds.builder));
const activeCoachProfile = computed(() => modelSettings.value?.profiles.find((profile) => profile.id === modelSettings.value?.activeProfileIds.coach));
const settingsError = ref("");
const settingsOpenedFromAgents = ref(false);
const providerError = ref("");
const settingsSaving = ref(false);
const testingProfileId = ref("");
const providerInspecting = ref(false);
const providerInspection = ref<ProviderInspection | null>(null);
const removingProfileId = ref("");
const profileForm = ref({
  name: "",
  provider: "openai" as ModelProfile["provider"],
  model: "",
  baseUrl: "",
  apiKey: "",
});
const agentRuntimeForm = ref<{ kind: AgentRuntimeStatus["kind"]; model: string }>({
  kind: "aperta",
  model: "",
});
const selectedProviderPreset = computed(() =>
  modelSettings.value?.providers.find(
    (provider) => provider.id === profileForm.value.provider,
  ),
);
const observerNavLabel = computed(() => {
  const status = state.value?.observer?.state === "grouping" ? "Grouping changes" : state.value?.observer?.state === "error" ? "Observer needs attention" : "Watching";
  return `${status} · ${state.value?.observer?.branch ?? state.value?.branch ?? "repository"}`;
});
const repositorySearch = ref("");
const fileSource = ref<{
  path: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
  binary: boolean;
} | null>(null);
const fileLoading = ref(false);
const fileError = ref("");
const agentRuns = ref<AgentRun[]>([]);
const agentConversations = ref<AgentConversation[]>([]);
const agentStatus = ref<CoachStatus | null>(null);
const agentRuntimeStatus = ref<AgentRuntimeStatus | null>(null);
const agentExecutionReady = computed(() => agentRuntimeStatus.value?.kind === "aperta" ? Boolean(agentStatus.value?.enabled) : Boolean(agentRuntimeStatus.value?.available));
const agentEngineSummary = computed(() => {
  const runtime = agentRuntimeStatus.value;
  if (!runtime) return "Loading execution engine…";
  if (runtime.kind === "aperta") return agentStatus.value?.enabled ? `Aperta Native · ${agentStatus.value.provider} / ${agentStatus.value.model}` : "Aperta Native · Builder model required";
  return `${agentRuntimeLabel(runtime.kind)} · ${runtime.model || "runtime default model"}`;
});
const agentIntent = ref("");
const agentRunning = ref(false);
const agentJob = ref<ExecutionJob | null>(null);
const agentError = ref("");
const agentActivityPanel = ref<HTMLElement | null>(null);
const gitStatus = ref<GitWorkingStatus | null>(null);
const gitLoading = ref(false);
const gitError = ref("");
const selectedAgentRunId = ref("");
const selectedAgentConversationId = ref("");
const startingNewAgentConversation = ref(false);
const selectedAgentPath = ref("");
const agentReviewTab = ref<"understand" | "plan" | "changes" | "checks" | "activity">("plan");
const agentApplyConfirmed = ref(false);
const agentApplying = ref(false);
const understandingResponses = ref<Record<string, string>>({});
const understandingSaving = ref(false);
const harnessHealth = ref<HarnessHealth | null>(null);
const harnessLoading = ref(false);
const harnessError = ref("");
const repositoryProofGraph = ref<RepositoryProofGraph | null>(null);
const repositoryProofLoading = ref(false);
const repositoryProofError = ref("");
const proofGraphFilter = ref<"all" | RepositoryProofClaim["status"]>("all");
const filteredRepositoryClaims = computed(() => repositoryProofGraph.value?.claims.filter((claim) => proofGraphFilter.value === "all" || claim.status === proofGraphFilter.value) ?? []);

const selectedFile = computed<FileRow | undefined>(
  () =>
    state.value?.files.find((file) => file.path === selectedPath.value) ??
    (selectedPath.value
      ? {
          path: selectedPath.value,
          score: null,
          aiRatio: 0,
          totalLines: 0,
          lowConfidenceCount: 0,
          explainedLowConfidence: 0,
        }
      : undefined),
);
const selectedDiffs = computed(() =>
  selectedFile.value
    ? (state.value?.diffs.filter((diff) =>
        diff.files.some((file) => file.path === selectedFile.value?.path),
      ) ?? [])
    : [],
);
const parsedPatch = computed(() => parsePatch(brief.value?.patch ?? ""));
const activePatch = computed(
  () =>
    parsedPatch.value.find((file) => file.path === selectedReviewPath.value) ??
    parsedPatch.value[0],
);
const activeReviewMeta = computed(() =>
  brief.value?.diff.files.find((file) => file.path === activePatch.value?.path),
);
const activePatchIndex = computed(() =>
  Math.max(
    0,
    parsedPatch.value.findIndex(
      (file) => file.path === activePatch.value?.path,
    ),
  ),
);
const journal = computed(() => {
  const needle = journalSearch.value.trim().toLowerCase();
  const rows =
    state.value?.sessions.filter(
      (session) =>
        session.reviewed || session.notes.length || session.evidence.length,
    ) ?? [];
  if (!needle) return rows;
  return rows.filter((session) =>
    `${session.notes.map((note) => note.text).join(" ")} ${session.evidence.flatMap((run) => run.answers.map((answer) => `${answer.question} ${answer.answer}`)).join(" ")} ${session.files.map((file) => file.path).join(" ")} ${session.model ?? session.authorship}`
      .toLowerCase()
      .includes(needle),
  );
});
const ownershipQuestions = computed(
  () => coachDebrief.value?.questions ?? brief.value?.questions ?? [],
);
const requiredAnswersComplete = computed(
  () =>
    ownershipQuestions.value
      .filter((question) => question.requiredForOwned)
      .filter(
        (question) => (answers.value[question.id]?.trim().length ?? 0) >= 20,
      ).length,
);
const ownershipReady = computed(
  () =>
    requiredAnswersComplete.value >= 3 && explanation.value.trim().length >= 40,
);
const sessionProgress = computed(() =>
  Math.round(
    ((requiredAnswersComplete.value +
      (explanation.value.trim().length >= 40 ? 1 : 0)) /
      4) *
      100,
  ),
);
const impactChanged = computed(
  () =>
    impact.value?.nodes
      .filter((node) => node.status !== "related" && node.kind !== "test")
      .slice(0, 18) ?? [],
);
const impactRelated = computed(
  () =>
    impact.value?.nodes
      .filter((node) => node.status === "related" && node.kind !== "test")
      .slice(0, 18) ?? [],
);
const impactTests = computed(
  () =>
    impact.value?.nodes.filter((node) => node.kind === "test").slice(0, 12) ??
    [],
);
const selectedImpactNode = computed(
  () =>
    impact.value?.nodes.find(
      (node) => node.id === selectedImpactNodeId.value,
    ) ??
    impactChanged.value[0] ??
    impactRelated.value[0] ??
    impactTests.value[0],
);
const selectedRelationships = computed(
  () =>
    impact.value?.edges
      .filter(
        (edge) =>
          edge.from === selectedImpactNode.value?.id ||
          edge.to === selectedImpactNode.value?.id,
      )
      .flatMap((edge) => {
        const node = impact.value?.nodes.find(
          (candidate) =>
            candidate.id ===
            (edge.from === selectedImpactNode.value?.id ? edge.to : edge.from),
        );
        return node ? [{ ...edge, node }] : [];
      }) ?? [],
);
const selectedProbe = computed(
  () =>
    probeLab.value?.probes.find(
      (probe) => probe.id === selectedProbeId.value,
    ) ?? null,
);
const proofVerdicts = computed(() => {
  const verdicts = new Map(
    proof.value?.verdicts.map((entry) => [entry.nodeId, entry.verdict]) ?? [],
  );
  for (const probe of probeLab.value?.probes ?? []) {
    if (probe.latest?.status === "proven")
      for (const nodeId of probe.latest.targetNodeIds)
        verdicts.set(nodeId, "proven");
    if (probe.latest?.status === "disproven")
      for (const nodeId of probe.latest.targetNodeIds)
        verdicts.set(nodeId, "regressed");
  }
  return verdicts;
});
const repositoryTree = computed<TreeNode[]>(() => {
  const root: TreeNode = {
    name: state.value?.repo ?? "repository",
    path: "",
    type: "directory",
    children: [],
    score: null,
    changed: false,
  };
  const map = new Map(
    state.value?.files.map((file) => [file.path, file]) ?? [],
  );
  const needle = repositorySearch.value.trim().toLowerCase();
  for (const path of state.value?.repositoryFiles ?? []) {
    if (needle && !path.toLowerCase().includes(needle)) continue;
    let parent = root;
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const itemPath = parts.slice(0, index + 1).join("/");
      let node = parent.children.find((item) => item.name === parts[index]);
      if (!node) {
        const file = map.get(path);
        node = {
          name: parts[index],
          path: itemPath,
          type: index === parts.length - 1 ? "file" : "directory",
          children: [],
          score: index === parts.length - 1 ? (file?.score ?? null) : null,
          changed: index === parts.length - 1 && Boolean(file),
        };
        parent.children.push(node);
      }
      parent = node;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type === "directory"
          ? -1
          : 1,
    );
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
});
const sourceLines = computed(() => fileSource.value?.content.split("\n") ?? []);
const selectedAgentConversation = computed(() =>
  startingNewAgentConversation.value
    ? null
    : (agentConversations.value.find(
        (conversation) => conversation.id === selectedAgentConversationId.value,
      ) ??
      agentConversations.value[0] ??
      null),
);
const selectedAgentRun = computed(
  () =>
    selectedAgentConversation.value?.runs.find(
      (run) => run.id === selectedAgentRunId.value,
    ) ??
    selectedAgentConversation.value?.runs.at(-1) ??
    null,
);
const agentPatch = computed(() =>
  parsePatch(selectedAgentRun.value?.patch ?? ""),
);
const selectedAgentPatch = computed(
  () =>
    agentPatch.value.find((file) => file.path === selectedAgentPath.value) ??
    agentPatch.value[0] ??
    null,
);
const selectedVerificationAttempt = computed(
  () => selectedAgentRun.value?.verification?.attempts.at(-1) ?? null,
);
const displayedCapabilities = computed(
  () =>
    impact.value?.capabilities.map((capability) => {
      if (capability.id !== "runtime") return capability;
      if (proof.value?.latest?.status === "proven")
        return {
          ...capability,
          status: "available" as const,
          detail: `Executed ${proof.value.latest.runner} evidence is attached to this capture.`,
        };
      if (proof.value?.plan.available)
        return {
          ...capability,
          status: "partial" as const,
          detail: `${proof.value.plan.runner} evidence is available on demand but has not proven this capture.`,
        };
      return capability;
    }) ?? [],
);

function band(score: number | null) {
  if (score === null) return { label: "Unknown", tone: "unknown" };
  if (score < 1.67) return { label: "Opaque", tone: "danger" };
  if (score < 2.5) return { label: "Followable", tone: "warning" };
  return { label: "Owned", tone: "good" };
}

function scoreText(score: number | null) {
  return score === null ? "n/a" : score.toFixed(1);
}
function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
function metricPercent(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}
function metricDuration(value: number | null) {
  return value === null
    ? "n/a"
    : value < 1000
      ? `${Math.round(value)}ms`
      : `${(value / 1000).toFixed(1)}s`;
}
function compactDate(ts: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(ts));
}
function compactDateTime(ts: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}
function basename(path: string) {
  return path.split("/").at(-1) ?? path;
}
function directory(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "repository root";
}
function readableIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1\u200b$2")
    .replaceAll("/", "/\u200b")
    .replaceAll(".", ".\u200b");
}
function cleanAgentResponse(value = "") {
  return value
    .replace(/\r/g, "")
    .replace(/\s*#{1,6}\s+/g, "\n\n")
    .replace(/\s+-\s+(?=(?:\*\*|[A-Z0-9]))/g, "\n• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function cleanAgentActionPath(value = "") {
  const path = value.replaceAll("\\", "/");
  if (/\/aperta-agent-[^/]+$/.test(path)) return "";
  return path.match(/\/aperta-agent-[^/]+\/(.+)$/)?.[1] ?? path;
}
function readableAgentActionFallback(action: AgentRun["actions"][number]) {
  const path = cleanAgentActionPath(action.path ?? "");
  const tool = action.action.toLowerCase();
  if (/^(?:read|view|open)$/.test(tool)) return `Inspecting ${path || "a repository file"}.`;
  if (/^(?:edit|write|patch|apply_patch)$/.test(tool)) return `Updating ${path || "repository content"}.`;
  if (/^(?:glob|grep|search|find)$/.test(tool)) return "Searching the repository.";
  return "Provider activity captured.";
}
function visibleAgentActions(actions: AgentRun["actions"]) {
  return actions.filter((action) => !["assistant", "system", "result"].includes(action.action.toLowerCase()));
}
function cleanAgentActionDetail(action: AgentRun["actions"][number]) {
  const raw = action.detail?.trim() ?? "";
  if (!raw) return "";
  if (raw.startsWith("{")) {
    try {
      const event = JSON.parse(raw) as Record<string, unknown>;
      const message = event.message && typeof event.message === "object" ? event.message as Record<string, unknown> : undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      const toolUse = content.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "tool_use") as Record<string, unknown> | undefined;
      const input = toolUse?.input && typeof toolUse.input === "object" ? toolUse.input as Record<string, unknown> : {};
      const rawPath = [input.file_path, input.path, event.file_path, event.path].find((value) => typeof value === "string") as string | undefined;
      const path = cleanAgentActionPath(rawPath ?? action.path ?? "");
      const tool = String(toolUse?.name ?? event.tool_name ?? action.action).toLowerCase();
      return readableAgentActionFallback({ ...action, action: tool, path });
    } catch {
      return readableAgentActionFallback(action);
    }
  }
  return cleanAgentResponse(raw).replace(/(?:\/[^\s"']+)*\/aperta-agent-[^/\s"']+\//g, "");
}
function agentHeadline(run: AgentRun) {
  if (run.status === "no-changes") return "No repository changes were needed";
  const text = cleanAgentResponse(run.summary || run.intent).replace(
    /\s+/g,
    " ",
  );
  return text.length > 150 ? `${text.slice(0, 147).trimEnd()}…` : text;
}

function agentUnderstandingHeadline(run: AgentRun) {
  const text = cleanAgentResponse(
    run.understanding?.changedBehavior || run.summary || run.intent,
  ).replace(/\s+/g, " ");
  return text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text;
}

function agentActionIcon(action: AgentRun["actions"][number]) {
  if (action.status === "error") return CircleAlert;
  if (action.action === "read") return CornerDownRight;
  if (action.action === "search") return Search;
  if (action.action === "write") return SquarePen;
  if (action.action === "run") return Play;
  if (action.action === "service") return Server;
  if (action.action === "probe") return Server;
  if (action.action === "verify" || action.action === "baseline")
    return BadgeCheck;
  if (action.action === "plan") return ListTree;
  if (action.action === "finish") return CircleCheck;
  return Circle;
}

function observerActivityIcon(entry: ObserverActivity) {
  if (entry.type === "captured") return Check;
  if (entry.type === "error") return CircleAlert;
  if (entry.type === "grouping") return Ellipsis;
  if (entry.type === "branch") return GitBranch;
  return Circle;
}

function harnessSignalIcon(signal: HarnessHealth["signals"][number]) {
  if (signal.level === "healthy") return Check;
  if (signal.level === "critical") return CircleAlert;
  return TriangleAlert;
}
function journalSummary(session: Session) {
  if (session.notes[0]?.text) return session.notes[0].text;
  const answer = session.evidence[0]?.answers.find(
    (item) => item.answer.trim().length,
  )?.answer;
  if (answer) return answer;
  return `Ownership review completed with a score of ${session.score ?? "unrated"}. No written explanation was recorded.`;
}
async function selectFile(path: string) {
  selectedPath.value = path;
  fileSource.value = null;
  fileError.value = "";
  fileLoading.value = true;
  try {
    const response = await fetch(
      `/api/file?project=${encodeURIComponent(projectId.value)}&path=${encodeURIComponent(path)}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? "Could not read repository file");
    fileSource.value = body;
  } catch (reason) {
    fileError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    fileLoading.value = false;
  }
}
function setTheme(value: Theme) {
  theme.value = value;
  localStorage.setItem("aperta-theme", value);
}
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  navTooltip.value = null;
  localStorage.setItem(
    "aperta-sidebar-collapsed",
    String(sidebarCollapsed.value),
  );
}
function showNavTooltip(event: MouseEvent | FocusEvent, label: string) {
  if (!sidebarCollapsed.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  navTooltip.value = { label, top: rect.top + rect.height / 2, left: rect.right + 10 };
}
function hideNavTooltip() {
  navTooltip.value = null;
}
function setRepositoryWidth(width: number) {
  repositoryPanelWidth.value = Math.max(240, Math.min(480, Math.round(width)));
  localStorage.setItem(
    "aperta-repository-width",
    String(repositoryPanelWidth.value),
  );
}
function resizeRepositoryBy(delta: number) {
  setRepositoryWidth(repositoryPanelWidth.value + delta);
}
function beginRepositoryResize(event: PointerEvent) {
  const startX = event.clientX;
  const startWidth = repositoryPanelWidth.value;
  const move = (next: PointerEvent) =>
    setRepositoryWidth(startWidth + next.clientX - startX);
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    document.body.classList.remove("resizing-repository");
  };
  document.body.classList.add("resizing-repository");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}
function setAgentPanelWidth(width: number) {
  agentPanelWidth.value = Math.max(340, Math.min(520, Math.round(width)));
  localStorage.setItem(
    "aperta-agent-panel-width",
    String(agentPanelWidth.value),
  );
}
function resizeAgentPanelBy(delta: number) {
  setAgentPanelWidth(agentPanelWidth.value + delta);
}
function setAgentPaneOpen(open: boolean) {
  agentPaneOpen.value = open;
  localStorage.setItem("aperta-agent-pane-open", String(open));
}
function beginAgentPanelResize(event: PointerEvent) {
  const startX = event.clientX;
  const startWidth = agentPanelWidth.value;
  const move = (next: PointerEvent) =>
    setAgentPanelWidth(startWidth - (next.clientX - startX));
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    document.body.classList.remove("resizing-agent-pane");
  };
  document.body.classList.add("resizing-agent-pane");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}
function setOwnershipPanelWidth(side: "left" | "right", width: number) {
  const bounds = side === "left" ? [260, 520] : [340, 620];
  const value = Math.max(bounds[0], Math.min(bounds[1], Math.round(width)));
  if (side === "left") ownershipLeftWidth.value = value;
  else ownershipRightWidth.value = value;
  localStorage.setItem(`aperta-ownership-${side}-width`, String(value));
}
function resizeOwnershipPanelBy(side: "left" | "right", delta: number) {
  setOwnershipPanelWidth(
    side,
    (side === "left" ? ownershipLeftWidth.value : ownershipRightWidth.value) + delta,
  );
}
function beginOwnershipPanelResize(side: "left" | "right", event: PointerEvent) {
  const startX = event.clientX;
  const startWidth = side === "left" ? ownershipLeftWidth.value : ownershipRightWidth.value;
  const move = (next: PointerEvent) => {
    const delta = next.clientX - startX;
    setOwnershipPanelWidth(side, startWidth + (side === "left" ? delta : -delta));
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    document.body.classList.remove("resizing-ownership-pane");
  };
  document.body.classList.add("resizing-ownership-pane");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}
function proofVerdict(nodeId: string) {
  return proofVerdicts.value.get(nodeId) ?? "unproven";
}
function evidenceLevel(node: ImpactNode) {
  return proofVerdict(node.id) === "proven" ? "proven" : node.evidence.level;
}

function impactNodeIcon(kind: ImpactNode["kind"]) {
  return {
    file: FileCode,
    class: Box,
    method: Code2,
    dependency: Package,
    test: FlaskConical,
    config: Settings2,
    entrypoint: LogIn,
  }[kind];
}
function evidenceDetail(node: ImpactNode) {
  return proofVerdict(node.id) === "proven"
    ? "Executed evidence is attached to this graph surface."
    : node.evidence.detail;
}

async function loadProof(diffId: string) {
  proof.value = null;
  proofError.value = "";
  proofOutputOpen.value = false;
  const response = await fetch(
    `/api/proof?diffId=${encodeURIComponent(diffId)}&project=${encodeURIComponent(projectId.value)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not build the proof plan");
  proof.value = await response.json();
}

async function loadProbes(diffId: string) {
  probeLab.value = null;
  probeError.value = "";
  probeOutputOpen.value = false;
  const response = await fetch(
    `/api/probes?diffId=${encodeURIComponent(diffId)}&project=${encodeURIComponent(projectId.value)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not generate the probe catalog");
  probeLab.value = await response.json();
  selectedProbeId.value = probeLab.value?.probes[0]?.id ?? "";
}

async function executeGeneratedProbe(probe: Probe) {
  if (probe.readiness !== "ready" || probeRunningId.value) return;
  probeRunningId.value = probe.id;
  probeError.value = "";
  try {
    const response = await fetch("/api/probes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: projectId.value,
        diffId: impactDiffId.value,
        probeId: probe.id,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Probe execution failed");
    probeJob.value = body.job;
    const completed = await waitForJob(
      body.job.id,
      (job) => (probeJob.value = job),
    );
    if (completed.state !== "completed")
      throw new Error(completed.error ?? `Probe ${completed.state}`);
    await loadProbes(impactDiffId.value);
    selectedProbeId.value = probe.id;
    probeOutputOpen.value = true;
  } catch (reason) {
    probeError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    probeRunningId.value = "";
  }
}

async function executeProof() {
  if (!impactDiffId.value || proofRunning.value) return;
  proofRunning.value = true;
  proofError.value = "";
  try {
    const response = await fetch("/api/proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: projectId.value,
        diffId: impactDiffId.value,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Proof execution failed");
    proofJob.value = body.job;
    const completed = await waitForJob(
      body.job.id,
      (job) => (proofJob.value = job),
    );
    if (completed.state !== "completed")
      throw new Error(completed.error ?? `Proof ${completed.state}`);
    await loadProof(impactDiffId.value);
    proofOutputOpen.value = proof.value?.latest?.status !== "proven";
  } catch (reason) {
    proofError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    proofRunning.value = false;
  }
}

async function waitForJob(
  id: string,
  update: (job: ExecutionJob) => void,
): Promise<ExecutionJob> {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const response = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Could not read execution job");
    const { job } = await response.json();
    update(job);
    if (!["queued", "running"].includes(job.state)) return job;
  }
}
async function cancelExecution(job: ExecutionJob | null) {
  if (!job || !["queued", "running"].includes(job.state)) return;
  await fetch(`/api/jobs?id=${encodeURIComponent(job.id)}`, {
    method: "DELETE",
  });
}

async function loadImpact(
  diffId = impactDiffId.value || state.value?.diffs.at(-1)?.id || "",
) {
  if (!diffId) {
    impact.value = null;
    return;
  }
  impactLoading.value = true;
  impactDiffId.value = diffId;
  error.value = "";
  try {
    const response = await fetch(
      `/api/impact?diffId=${encodeURIComponent(diffId)}&project=${encodeURIComponent(projectId.value)}`,
      { cache: "no-store" },
    );
    if (!response.ok)
      throw new Error("Could not map the impact of this change");
    const body = await response.json();
    impact.value = body.graph;
    selectedImpactNodeId.value = body.graph.nodes[0]?.id ?? "";
    await Promise.all([
      loadProof(diffId).catch((reason) => {
        proofError.value =
          reason instanceof Error ? reason.message : String(reason);
      }),
      loadProbes(diffId).catch((reason) => {
        probeError.value =
          reason instanceof Error ? reason.message : String(reason);
      }),
    ]);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    impactLoading.value = false;
  }
}

async function showImpact() {
  view.value = "impact";
  await loadImpact();
}

async function refreshHistoricalView(target: DashboardView) {
  if (target === "impact") await loadImpact();
  else if (target === "proofgraph") await loadRepositoryProofGraph();
  else if (target === "harness") await loadHarnessHealth();
  else if (target === "agents") await loadAgentRuns();
  else if (target === "git") await loadGitStatus();
  else if (target === "settings") await loadSettings();
}
async function navigateViewHistory(direction: -1 | 1) {
  const nextIndex = viewHistoryIndex.value + direction;
  if (nextIndex < 0 || nextIndex >= viewHistory.value.length) return;
  viewHistoryIndex.value = nextIndex;
  replayingViewHistory.value = true;
  const target = viewHistory.value[nextIndex];
  view.value = target;
  await refreshHistoricalView(target);
}

function selectReviewFile(path: string) {
  selectedReviewPath.value = path;
}
function moveReviewFile(direction: number) {
  if (!parsedPatch.value.length) return;
  const index =
    (activePatchIndex.value + direction + parsedPatch.value.length) %
    parsedPatch.value.length;
  selectedReviewPath.value = parsedPatch.value[index].path;
}
function showEvidence(question: OwnershipQuestion) {
  if (question.path) selectedReviewPath.value = question.path;
}

async function startReview(item: QueueItem) {
  if (item.kind === "pending") return;
  reviewItem.value = item;
  brief.value = null;
  reviewScore.value = null;
  explanation.value = "";
  answers.value = {};
  reviewError.value = "";
  reviewStartedAt.value = Date.now();
  completion.value = null;
  selectedReviewPath.value = "";
  coachDebrief.value = null;
  coachError.value = "";
  coachJob.value = null;
  try {
    const response = await fetch(
      `/api/ownership?diffId=${encodeURIComponent(item.diffId)}&project=${encodeURIComponent(projectId.value)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Could not build the ownership briefing");
    brief.value = await response.json();
    fetch("/api/coach", { cache: "no-store" })
      .then((result) => result.json())
      .then((body) => (coachStatus.value = body.status))
      .catch(
        () =>
          (coachStatus.value = {
            enabled: false,
            reason: "Coach status is unavailable.",
          }),
      );
    const rawDraft = localStorage.getItem(`aperta-draft:${item.diffId}`);
    if (rawDraft) {
      try {
        const draft = JSON.parse(rawDraft);
        explanation.value = draft.explanation ?? "";
        answers.value = draft.answers ?? {};
      } catch {
        explanation.value = rawDraft;
      }
    }
    selectedReviewPath.value =
      brief.value?.focusFiles[0]?.path ??
      brief.value?.diff.files[0]?.path ??
      "";
    location.hash = `project=${encodeURIComponent(projectId.value)}&ownership=${item.diffId}`;
  } catch (reason) {
    reviewError.value =
      reason instanceof Error ? reason.message : String(reason);
  }
}

async function skipQueueItem(item: QueueItem) {
  if (item.kind === "pending" || queueActionId.value) return;
  queueActionId.value = item.diffId;
  error.value = "";
  try {
    const response = await fetch("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: projectId.value, diffId: item.diffId, action: "skip" }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not skip this review");
    await refresh();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    queueActionId.value = "";
  }
}

async function personalizeDebrief() {
  if (!reviewItem.value || coachRunning.value || !coachStatus.value?.enabled)
    return;
  coachRunning.value = true;
  coachError.value = "";
  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: projectId.value,
        diffId: reviewItem.value.diffId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? "Could not start Aperta Coach");
    coachJob.value = body.job;
    const completed = await waitForJob(
      body.job.id,
      (job) => (coachJob.value = job),
    );
    if (completed.state !== "completed")
      throw new Error(completed.error ?? `Coach ${completed.state}`);
    coachDebrief.value = completed.result as CoachDebrief;
    answers.value = {};
    if (coachDebrief.value.focus.path)
      selectedReviewPath.value = coachDebrief.value.focus.path;
  } catch (reason) {
    coachError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    coachRunning.value = false;
  }
}

function closeReview() {
  reviewItem.value = null;
  brief.value = null;
  completion.value = null;
  history.replaceState(null, "", location.pathname + location.search);
}

function openDiff(diffId: string) {
  const diff = state.value?.diffs.find((entry) => entry.id === diffId);
  const session = state.value?.sessions.find(
    (entry) => entry.diffId === diffId,
  );
  if (!diff) return;
  startReview({
    kind: "history",
    priority: "medium",
    diffId,
    ts: diff.ts,
    label: "Ownership history",
    score: session?.score ?? null,
    files: diff.files,
    model: diff.model,
  });
}

async function saveReview() {
  if (!reviewItem.value || !reviewScore.value) {
    reviewError.value = "Choose your current confidence before finishing.";
    return;
  }
  if (reviewScore.value === 3 && !ownershipReady.value) {
    reviewError.value =
      "Owned must be demonstrated: complete the three required evidence answers and your explanation.";
    return;
  }
  reviewSaving.value = true;
  reviewError.value = "";
  try {
    const evidence = ownershipQuestions.value.map((question) => ({
      questionId: question.id,
      question: question.text,
      answer: answers.value[question.id] ?? "",
      path: question.path ?? undefined,
      kind: question.kind,
    }));
    const response = await fetch("/api/ownership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: projectId.value,
        diffId: reviewItem.value.diffId,
        score: reviewScore.value,
        explanation: explanation.value,
        answers: evidence,
        durationMs: Date.now() - reviewStartedAt.value,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? "Could not save the ownership review");
    }
    completion.value = {
      before: reviewItem.value.score,
      after: reviewScore.value,
      durationMs: Date.now() - reviewStartedAt.value,
    };
    localStorage.removeItem(`aperta-draft:${reviewItem.value.diffId}`);
    await refresh();
  } catch (reason) {
    reviewError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    reviewSaving.value = false;
  }
}

async function switchProject(id: string) {
  projectId.value = id;
  localStorage.setItem("aperta-project", id);
  selectedPath.value = "";
  fileSource.value = null;
  impact.value = null;
  proof.value = null;
  probeLab.value = null;
  harnessHealth.value = null;
  repositoryProofGraph.value = null;
  impactDiffId.value = "";
  agentRuns.value = [];
  agentConversations.value = [];
  selectedAgentConversationId.value = "";
  selectedAgentRunId.value = "";
  startingNewAgentConversation.value = false;
  closeReview();
  await refresh();
  if (view.value === "impact") await loadImpact();
  if (view.value === "agents") await loadAgentRuns();
  if (view.value === "harness") await loadHarnessHealth();
  if (view.value === "proofgraph") await loadRepositoryProofGraph();
}

async function initializeProject() {
  if (!state.value || state.value.initialization.initialized || initializingProject.value) return;
  initializingProject.value = true;
  initializationError.value = "";
  try {
    const response = await fetch("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "initialize", projectId: projectId.value }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not initialize Aperta");
    await refresh();
  } catch (reason) {
    initializationError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    initializingProject.value = false;
  }
}

async function loadRepositoryProofGraph() {
  repositoryProofLoading.value = true;
  repositoryProofError.value = "";
  try {
    const response = await fetch(`/api/proof-graph?project=${encodeURIComponent(projectId.value)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load the repository proof graph");
    repositoryProofGraph.value = body;
  } catch (reason) {
    repositoryProofError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    repositoryProofLoading.value = false;
  }
}
async function showRepositoryProofGraph() {
  view.value = "proofgraph";
  await loadRepositoryProofGraph();
}

async function loadHarnessHealth() {
  harnessLoading.value = true;
  harnessError.value = "";
  try {
    const response = await fetch(
      `/api/harness?project=${encodeURIComponent(projectId.value)}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? "Could not load agent reliability");
    harnessHealth.value = body;
  } catch (reason) {
    harnessError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    harnessLoading.value = false;
  }
}
async function showHarnessHealth() {
  view.value = "harness";
  await loadHarnessHealth();
}

async function loadSettings() {
  settingsError.value = "";
  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load settings");
    modelSettings.value = body;
    agentRuntimeForm.value = {
      kind: ["cursor", "claude", "opencode"].includes(body.agentRuntime?.kind) ? body.agentRuntime.kind : "aperta",
      model: typeof body.agentRuntime?.model === "string" ? body.agentRuntime.model : "",
    };
  } catch (reason) {
    settingsError.value =
      reason instanceof Error ? reason.message : String(reason);
  }
}
async function showSettings() {
  settingsOpenedFromAgents.value = false;
  view.value = "settings";
  await loadSettings();
}
async function showAgentModelSettings() {
  settingsOpenedFromAgents.value = true;
  view.value = "settings";
  await loadSettings();
  await nextTick();
  document.getElementById("agent-runtime-title")?.scrollIntoView({ block: "start" });
}
function returnToAgentWorkbench() {
  settingsOpenedFromAgents.value = false;
  view.value = "agents";
}
async function settingsAction(payload: Record<string, unknown>) {
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not save settings");
    modelSettings.value = body;
  } catch (reason) {
    settingsError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    settingsSaving.value = false;
  }
}
async function saveProfile() {
  await settingsAction({
    action: "save",
    profile: {
      ...profileForm.value,
      activate: true,
      baseUrl: providerInspection.value?.baseUrl ?? profileForm.value.baseUrl,
      toolTransport: providerInspection.value
        ? providerInspection.value.capabilities.nativeTools
          ? "native"
          : "json"
        : undefined,
      capabilities: providerInspection.value?.capabilities,
    },
  });
  if (!settingsError.value) {
    profileForm.value = {
      name: "",
      provider: profileForm.value.provider,
      model: "",
      baseUrl: "",
      apiKey: "",
    };
    providerInspection.value = null;
  }
}
async function saveAgentRuntime() {
  await settingsAction({ action: "runtime", runtime: agentRuntimeForm.value });
  if (modelSettings.value?.agentRuntime) {
    agentRuntimeForm.value = {
      kind: modelSettings.value.agentRuntime.kind,
      model: modelSettings.value.agentRuntime.model,
    };
  }
}
function agentRuntimeLabel(kind: AgentRuntimeStatus["kind"]) {
  return kind === "cursor" ? "Cursor Agent" : kind === "claude" ? "Claude Code" : kind === "opencode" ? "OpenCode" : "Aperta Native";
}
function agentRuntimeSubtitle(kind: AgentRuntimeStatus["kind"]) {
  return kind === "aperta" ? "Bounded native tool loop" : "External CLI runtime";
}
function agentRuntimeMark(kind: AgentRuntimeStatus["kind"]) {
  return kind === "cursor" ? "C" : kind === "claude" ? "A" : kind === "opencode" ? "O" : "α";
}
async function activateProfile(id: string) {
  await settingsAction({ action: "activate", id });
}
async function assignProfileRole(id: string, role: ModelRole) {
  await settingsAction({ action: "assign", id, role });
}
async function retestProfile(id: string) {
  testingProfileId.value = id;
  await settingsAction({ action: "retest", id });
  testingProfileId.value = "";
}
function chooseProvider(provider: ProviderPreset) {
  profileForm.value.provider = provider.id;
  profileForm.value.baseUrl = provider.id === "openai-compatible" ? "" : provider.baseUrl;
  profileForm.value.model = "";
  providerInspection.value = null;
  providerError.value = "";
  settingsError.value = "";
}
async function inspectProvider() {
  if (providerInspecting.value) return;
  providerInspecting.value = true;
  providerError.value = "";
  settingsError.value = "";
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "inspect", profile: profileForm.value }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not inspect provider");
    if (!Array.isArray(body.models) || !body.capabilities || typeof body.baseUrl !== "string" || typeof body.testedModel !== "string")
      throw new Error("Provider inspection returned an incomplete response. Aperta kept your settings unchanged.");
    providerInspection.value = body;
    profileForm.value.baseUrl = body.baseUrl;
    if (!profileForm.value.model && body.models?.length === 1)
      profileForm.value.model = body.models[0].id;
  } catch (reason) {
    providerError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    providerInspecting.value = false;
  }
}
async function removeProfile(id: string) {
  if (removingProfileId.value !== id) {
    removingProfileId.value = id;
    return;
  }
  await settingsAction({ action: "delete", id });
  removingProfileId.value = "";
}

async function loadAgentRuns() {
  agentError.value = "";
  try {
    const response = await fetch(
      `/api/agents?project=${encodeURIComponent(projectId.value)}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? "Could not load agent conversations");
    agentConversations.value = (body.conversations ?? []).map(
      (conversation: AgentConversation) => ({
        ...conversation,
        runs: conversation.runs.map((run) => ({
          ...run,
          verification: run.verification ?? {
            status: "unavailable",
            plan: [],
            attempts: [],
          },
        })),
      }),
    );
    agentRuns.value = agentConversations.value.flatMap(
      (conversation) => conversation.runs,
    );
    agentStatus.value = body.coach;
    agentRuntimeStatus.value = body.runtime ?? null;
    if (
      !startingNewAgentConversation.value &&
      !agentConversations.value.some(
        (conversation) => conversation.id === selectedAgentConversationId.value,
      )
    )
      selectedAgentConversationId.value = agentConversations.value[0]?.id ?? "";
    const conversation = agentConversations.value.find(
      (candidate) => candidate.id === selectedAgentConversationId.value,
    );
    if (
      conversation &&
      !conversation.runs.some((run) => run.id === selectedAgentRunId.value)
    )
      selectAgentRun(conversation.runs.at(-1)?.id ?? "");
  } catch (reason) {
    agentError.value =
      reason instanceof Error ? reason.message : String(reason);
  }
}
async function showAgents() {
  view.value = "agents";
  if (!sidebarCollapsed.value) {
    sidebarCollapsed.value = true;
    localStorage.setItem("aperta-sidebar-collapsed", "true");
  }
  await loadAgentRuns();
}
async function loadGitStatus() {
  gitLoading.value = true;
  gitError.value = "";
  try {
    const response = await fetch(`/api/git?project=${encodeURIComponent(projectId.value)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not read Git status");
    gitStatus.value = body;
  } catch (reason) {
    gitError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    gitLoading.value = false;
  }
}
async function showGit() {
  view.value = "git";
  await loadGitStatus();
}
async function startAgentRun() {
  if (!state.value?.initialization.initialized) {
    agentError.value = "Initialize Aperta for this project before starting an agent run.";
    return;
  }
  if (agentRunning.value || agentIntent.value.trim().length < 10) return;
  const submittedIntent = agentIntent.value.trim();
  let accepted = false;
  agentRunning.value = true;
  agentError.value = "";
  agentApplyConfirmed.value = false;
  agentReviewTab.value = "activity";
  try {
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "start",
        projectId: projectId.value,
        conversationId: selectedAgentConversation.value?.id,
        intent: submittedIntent,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? "Could not start agent run");
    accepted = true;
    agentIntent.value = "";
    agentJob.value = body.job;
    const completed = await waitForJob(body.job.id, (job) => {
      agentJob.value = job;
      void loadAgentRuns().then(() => {
        const live = agentRuns.value.find(
          (run) => run.status === "running" || run.status === "verifying",
        );
        if (live) {
          startingNewAgentConversation.value = false;
          selectedAgentConversationId.value = live.conversationId;
          selectedAgentRunId.value = live.id;
          selectedAgentPath.value ||= live.files[0]?.path ?? "";
        }
      });
    });
    if (completed.state !== "completed")
      throw new Error(completed.error ?? `Agent run ${completed.state}`);
    const run = completed.result as AgentRun;
    startingNewAgentConversation.value = false;
    selectedAgentConversationId.value = run.conversationId;
    selectedAgentRunId.value = run.id;
    selectedAgentPath.value = run.files[0]?.path ?? "";
    await loadAgentRuns();
    agentReviewTab.value =
      run.status === "no-changes"
        ? "changes"
        : run.files.length
          ? "changes"
          : "activity";
    await nextTick();
    agentActivityPanel.value?.scrollTo({ top: 0, behavior: "smooth" });
  } catch (reason) {
    if (!accepted && !agentIntent.value) agentIntent.value = submittedIntent;
    agentError.value =
      reason instanceof Error ? reason.message : String(reason);
    await loadAgentRuns();
  } finally {
    agentRunning.value = false;
  }
}
function selectAgentRun(id: string) {
  selectedAgentRunId.value = id;
  const run = agentRuns.value.find((candidate) => candidate.id === id);
  selectedAgentPath.value = run?.files[0]?.path ?? "";
  understandingResponses.value = { ...(run?.understanding?.responses ?? {}) };
  agentReviewTab.value = run?.status === "no-changes" ? "changes" : "activity";
  agentApplyConfirmed.value = false;
}
function selectAgentConversation(id: string) {
  startingNewAgentConversation.value = false;
  selectedAgentConversationId.value = id;
  const conversation = agentConversations.value.find(
    (candidate) => candidate.id === id,
  );
  selectAgentRun(conversation?.runs.at(-1)?.id ?? "");
}
function newAgentConversation() {
  startingNewAgentConversation.value = true;
  selectedAgentConversationId.value = "";
  selectedAgentRunId.value = "";
  selectedAgentPath.value = "";
  agentIntent.value = "";
  agentError.value = "";
  agentApplyConfirmed.value = false;
}
async function applySelectedAgentRun() {
  if (
    !selectedAgentRun.value ||
    !agentApplyConfirmed.value ||
    agentApplying.value
  )
    return;
  agentApplying.value = true;
  agentError.value = "";
  try {
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "apply",
        projectId: projectId.value,
        runId: selectedAgentRun.value.id,
        acceptUnverified: true,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not promote patch");
    agentApplyConfirmed.value = false;
    await loadAgentRuns();
    await refresh();
  } catch (reason) {
    agentError.value =
      reason instanceof Error ? reason.message : String(reason);
  } finally {
    agentApplying.value = false;
  }
}

async function saveUnderstanding() {
  if (!selectedAgentRun.value || understandingSaving.value) return;
  understandingSaving.value = true;
  agentError.value = "";
  try {
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "understanding",
        projectId: projectId.value,
        runId: selectedAgentRun.value.id,
        responses: understandingResponses.value,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? "Could not save understanding evidence");
    await loadAgentRuns();
    const refreshed = agentRuns.value.find(
      (candidate) => candidate.id === selectedAgentRunId.value,
    );
    understandingResponses.value = {
      ...(refreshed?.understanding?.responses ?? {}),
    };
  } catch (reason) {
    agentError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    understandingSaving.value = false;
  }
}

async function refresh(retried = false) {
  error.value = "";
  try {
    const query = projectId.value
      ? `?project=${encodeURIComponent(projectId.value)}`
      : "";
    const response = await fetch(`/api/state${query}`, { cache: "no-store" });
    if (!response.ok && projectId.value && !retried) {
      projectId.value = "";
      localStorage.removeItem("aperta-project");
      return refresh(true);
    }
    if (!response.ok) throw new Error("Could not read the local ledger");
    state.value = await response.json();
    projectId.value = state.value?.projectId ?? "";
    if (projectId.value)
      localStorage.setItem("aperta-project", projectId.value);
    if (!selectedPath.value && state.value?.repositoryFiles.length)
      await selectFile(state.value.repositoryFiles[0]);
    if (view.value === "git") await loadGitStatus();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

let refreshTimer: ReturnType<typeof setInterval> | undefined;
watch(
  [explanation, answers],
  () => {
    if (reviewItem.value && !completion.value)
      localStorage.setItem(
        `aperta-draft:${reviewItem.value.diffId}`,
        JSON.stringify({
          explanation: explanation.value,
          answers: answers.value,
        }),
      );
  },
  { deep: true },
);
onMounted(async () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("project")) projectId.value = hash.get("project") ?? "";
  await refresh();
  const diffId = hash.get("ownership");
  if (diffId) openDiff(diffId);
  refreshTimer = setInterval(() => {
    if (!reviewItem.value) refresh();
  }, 3000);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <main class="desktop" :class="`theme-${theme}`">
    <section class="window" aria-label="Aperta code ownership dashboard">
      <header class="titlebar">
        <div class="traffic" aria-hidden="true">
          <i class="close"></i><i class="minimize"></i><i class="zoom"></i>
        </div>
        <div class="window-title">
          <span class="aperta-mark">a</span><strong>aperta</strong
          ><span>Code ownership</span>
        </div>
        <button
          class="refresh-button"
          type="button"
          @click="refresh"
          aria-label="Refresh ledger"
        >
          <RefreshCw class="nav-icon" aria-hidden="true" />
        </button>
      </header>

      <div class="toolbar">
        <div class="history-controls" role="group" aria-label="View history">
          <button type="button" :disabled="!canNavigateBack" aria-label="Go back" title="Go back" @click="navigateViewHistory(-1)">
            <ArrowLeft class="nav-icon" aria-hidden="true" />
          </button>
          <button type="button" :disabled="!canNavigateForward" aria-label="Go forward" title="Go forward" @click="navigateViewHistory(1)">
            <ArrowRight class="nav-icon" aria-hidden="true" />
          </button>
        </div>
        <label class="repo-pill project-picker"
          ><span class="branch-dot"></span
          ><select
            :value="projectId"
            aria-label="Tracked project"
            @change="switchProject(($event.target as HTMLSelectElement).value)"
          >
            <option v-if="!state" value="">Loading</option>
            <option
              v-for="project in state?.projects ?? []"
              :key="project.id"
              :value="project.id"
              :disabled="!project.available"
            >
              {{ project.name }}{{ project.available ? "" : " (unavailable)" }}
            </option></select
          ><span>/</span><strong>{{ state?.branch ?? "No branch" }}</strong></label
        >
        <div class="theme-switch" aria-label="Appearance">
          <button
            :class="{ active: theme === 'snow' }"
            @click="setTheme('snow')"
          >
            Aqua
          </button>
          <button
            :class="{ active: theme === 'panther' }"
            @click="setTheme('panther')"
          >
            Panther
          </button>
          <button
            :class="{ active: theme === 'plain' }"
            @click="setTheme('plain')"
          >
            Plain
          </button>
        </div>
      </div>

      <div v-if="error" class="error-panel">{{ error }}</div>
      <div v-else-if="!state" class="loading-panel">
        <div class="spinner"></div>
        Reading project evidence…
      </div>

      <section
        v-if="state && !error && !state.initialization.initialized"
        class="initialization-banner"
        role="status"
        aria-live="polite"
      >
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Set up Aperta for {{ state.repo }}</strong>
          <span>You can browse the repository now. Set up the project to run agents, capture changes, review code, and save what you learn.</span>
          <code>aperta init</code>
          <small v-if="initializationError">{{ initializationError }}</small>
        </div>
        <button type="button" :disabled="initializingProject" @click="initializeProject">
          {{ initializingProject ? "Setting up…" : "Set up Aperta" }}
        </button>
      </section>

      <div
        v-if="state && !error"
        :class="['workspace', { 'sidebar-collapsed': sidebarCollapsed }]"
      >
        <aside class="sidebar" aria-label="Primary navigation">
          <header class="sidebar-head">
            <strong><span>α</span><em>Aperta</em></strong
            ><button
              @click="toggleSidebar"
              :aria-label="
                sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'
              "
              :title="
                sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'
              "
            >
              <PanelLeftOpen
                v-if="sidebarCollapsed"
                class="nav-icon"
                aria-hidden="true"
              />
              <PanelLeftClose v-else class="nav-icon" aria-hidden="true" />
            </button>
          </header>
          <nav class="sidebar-nav">
            <p class="source-label">WORK</p>
            <button
              :class="[
                'source-item primary-action',
                { selected: view === 'agents' },
              ]"
              :aria-current="view === 'agents' ? 'page' : undefined"
              title="Agent Work"
              @mouseenter="showNavTooltip($event, 'Agent Work')"
              @focus="showNavTooltip($event, 'Agent Work')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="showAgents"
            >
              <Sparkles class="nav-icon" aria-hidden="true" />
              <span class="item-label">Agent Work</span
              ><b
                v-if="agentRuns.filter((run) => run.status === 'ready').length"
                >{{
                  agentRuns.filter((run) => run.status === "ready").length
                }}</b
              >
            </button>

            <button
              :class="['source-item', { selected: view === 'git' }]"
              :aria-current="view === 'git' ? 'page' : undefined"
              title="Git Changes"
              @mouseenter="showNavTooltip($event, 'Git Changes')"
              @focus="showNavTooltip($event, 'Git Changes')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="showGit"
            >
              <GitCommitHorizontal class="nav-icon" aria-hidden="true" />
              <span class="item-label">Git Changes</span
              ><b v-if="gitStatus">{{ gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length }}</b>
            </button>

            <p class="source-label secondary">REVIEW</p>
            <button
              :class="['source-item', { selected: view === 'map' }]"
              :aria-current="view === 'map' ? 'page' : undefined"
              title="Repository"
              @mouseenter="showNavTooltip($event, 'Repository')"
              @focus="showNavTooltip($event, 'Repository')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="view = 'map'"
            >
              <LayoutGrid class="nav-icon" aria-hidden="true" />
              <span class="item-label">Repository</span
              ><b>{{ state.repositoryFiles.length }}</b>
            </button>
            <button
              :class="['source-item', { selected: view === 'queue' }]"
              :aria-current="view === 'queue' ? 'page' : undefined"
              title="Changes to Review"
              @mouseenter="showNavTooltip($event, 'Changes to Review')"
              @focus="showNavTooltip($event, 'Changes to Review')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="view = 'queue'"
            >
              <ListChecks class="nav-icon" aria-hidden="true" />
              <span class="item-label">Changes to Review</span
              ><b v-if="state.summary.reviewCount" class="alert-count">{{
                state.summary.reviewCount
              }}</b>
            </button>
            <button
              :class="['source-item', { selected: view === 'learn' }]"
              :aria-current="view === 'learn' ? 'page' : undefined"
              title="Review Again"
              @mouseenter="showNavTooltip($event, 'Review Again')"
              @focus="showNavTooltip($event, 'Review Again')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="view = 'learn'"
            >
              <RefreshCw class="nav-icon" aria-hidden="true" />
              <span class="item-label">Review Again</span
              ><b v-if="state.summary.learnCount" class="attention-count">{{
                state.summary.learnCount
              }}</b>
            </button>

            <p class="source-label secondary">EVIDENCE</p>
            <button
              :class="['source-item', { selected: view === 'impact' }]"
              :aria-current="view === 'impact' ? 'page' : undefined"
              title="Change Impact"
              @mouseenter="showNavTooltip($event, 'Change Impact')"
              @focus="showNavTooltip($event, 'Change Impact')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="showImpact"
            >
              <GitFork class="nav-icon" aria-hidden="true" />
              <span class="item-label">Change Impact</span>
            </button>
            <button
              :class="['source-item', { selected: view === 'proofgraph' }]"
              :aria-current="view === 'proofgraph' ? 'page' : undefined"
              title="Proof Graph"
              @mouseenter="showNavTooltip($event, 'Proof Graph')"
              @focus="showNavTooltip($event, 'Proof Graph')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="showRepositoryProofGraph"
            >
              <BadgeCheck class="nav-icon" aria-hidden="true" />
              <span class="item-label">Proof Graph</span
              ><b v-if="repositoryProofGraph?.summary.stale" class="attention-count">{{ repositoryProofGraph.summary.stale }}</b>
            </button>
            <button
              :class="['source-item', { selected: view === 'journal' }]"
              :aria-current="view === 'journal' ? 'page' : undefined"
              title="Review Notes"
              @mouseenter="showNavTooltip($event, 'Review Notes')"
              @focus="showNavTooltip($event, 'Review Notes')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="view = 'journal'"
            >
              <NotebookPen class="nav-icon" aria-hidden="true" />
              <span class="item-label">Review Notes</span>
            </button>
            <button
              :class="['source-item', { selected: view === 'activity' }]"
              :aria-current="view === 'activity' ? 'page' : undefined"
              title="Change History"
              @mouseenter="showNavTooltip($event, 'Change History')"
              @focus="showNavTooltip($event, 'Change History')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="view = 'activity'"
            >
              <Activity class="nav-icon" aria-hidden="true" />
              <span class="item-label">Change History</span>
            </button>
            <button
              :class="['source-item', { selected: view === 'harness' }]"
              :aria-current="view === 'harness' ? 'page' : undefined"
              title="Agent Reliability"
              @mouseenter="showNavTooltip($event, 'Agent Reliability')"
              @focus="showNavTooltip($event, 'Agent Reliability')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="showHarnessHealth"
            >
              <Gauge class="nav-icon" aria-hidden="true" />
              <span class="item-label">Agent Reliability</span
              ><b
                v-if="
                  harnessHealth?.signals.some(
                    (signal) => signal.level !== 'healthy',
                  )
                "
                class="attention-count"
                >{{
                  harnessHealth.signals.filter(
                    (signal) => signal.level !== "healthy",
                  ).length
                }}</b
              >
            </button>
          </nav>

          <div class="sidebar-context">
            <div
              :class="['observer-card', state.observer?.state]"
              :title="observerNavLabel"
              :aria-label="observerNavLabel"
              tabindex="0"
              @mouseenter="showNavTooltip($event, observerNavLabel)"
              @focus="showNavTooltip($event, observerNavLabel)"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
            >
              <i></i>
              <div>
                <strong>{{
                  state.observer?.state === "grouping"
                    ? "Grouping changes"
                    : state.observer?.state === "error"
                      ? "Needs attention"
                      : "Watching"
                }}</strong
                ><span>{{ state.observer?.branch ?? state.branch }}</span>
              </div>
            </div>
            <button
              :class="[
                'source-item settings-link',
                { selected: view === 'settings' },
              ]"
              :aria-current="view === 'settings' ? 'page' : undefined"
              title="Settings"
              @mouseenter="showNavTooltip($event, 'Settings')"
              @focus="showNavTooltip($event, 'Settings')"
              @mouseleave="hideNavTooltip"
              @blur="hideNavTooltip"
              @click="showSettings"
            >
              <Settings class="nav-icon" aria-hidden="true" />
              <span class="item-label">Settings</span>
            </button>
          </div>
        </aside>
        <div
          v-if="navTooltip"
          class="collapsed-nav-tooltip"
          role="tooltip"
          :style="{ top: `${navTooltip.top}px`, left: `${navTooltip.left}px` }"
        >{{ navTooltip.label }}</div>

        <section :class="['content', { 'agent-content': view === 'agents' }]">
          <template v-if="view === 'map'">
            <div class="section-head">
              <div>
                <h2>Explore your code</h2>
                <p>
                  Browse the repository. Changed files show their source and
                  review status.
                </p>
              </div>
              <div class="legend">
                <span><i class="danger"></i>Needs review</span
                ><span><i class="warning"></i>Can trace</span
                ><span><i class="good"></i>Owned</span
                ><span><i class="unknown"></i>Not reviewed</span>
              </div>
            </div>
            <div
              class="repository-explorer"
              :style="{
                '--repository-tree-width': `${repositoryPanelWidth}px`,
              }"
            >
              <aside class="repository-tree" aria-label="Repository tree">
                <header>
                  <label
                    ><span>⌕</span
                    ><input
                      v-model="repositorySearch"
                      type="search"
                      placeholder="Filter files…"
                      aria-label="Filter repository files" /></label
                  ><small
                    >{{ state.repositoryFiles.length }} Git-visible files</small
                  >
                </header>
                <ul>
                  <RepoTreeNode
                    v-for="node in repositoryTree"
                    :key="node.path"
                    :node="node"
                    :selected-path="selectedPath"
                    @select="selectFile"
                  />
                </ul>
                <div v-if="!repositoryTree.length" class="tree-empty">
                  No files match this filter.
                </div>
              </aside>
              <button
                class="repository-resizer"
                aria-label="Resize repository tree"
                title="Drag to resize repository tree"
                @pointerdown.prevent="beginRepositoryResize"
                @keydown.left.prevent="resizeRepositoryBy(-20)"
                @keydown.right.prevent="resizeRepositoryBy(20)"
              >
                <span></span>
              </button>
              <section class="file-comprehension">
                <header v-if="selectedFile" class="file-context-bar">
                  <div class="file-context-identity">
                    <span class="large-file-icon">‹›</span>
                    <div>
                      <h3>{{ basename(selectedFile.path) }}</h3>
                      <p>{{ directory(selectedFile.path) }}</p>
                    </div>
                  </div>
                  <dl class="file-context-facts">
                    <div class="primary-fact">
                      <dt>Ownership</dt>
                      <dd>
                        <span
                          :class="[
                            'status-lozenge',
                            band(selectedFile.score).tone,
                          ]"
                          >{{ band(selectedFile.score).label }}</span
                        >
                      </dd>
                    </div>
                    <div>
                      <dt>Review score</dt>
                      <dd>
                        {{ scoreText(selectedFile.score) }} <small>of 3</small>
                      </dd>
                    </div>
                    <div>
                      <dt>AI-touched</dt>
                      <dd>{{ percent(selectedFile.aiRatio) }}</dd>
                    </div>
                    <div>
                      <dt>Changed lines</dt>
                      <dd>
                        {{ selectedFile.totalLines }} <small>lines</small>
                      </dd>
                    </div>
                  </dl>
                </header>
                <div class="file-actions" v-if="selectedFile">
                  <span
                    >{{ fileSource?.language ?? "source" }} ·
                    {{
                      fileSource
                        ? `${Math.max(1, Math.round(fileSource.size / 1024))} KB`
                        : "loading"
                    }}</span
                  >
                  <div>
                    <button
                      v-for="diff in selectedDiffs
                        .slice()
                        .reverse()
                        .slice(0, 2)"
                      :key="diff.id"
                      @click="openDiff(diff.id)"
                    >
                      Review {{ compactDate(diff.ts) }}
                    </button>
                  </div>
                </div>
                <div v-if="fileLoading" class="source-message">
                  <div class="spinner"></div>
                  Reading file…
                </div>
                <div v-else-if="fileError" class="source-message error">
                  {{ fileError }}
                </div>
                <div v-else-if="fileSource?.binary" class="source-message">
                  Binary files are tracked but not rendered.
                </div>
                <div
                  v-else-if="fileSource"
                  class="repository-source"
                  :aria-label="`Source for ${fileSource.path}`"
                >
                  <code
                    v-for="(line, lineIndex) in sourceLines"
                    :key="lineIndex"
                    ><span class="source-line-number">{{ lineIndex + 1 }}</span
                    ><span class="source-code"
                      ><span
                        v-for="(token, tokenIndex) in tokenizeLine(
                          line,
                          fileSource.path,
                        )"
                        :key="tokenIndex"
                        :class="`syntax-${token.kind}`"
                        >{{ token.text }}</span
                      ></span
                    ></code
                  >
                  <footer v-if="fileSource.truncated">
                    Preview limited to the first 1 MB.
                  </footer>
                </div>
                <div v-else class="source-message">
                  Choose a file to read its source and review history.
                </div>
              </section>
            </div>
          </template>

          <template v-else-if="view === 'queue'">
            <div class="section-head">
              <div>
                <h2>Changes to review</h2>
                <p>
                  Review the latest version of each changed file. Aperta groups
                  overlapping captures for you.
                </p>
              </div>
              <span class="count-badge">{{ state.queue.length }} waiting</span>
            </div>
            <div class="queue-list">
              <article
                v-for="item in state.queue"
                :key="item.diffId"
                :class="['queue-card', { pending: item.kind === 'pending' }]"
              >
                <span :class="['priority-light', item.priority]"></span>
                <div>
                  <p>{{ item.label }}</p>
                  <h3>
                    {{
                      item.files
                        .map((file) => basename(file.path))
                        .slice(0, 3)
                        .join(", ")
                    }}
                  </h3>
                  <small
                    >{{ item.files.length }} file{{
                      item.files.length === 1 ? "" : "s"
                    }}
                    · {{ item.model ?? "unattributed" }} ·
                    <time
                      :datetime="item.ts"
                      :title="new Date(item.ts).toLocaleString()"
                      >{{ compactDateTime(item.ts) }}</time
                    ></small
                  >
                  <small v-if="item.supersededCount" class="queue-superseded">
                    Includes {{ item.supersededCount }} earlier overlapping
                    capture{{ item.supersededCount === 1 ? "" : "s" }}.
                  </small>
                  <small v-if="item.skippedAt" class="queue-skipped">
                    Skipped for now · returns after current reviews
                  </small>
                </div>
                <div class="queue-actions">
                  <button
                    :disabled="item.kind === 'pending' || queueActionId === item.diffId"
                    @click="startReview(item)"
                  >
                    {{
                      item.kind === "pending"
                        ? "Waiting for quiet…"
                        : "Review change"
                    }}
                  </button>
                  <button
                    v-if="item.kind !== 'pending'"
                    class="secondary"
                    :disabled="Boolean(queueActionId) || Boolean(item.skippedAt)"
                    @click="skipQueueItem(item)"
                  >
                    {{ item.skippedAt ? "Skipped" : queueActionId === item.diffId ? "Skipping…" : "Skip for now" }}
                  </button>
                </div>
              </article>
              <div v-if="!state.queue.length" class="empty-state">
                <strong>Nothing needs review.</strong
                ><span
                  >New staged or unstaged changes will appear here
                  automatically.</span
                >
              </div>
            </div>
          </template>

          <template v-else-if="view === 'learn'">
            <div class="section-head">
              <div>
                <h2>Review again</h2>
                <p>
                  Revisit what you learned after time passes or when the code
                  changes again.
                </p>
              </div>
              <span class="count-badge"
                >{{ state.summary.learnCount }} due</span
              >
            </div>
            <div class="queue-list learn-list">
              <article
                v-for="item in state.learnNext"
                :key="item.diffId"
                :class="[
                  'queue-card',
                  { upcoming: !item.due, stale: item.stale },
                ]"
              >
                <span
                  :class="[
                    'priority-light',
                    item.stale ? 'high' : item.due ? 'medium' : 'low',
                  ]"
                ></span>
                <div>
                  <p>{{ item.label }}</p>
                  <h3>
                    {{
                      item.files
                        .map((file) => basename(file.path))
                        .slice(0, 3)
                        .join(", ")
                    }}
                  </h3>
                  <small
                    >{{
                      item.stale
                        ? "A later change made this review stale"
                        : item.due
                          ? "Ready to review again"
                          : `Scheduled ${new Date(item.dueAt).toLocaleDateString()}`
                    }}
                    · last confidence {{ item.score ?? "unrated" }}/3</small
                  >
                </div>
                <button :disabled="!item.due" @click="openDiff(item.diffId)">
                  {{ item.due ? "Review again" : "Not due yet" }}
                </button>
              </article>
              <div v-if="!state.learnNext.length" class="empty-state">
                <strong>Complete your first review.</strong
                ><span
                  >Aperta will bring it back when it is time to check what you
                  remember.</span
                >
              </div>
            </div>
          </template>

          <template v-else-if="view === 'impact'">
            <div class="section-head impact-head">
              <div>
                <h2>What this change affects</h2>
                <p>
                  Follow the change through related code, tests, and missing
                  evidence.
                </p>
              </div>
              <label
                ><span>CAPTURE</span
                ><select
                  v-model="impactDiffId"
                  @change="loadImpact(impactDiffId)"
                >
                  <option
                    v-for="diff in state.diffs.slice().reverse()"
                    :key="diff.id"
                    :value="diff.id"
                  >
                    {{ compactDate(diff.ts) }} ·
                    {{
                      diff.files
                        .map((file) => basename(file.path))
                        .slice(0, 2)
                        .join(", ")
                    }}
                  </option>
                </select></label
              >
            </div>
            <div v-if="impactLoading" class="impact-loading">
              <LoaderCircle class="impact-spinner" aria-hidden="true" />
              Finding related code and tests…
            </div>
            <div v-else-if="impact" class="impact-shell">
              <header class="impact-story">
                <div>
                  <p class="eyebrow">{{ impact.analyzer }}</p>
                  <h3>{{ impact.headline }}</h3>
                  <p>{{ impact.narrative }}</p>
                </div>
                <span :class="['risk-chip', impact.risk]"
                  >{{ impact.risk }} impact</span
                >
              </header>
              <section
                class="trust-kernel"
                aria-label="Analysis capability and evidence coverage"
              >
                <header>
                  <div>
                    <p class="eyebrow">EVIDENCE QUALITY</p>
                    <h3>See what Aperta found and how certain it is.</h3>
                  </div>
                  <span>{{
                    impact.languages.join(" + ") || "Language unknown"
                  }}</span>
                </header>
                <div class="capability-grid">
                  <article
                    v-for="capability in displayedCapabilities"
                    :key="capability.id"
                    :class="capability.status"
                  >
                    <span class="capability-icon" aria-hidden="true">
                      <CircleCheck v-if="capability.status === 'available'" />
                      <CircleAlert v-else-if="capability.status === 'partial'" />
                      <CircleMinus v-else />
                    </span>
                    <div>
                      <strong>{{ capability.label }}</strong
                      ><small>{{ capability.detail }}</small>
                    </div>
                  </article>
                </div>
                <p>
                  <b>Observed</b> comes directly from Git. <b>Inferred</b> is a
                  structural lead. <b>Proven</b> requires executed evidence.
                </p>
              </section>
              <div class="impact-metrics">
                <span v-for="insight in impact.insights" :key="insight">{{
                  insight
                }}</span>
              </div>
              <section
                v-if="proof"
                :class="['proof-engine', proof.latest?.status ?? 'ready']"
              >
                <div class="proof-orb">
                  <CircleCheck v-if="proof.latest?.status === 'proven'" aria-hidden="true" />
                  <TriangleAlert v-else-if="proof.latest?.status === 'regressed'" aria-hidden="true" />
                  <Play v-else aria-hidden="true" />
                </div>
                <div class="proof-plan">
                  <p class="eyebrow">
                    PROOF ENGINE ·
                    {{ proof.latest ? proof.latest.status : "READY" }}
                  </p>
                  <h3>
                    {{
                      proof.latest?.status === "proven"
                        ? "Executed evidence supports this change."
                        : proof.latest?.status === "regressed"
                          ? "The relevant evidence is failing."
                          : "Run a check to replace an inference with evidence."
                    }}
                  </h3>
                  <p>
                    {{ proof.plan.scope
                    }}<template v-if="proof.plan.command">
                      · <code>{{ proof.plan.command }}</code></template
                    >
                  </p>
                  <small
                    >{{ proof.plan.coveredNodeIds.length }} graph surface{{
                      proof.plan.coveredNodeIds.length === 1 ? "" : "s"
                    }}
                    can receive proof ·
                    {{ proof.plan.proposedProbes.length }} missing probe{{
                      proof.plan.proposedProbes.length === 1 ? "" : "s"
                    }}</small
                  >
                </div>
                <div class="proof-actions">
                  <button
                    :disabled="!proof.plan.available || proofRunning"
                    @click="executeProof"
                  >
                    {{
                      proofRunning
                        ? `${proofJob?.state ?? "Starting"} evidence…`
                        : proof.latest
                          ? "Run proof again"
                          : "Run relevant proof"
                    }}</button
                  ><button
                    v-if="proofRunning"
                    class="cancel-job"
                    @click="cancelExecution(proofJob)"
                  >
                    Cancel job</button
                  ><button
                    v-else-if="proof.latest"
                    class="output-toggle"
                    @click="proofOutputOpen = !proofOutputOpen"
                  >
                    {{ proofOutputOpen ? "Hide" : "Inspect" }} output
                  </button>
                </div>
                <div v-if="proofError" class="proof-error">
                  {{ proofError }}
                </div>
                <div v-if="proof.latest" class="proof-result">
                  <span>{{ proof.latest.runner }}</span
                  ><strong>{{ proof.latest.status }}</strong
                  ><small
                    >{{ (proof.latest.durationMs / 1000).toFixed(1) }}s · exit
                    {{ proof.latest.exitCode ?? "unknown" }} ·
                    {{ new Date(proof.latest.ts).toLocaleString() }}</small
                  >
                </div>
                <pre
                  v-if="proofOutputOpen && proof.latest"
                  class="proof-output"
                  >{{
                    proof.latest.output ||
                    "The runner completed without console output."
                  }}</pre
                >
              </section>
              <section v-if="probeLab?.probes.length" class="probe-lab">
                <header>
                  <div>
                    <p class="eyebrow">MISSING PROOF</p>
                    <h3>Test what your current suite does not cover.</h3>
                    <p>
                      Aperta runs generated tests in a disposable copy. It does
                      not change your repository.
                    </p>
                  </div>
                  <span
                    >{{
                      probeLab.probes.filter(
                        (probe) => probe.latest?.status === "proven",
                      ).length
                    }}/{{ probeLab.probes.length }} proven</span
                  >
                </header>
                <div class="probe-grid">
                  <button
                    v-for="probe in probeLab.probes"
                    :key="probe.id"
                    :class="[
                      'probe-card',
                      probe.latest?.status ?? probe.readiness,
                      { active: selectedProbe?.id === probe.id },
                    ]"
                    @click="
                      selectedProbeId = probe.id;
                      probeOutputOpen = false;
                    "
                  >
                    <span class="probe-state">{{
                      probe.latest?.status ??
                      (probe.readiness === "ready" ? "ready" : "needs context")
                    }}</span
                    ><strong>{{ probe.label }}</strong
                    ><small>{{ probe.hypothesis }}</small
                    ><em>{{ probe.framework }}</em>
                  </button>
                </div>
                <article v-if="selectedProbe" class="probe-inspector">
                  <div class="probe-copy">
                    <span
                      :class="[
                        'probe-state',
                        selectedProbe.latest?.status ?? selectedProbe.readiness,
                      ]"
                      >{{
                        selectedProbe.latest?.status ?? selectedProbe.readiness
                      }}</span
                    >
                    <h3>{{ selectedProbe.label }}</h3>
                    <p>{{ selectedProbe.why }}</p>
                    <dl>
                      <div>
                        <dt>Isolation</dt>
                        <dd>
                          Disposable project copy · minimized environment ·
                          network not isolated
                        </dd>
                      </div>
                      <div>
                        <dt>Generated file</dt>
                        <dd>{{ selectedProbe.generatedPath }}</dd>
                      </div>
                      <div>
                        <dt>Command</dt>
                        <dd>
                          {{
                            selectedProbe.command ??
                            "Waiting for a concrete protected route"
                          }}
                        </dd>
                      </div>
                    </dl>
                    <button
                      :disabled="
                        selectedProbe.readiness !== 'ready' ||
                        Boolean(probeRunningId)
                      "
                      @click="executeGeneratedProbe(selectedProbe)"
                    >
                      {{
                        probeRunningId === selectedProbe.id
                          ? `${probeJob?.state ?? "Starting"} probe…`
                          : selectedProbe.latest
                            ? "Run probe again"
                            : "Run isolated probe"
                      }}</button
                    ><button
                      v-if="probeRunningId"
                      class="cancel-job"
                      @click="cancelExecution(probeJob)"
                    >
                      Cancel job</button
                    ><button
                      v-else-if="selectedProbe.latest"
                      class="probe-output-toggle"
                      @click="probeOutputOpen = !probeOutputOpen"
                    >
                      {{ probeOutputOpen ? "Show source" : "Show result" }}
                    </button>
                  </div>
                  <div class="probe-code">
                    <header>
                      <span>{{
                        probeOutputOpen && selectedProbe.latest
                          ? "EXECUTION RESULT"
                          : "GENERATED TEST PREVIEW"
                      }}</span
                      ><small>{{
                        probeOutputOpen && selectedProbe.latest
                          ? `${(selectedProbe.latest.durationMs / 1000).toFixed(1)}s · exit ${selectedProbe.latest.exitCode ?? "unknown"}`
                          : "Nothing written to your repository"
                      }}</small>
                    </header>
                    <pre
                      v-if="probeOutputOpen && selectedProbe.latest"
                      class="probe-console"
                      >{{
                        selectedProbe.latest.output ||
                        "The probe passed without console output."
                      }}</pre
                    >
                    <div v-else class="highlighted-source">
                      <code
                        v-for="(
                          sourceLine, lineIndex
                        ) in selectedProbe.source.split('\n')"
                        :key="lineIndex"
                        ><span class="source-line-number">{{
                          lineIndex + 1
                        }}</span
                        ><span class="source-code"
                          ><span
                            v-for="(token, tokenIndex) in tokenizeLine(
                              sourceLine,
                              selectedProbe.generatedPath,
                            )"
                            :key="tokenIndex"
                            :class="`syntax-${token.kind}`"
                            >{{ token.text }}</span
                          ></span
                        ></code
                      >
                    </div>
                  </div>
                </article>
                <div v-if="probeError" class="proof-error">
                  {{ probeError }}
                </div>
              </section>
              <div class="impact-canvas">
                <section class="impact-lane">
                  <header>
                    <span><GitCommitHorizontal aria-hidden="true" /></span>
                    <div>
                      <strong>Changed behavior</strong
                      ><small>Added, modified, or removed</small>
                    </div>
                  </header>
                  <button
                    v-for="node in impactChanged"
                    :key="node.id"
                    :class="[
                      'impact-node',
                      node.status,
                      proofVerdict(node.id),
                      { active: selectedImpactNode?.id === node.id },
                    ]"
                    @click="selectedImpactNodeId = node.id"
                  >
                    <span class="impact-node-kind">
                      <component :is="impactNodeIcon(node.kind)" aria-hidden="true" />
                      <span>{{ node.kind }}</span>
                    </span
                    ><strong>{{ node.label }}</strong
                    ><em :class="['evidence-badge', evidenceLevel(node)]">{{
                      evidenceLevel(node)
                    }}</em
                    ><small>{{ node.detail }}</small>
                  </button>
                  <div v-if="!impactChanged.length" class="lane-empty">
                    No code symbols detected
                  </div>
                </section>
                <div class="impact-arrow" aria-hidden="true"><ArrowRight /></div>
                <section class="impact-lane">
                  <header>
                    <span><GitFork aria-hidden="true" /></span>
                    <div>
                      <strong>Dependencies & callers</strong
                      ><small>Related code</small>
                    </div>
                  </header>
                  <button
                    v-for="node in impactRelated"
                    :key="node.id"
                    :class="[
                      'impact-node',
                      node.status,
                      proofVerdict(node.id),
                      { active: selectedImpactNode?.id === node.id },
                    ]"
                    @click="selectedImpactNodeId = node.id"
                  >
                    <span class="impact-node-kind">
                      <component :is="impactNodeIcon(node.kind)" aria-hidden="true" />
                      <span>{{ node.kind }}</span>
                    </span
                    ><strong>{{ node.label }}</strong
                    ><em :class="['evidence-badge', evidenceLevel(node)]">{{
                      evidenceLevel(node)
                    }}</em
                    ><small>{{ node.detail }}</small>
                  </button>
                  <div v-if="!impactRelated.length" class="lane-empty">
                    No external caller found in tracked source
                  </div>
                </section>
                <div class="impact-arrow" aria-hidden="true"><ArrowRight /></div>
                <section class="impact-lane evidence">
                  <header>
                    <span><ShieldCheck aria-hidden="true" /></span>
                    <div>
                      <strong>Proof & unknowns</strong
                      ><small>What evidence can defend</small>
                    </div>
                  </header>
                  <button
                    v-for="node in impactTests"
                    :key="node.id"
                    :class="[
                      'impact-node',
                      node.status,
                      proofVerdict(node.id),
                      { active: selectedImpactNode?.id === node.id },
                    ]"
                    @click="selectedImpactNodeId = node.id"
                  >
                    <span class="impact-node-kind">
                      <FlaskConical aria-hidden="true" /><span>test</span>
                    </span><strong>{{ node.label }}</strong
                    ><em :class="['evidence-badge', evidenceLevel(node)]">{{
                      evidenceLevel(node)
                    }}</em
                    ><small>{{ node.detail }}</small>
                  </button>
                  <article
                    v-for="item in impact.unproven"
                    :key="item"
                    class="unproven-node"
                  >
                    <span class="unproven-label"><CircleAlert aria-hidden="true" />NEEDS PROBE</span><strong>{{ item }}</strong>
                  </article>
                </section>
              </div>
              <aside v-if="selectedImpactNode" class="impact-inspector">
                <div>
                  <span :class="['node-status', selectedImpactNode.status]">{{
                    selectedImpactNode.status
                  }}</span>
                  <h3>{{ selectedImpactNode.label }}</h3>
                  <p>
                    {{ selectedImpactNode.path ?? selectedImpactNode.kind }} ·
                    {{ selectedImpactNode.detail }}
                  </p>
                  <p class="evidence-detail">
                    <b
                      >{{ evidenceLevel(selectedImpactNode) }} via
                      {{
                        evidenceLevel(selectedImpactNode) === "proven"
                          ? "runtime"
                          : selectedImpactNode.evidence.source
                      }}</b
                    >
                    · {{ evidenceDetail(selectedImpactNode) }}
                  </p>
                </div>
                <section>
                  <small>CONNECTED RELATIONSHIPS</small
                  ><button
                    v-for="relation in selectedRelationships"
                    :key="`${relation.from}-${relation.to}-${relation.kind}`"
                    @click="selectedImpactNodeId = relation.node.id"
                  >
                    <b>{{ relation.kind }}</b
                    ><span>{{ relation.node.label }}</span
                    ><em :title="relation.evidence.detail">{{
                      relation.evidence.level
                    }}</em>
                  </button>
                  <p v-if="!selectedRelationships.length">
                    No direct edge detected. This is still a change surface
                    worth verifying.
                  </p>
                </section>
              </aside>
              <div v-if="impact.staleNotes.length" class="stale-notes">
                  <strong>Your earlier review may be stale</strong>
                <p>
                  {{ impact.staleNotes.length }} saved explanation{{
                    impact.staleNotes.length === 1 ? "" : "s"
                  }}
                  mention files changed again. Re-verify before relying on them.
                </p>
              </div>
              <button class="impact-review" @click="openDiff(impactDiffId)">
                Review this change <ArrowRight aria-hidden="true" />
              </button>
            </div>
            <div v-else class="empty-state">
              <strong>No captured change to trace.</strong
              ><span
                >Make a code change and Aperta will map what it affects.</span
              >
            </div>
          </template>

          <template v-else-if="view === 'proofgraph'">
            <div class="section-head proof-graph-head">
              <div>
                <p class="eyebrow">PROJECT EVIDENCE</p>
                <h2>Proof Graph</h2>
                <p>See what changed, what proves it, who reviewed it, and which evidence is stale.</p>
              </div>
              <button :disabled="repositoryProofLoading" @click="loadRepositoryProofGraph">
                <RefreshCw class="button-icon" aria-hidden="true" />
                {{ repositoryProofLoading ? "Rebuilding…" : "Refresh graph" }}
              </button>
            </div>
            <div v-if="repositoryProofError" class="settings-error">{{ repositoryProofError }}</div>
            <div v-else-if="repositoryProofLoading && !repositoryProofGraph" class="loading-panel">
              <div class="spinner"></div>
              Connecting project evidence…
            </div>
            <div v-else-if="repositoryProofGraph" class="repository-proof-graph">
              <section class="proof-graph-summary" aria-label="Repository proof coverage">
                <article><strong>{{ repositoryProofGraph.summary.claims }}</strong><span>behavior claims</span></article>
                <article class="proven"><strong>{{ repositoryProofGraph.summary.proven }}</strong><span>executable proof</span></article>
                <article class="understood"><strong>{{ repositoryProofGraph.summary.understood }}</strong><span>reviewed by you</span></article>
                <article class="stale"><strong>{{ repositoryProofGraph.summary.stale }}</strong><span>stale evidence</span></article>
                <article><strong>{{ repositoryProofGraph.summary.coveredFiles }}</strong><span>connected files</span></article>
              </section>
              <div class="proof-graph-toolbar" role="group" aria-label="Filter proof claims">
                <button v-for="filter in ['all', 'proven', 'understood', 'supported', 'stale', 'regressed', 'unproven'] as const" :key="filter" :class="{ active: proofGraphFilter === filter }" @click="proofGraphFilter = filter">
                  {{ filter }}<span>{{ filter === 'all' ? repositoryProofGraph.summary.claims : repositoryProofGraph.summary[filter] }}</span>
                </button>
              </div>
              <section v-if="filteredRepositoryClaims.length" class="proof-claim-list">
                <article v-for="claim in filteredRepositoryClaims" :key="claim.id" :class="['proof-claim', claim.status]">
                  <header>
                    <span :class="['proof-status-dot', claim.status]" aria-hidden="true"></span>
                    <div><p class="eyebrow">{{ claim.source === 'agent-run' ? 'AGENT BEHAVIOR' : 'CAPTURED CHANGE' }}</p><h3>{{ claim.title }}</h3></div>
                    <span :class="['proof-status-chip', claim.status]">{{ claim.status }}</span>
                  </header>
                  <AgentMarkdown class="proof-claim-detail" :source="claim.detail" />
                  <div class="proof-claim-files">
                    <button v-for="path in claim.files" :key="path" type="button" @click="view = 'map'; selectFile(path)">{{ path }}</button>
                    <span v-if="!claim.files.length">Repository observation</span>
                  </div>
                  <div v-if="claim.invalidatedAt" class="proof-invalidation">
                    <TriangleAlert class="button-icon" aria-hidden="true" />
                    <div><strong>Evidence invalidated by a later change</strong><span>{{ claim.invalidatedBy }} changed {{ claim.invalidatedFiles.join(', ') }} on {{ compactDate(claim.invalidatedAt) }}.</span></div>
                  </div>
                  <details v-if="claim.evidence.length" class="proof-evidence-list">
                    <summary>{{ claim.evidence.length }} evidence record{{ claim.evidence.length === 1 ? '' : 's' }}</summary>
                    <ul><li v-for="item in claim.evidence" :key="item.id"><span :class="['evidence-kind', item.kind]">{{ item.kind }}</span><div><strong>{{ item.label }}</strong><p>{{ item.detail }}</p></div><time>{{ compactDate(item.ts) }}</time></li></ul>
                  </details>
                  <footer><span>{{ compactDate(claim.ts) }}</span><span v-if="claim.assuranceAt">Last assured {{ compactDate(claim.assuranceAt) }}</span></footer>
                </article>
              </section>
              <div v-else class="empty-state"><strong>No claims match this filter.</strong><span>Run an agent task, run a check, or review a change to add project evidence.</span></div>
            </div>
          </template>

          <template v-else-if="view === 'journal'">
            <div class="section-head journal-head">
              <div>
                <h2>Review notes</h2>
                <p>Search the explanations you saved while reviewing code.</p>
              </div>
              <input
                v-model="journalSearch"
                type="search"
                placeholder="Search notes, files, or tools…"
                aria-label="Search review notes"
              />
            </div>
            <div class="journal-list">
              <button
                v-for="session in journal"
                :key="session.diffId"
                class="journal-card"
                @click="openDiff(session.diffId)"
              >
                <div class="journal-meta">
                  <span>{{
                    compactDate(
                      session.completions?.[0]?.ts ??
                        session.evidence?.[0]?.ts ??
                        session.notes?.[0]?.ts ??
                        session.ts,
                    )
                  }}</span
                  ><strong>{{ session.model ?? session.authorship }}</strong
                  ><em :class="session.demonstrated ? 'verified' : 'claimed'">{{
                    session.demonstrated ? "Demonstrated" : "Reviewed"
                  }}</em
                  ><b :class="band(session.score).tone"
                    >{{ session.score ?? "n/a" }}/3</b
                  >
                </div>
                <blockquote>{{ journalSummary(session) }}</blockquote>
                <div class="journal-files">
                  {{
                    session.files
                      .map((file) => file.path)
                      .slice(0, 4)
                      .join(" · ")
                  }}
                </div>
                <small
                  >{{ session.notes.length }} note{{
                    session.notes.length === 1 ? "" : "s"
                  }}
                  · {{ session.evidence?.at(0)?.completedCount ?? 0 }} required
                  evidence answers ·
                  {{ Math.max(1, Math.round(session.durationMs / 60000)) }} min
                  reviewed</small
                >
              </button>
              <div v-if="!journal.length" class="empty-state">
                <strong>{{
                  journalSearch
                    ? "No sessions match."
                    : "Your journal starts after the first review."
                }}</strong
                ><span
                  >Every completed review stays here, even when you did not add
                  a note.</span
                >
              </div>
            </div>
          </template>

          <template v-else-if="view === 'git'">
            <div class="section-head git-head">
              <div>
                <p class="eyebrow">WORKING TREE</p>
                <h2>Git Changes</h2>
                <p>Live staged, unstaged, and untracked repository state on {{ gitStatus?.branch ?? state.branch }}.</p>
              </div>
              <button class="git-refresh" :disabled="gitLoading" @click="loadGitStatus">
                <RefreshCw class="action-icon" aria-hidden="true" />{{ gitLoading ? "Refreshing…" : "Refresh" }}
              </button>
            </div>
            <div v-if="gitError" class="settings-error">{{ gitError }}</div>
            <div v-else-if="gitLoading && !gitStatus" class="loading-panel"><div class="spinner"></div>Reading working tree…</div>
            <div v-else class="git-board">
              <section v-for="group in [
                { key: 'staged', title: 'Staged', copy: 'Ready for the next commit', files: gitStatus?.staged ?? [] },
                { key: 'unstaged', title: 'Unstaged', copy: 'Tracked files changed in the working tree', files: gitStatus?.unstaged ?? [] },
                { key: 'untracked', title: 'Untracked', copy: 'New files not yet added to Git', files: gitStatus?.untracked ?? [] },
              ]" :key="group.key" :class="['git-group', group.key]">
                <header><div><h3>{{ group.title }}</h3><p>{{ group.copy }}</p></div><b>{{ group.files.length }}</b></header>
                <button v-for="file in group.files" :key="`${group.key}-${file.path}`" @click="view = 'map'; selectFile(file.path)">
                  <span :class="['git-status-code', group.key]">{{ file.code }}</span>
                  <span><strong>{{ basename(file.path) }}</strong><small>{{ directory(file.path) }}</small></span>
                  <em>{{ file.status }}</em>
                </button>
                <div v-if="!group.files.length" class="git-group-empty"><CircleCheck class="action-icon" aria-hidden="true" />Nothing {{ group.key }}</div>
              </section>
            </div>
          </template>

          <template v-else-if="view === 'activity'">
            <div class="section-head">
              <div>
                <h2>Change history</h2>
                <p>
                  See what Aperta captured, when it happened, and which branch
                  changed.
                </p>
              </div>
              <span :class="['engine-badge', state.observer?.mode]">{{
                state.observer?.mode === "daemon"
                  ? "Background engine"
                  : "Dashboard fallback"
              }}</span>
            </div>
            <div class="activity-list">
              <article
                v-for="entry in state.observerActivity"
                :key="`${entry.ts}-${entry.type}`"
                :class="['activity-row', entry.type]"
              >
                <span class="activity-glyph"
                  ><component
                    :is="observerActivityIcon(entry)"
                    class="activity-glyph-icon"
                    aria-hidden="true"
                /></span>
                <div>
                  <header>
                    <strong>{{ entry.type }}</strong
                    ><span>{{ new Date(entry.ts).toLocaleString() }}</span>
                  </header>
                  <p>{{ entry.message }}</p>
                  <small
                    >{{ entry.mode }} · {{ entry.branch ?? "branch pending"
                    }}<template v-if="entry.files?.length">
                      · {{ entry.files.length }} files ·
                      {{
                        entry.files.reduce(
                          (sum, file) => sum + file.added + file.removed,
                          0,
                        )
                      }}
                      lines</template
                    ></small
                  >
                </div>
                <button v-if="entry.diffId" @click="openDiff(entry.diffId)">
                  Open capture
                </button>
              </article>
              <div v-if="!state.observerActivity.length" class="empty-state">
                <strong>No changes captured yet.</strong
                ><span
                  >Activity will appear when the engine starts or the repository
                  changes.</span
                >
              </div>
            </div>
          </template>

          <template v-else-if="view === 'harness'">
            <div class="section-head harness-head">
              <div>
                <p class="eyebrow">AGENT RELIABILITY</p>
                <h2>See where agent runs succeed or fail.</h2>
                <p>
                  Compare models, tools, checks, and repairs using local run
                  results. Prompts and evidence stay outside Git.
                </p>
              </div>
              <button :disabled="harnessLoading" @click="loadHarnessHealth">
                <RefreshCw class="button-icon" aria-hidden="true" />
                {{ harnessLoading ? "Refreshing…" : "Refresh signals" }}
              </button>
            </div>
            <div v-if="harnessError" class="settings-error">
              {{ harnessError }}
            </div>
            <div
              v-else-if="harnessLoading && !harnessHealth"
              class="loading-panel"
            >
              <div class="spinner"></div>
              Building the local reliability baseline…
            </div>
            <div v-else-if="harnessHealth" class="harness-health">
              <section
                class="harness-signals"
                aria-label="Agent regression signals"
              >
                <article
                  v-for="signal in harnessHealth.signals"
                  :key="signal.title"
                  :class="signal.level"
                >
                  <span
                    ><component
                      :is="harnessSignalIcon(signal)"
                      class="harness-signal-icon"
                      aria-hidden="true"
                  /></span>
                  <div>
                    <strong>{{ signal.title }}</strong>
                    <p>{{ signal.detail }}</p>
                  </div>
                </article>
              </section>
              <section class="harness-metrics" aria-label="Agent reliability metrics">
                <article>
                  <small>FIRST-PASS SUCCESS</small
                  ><strong>{{
                    metricPercent(harnessHealth.summary.firstPassRate)
                  }}</strong>
                  <p>Passed without repair</p>
                </article>
                <article>
                  <small>REPAIR RECOVERY</small
                  ><strong>{{
                    metricPercent(harnessHealth.summary.repairRate)
                  }}</strong>
                  <p>Failed first, then recovered</p>
                </article>
                <article>
                  <small>TOOL RELIABILITY</small
                  ><strong>{{
                    metricPercent(harnessHealth.summary.toolReliability)
                  }}</strong>
                  <p>Successful bounded actions</p>
                </article>
                <article>
                  <small>PROMOTION RATE</small
                  ><strong>{{
                    metricPercent(harnessHealth.summary.promotionRate)
                  }}</strong>
                  <p>Reviewable patches applied</p>
                </article>
                <article>
                  <small>TRUSTED KEEP RATE</small
                  ><strong>{{
                    metricPercent(harnessHealth.summary.keepRate)
                  }}</strong>
                  <p>
                    {{
                      harnessHealth.summary.sampledLines
                        ? `${harnessHealth.summary.keptLines}/${harnessHealth.summary.sampledLines} added lines remain`
                        : "Begins after promotion"
                    }}
                  </p>
                </article>
                <article>
                  <small>MODEL LATENCY</small
                  ><strong>{{
                    metricDuration(
                      harnessHealth.summary.averageProviderLatencyMs,
                    )
                  }}</strong>
                  <p>Average provider action</p>
                </article>
              </section>
              <div class="harness-grid">
                <section class="harness-panel model-performance">
                  <header>
                    <div>
                      <h3>Model performance</h3>
                      <p>
                        Compare providers and models using runs from this
                        machine.
                      </p>
                    </div>
                    <span>{{ harnessHealth.summary.runs }} runs</span>
                  </header>
                  <div
                    class="health-table"
                    role="table"
                    aria-label="Model performance"
                  >
                    <div class="health-table-head" role="row">
                      <span>Model</span><span>Complete</span
                      ><span>First pass</span><span>Repair</span
                      ><span>Tools</span><span>Latency</span>
                    </div>
                    <div
                      v-for="model in harnessHealth.models"
                      :key="model.key"
                      class="health-table-row"
                      role="row"
                    >
                      <strong
                        ><small>{{ model.provider }}</small
                        >{{ model.model }}</strong
                      ><span>{{ metricPercent(model.completionRate) }}</span
                      ><span>{{ metricPercent(model.firstPassRate) }}</span
                      ><span>{{ metricPercent(model.repairRate) }}</span
                      ><span>{{ metricPercent(model.toolReliability) }}</span
                      ><span>{{
                        metricDuration(model.averageProviderLatencyMs)
                      }}</span>
                    </div>
                    <div
                      v-if="!harnessHealth.models.length"
                      class="harness-empty"
                    >
                      Run an agent task to establish the first model baseline.
                    </div>
                  </div>
                </section>
                <section class="harness-panel tool-health">
                  <header>
                    <div>
                      <h3>Tool reliability</h3>
                      <p>
                        Errors remain attributed to the tool and model that
                        produced them.
                      </p>
                    </div>
                  </header>
                  <div
                    v-for="tool in harnessHealth.tools"
                    :key="tool.action"
                    class="tool-health-row"
                  >
                    <div>
                      <strong>{{ tool.action }}</strong
                      ><span
                        >{{ tool.calls }} calls · {{ tool.errors }} errors ·
                        {{ metricDuration(tool.averageLatencyMs) }}</span
                      >
                    </div>
                    <b>{{ metricPercent(tool.reliability) }}</b
                    ><i
                      ><span
                        :style="{ width: metricPercent(tool.reliability) }"
                      ></span
                    ></i>
                  </div>
                  <div v-if="!harnessHealth.tools.length" class="harness-empty">
                    No bounded tool actions recorded yet.
                  </div>
                </section>
                <section class="harness-panel error-taxonomy">
                  <header>
                    <div>
                      <h3>Error taxonomy</h3>
                      <p>
                        Separate expected failures from problems inside Aperta.
                      </p>
                    </div>
                  </header>
                  <div v-if="harnessHealth.errors.length" class="error-chips">
                    <article
                      v-for="item in harnessHealth.errors"
                      :key="item.class"
                      :class="{ unknown: item.class === 'HarnessBug' }"
                    >
                      <strong>{{ item.count }}</strong
                      ><span>{{ item.class }}</span
                      ><small>{{ metricPercent(item.share) }} of errors</small>
                    </article>
                  </div>
                  <div v-else class="harness-empty">
                    No errors recorded in retained runs.
                  </div>
                </section>
                <section class="harness-panel recent-health">
                  <header>
                    <div>
                      <h3>Recent runs</h3>
                      <p>
                        Fast feedback for regressions after a prompt, tool, or
                        model change.
                      </p>
                    </div>
                  </header>
                  <ol>
                    <li v-for="run in harnessHealth.recent" :key="run.id">
                      <span :class="run.status"></span>
                      <div>
                        <strong>{{ run.intent }}</strong
                        ><small
                          >{{ run.provider }} · {{ run.model }} ·
                          {{ new Date(run.ts).toLocaleString() }}</small
                        >
                      </div>
                      <div class="run-signals">
                        <em v-if="run.firstPass">first pass</em
                        ><em v-if="run.repaired">repaired</em
                        ><em v-if="run.promoted">promoted</em
                        ><em
                          v-for="errorClass in run.errors"
                          :key="errorClass"
                          class="error"
                          >{{ errorClass }}</em
                        ><b>{{ run.status }}</b>
                      </div>
                    </li>
                  </ol>
                </section>
              </div>
              <footer class="harness-privacy">
                <span
                  ><ShieldCheck class="harness-privacy-icon" aria-hidden="true"
                /></span>
                <p>
                  <strong>Local intelligence boundary</strong
                  >{{ harnessHealth.privacy }}
                </p>
                <small
                  >Updated
                  {{
                    new Date(harnessHealth.generatedAt).toLocaleTimeString()
                  }}</small
                >
              </footer>
            </div>
          </template>

          <template v-else-if="view === 'agents'">
            <div v-if="agentError" class="settings-error">{{ agentError }}</div>
            <div
              :class="['agent-ide', { 'pane-closed': !agentPaneOpen }]"
              :style="{ '--agent-pane-width': `${agentPanelWidth}px` }"
            >
              <main class="agent-ide-main">
                <header class="agent-ide-toolbar">
                  <div>
                    <p class="eyebrow">AGENT WORK</p>
                    <h2>
                      {{
                        selectedAgentConversation
                          ? selectedAgentConversation.title
                          : "Build with an agent. Keep ownership."
                      }}
                    </h2>
                  </div>
                  <div class="agent-toolbar-actions">
                    <button
                      class="workbench-settings-link"
                      type="button"
                      @click="showAgentModelSettings"
                    >
                      <Settings aria-hidden="true" />
                      Model settings
                    </button>
                    <button v-if="!agentPaneOpen" @click="setAgentPaneOpen(true)">
                      Show agent pane
                    </button>
                  </div>
                </header>
                <section v-if="selectedAgentRun" class="agent-review">
                  <header class="agent-run-summary">
                    <div>
                      <h3 v-if="selectedAgentRun.intent !== selectedAgentConversation?.title">
                        {{ selectedAgentRun.intent }}
                      </h3>
                      <p class="agent-run-engine">
                        {{ selectedAgentRun.provider }} · {{ selectedAgentRun.model }}
                      </p>
                    </div>
                    <span
                      :class="['agent-run-status', selectedAgentRun.status]"
                      >{{ selectedAgentRun.status }}</span
                    >
                  </header>
                  <div
                    class="agent-mode-tabs"
                    role="tablist"
                    aria-label="Agent run review"
                  >
                    <button
                      v-if="selectedAgentRun.status !== 'no-changes'"
                      role="tab"
                      :aria-selected="agentReviewTab === 'understand'"
                      :class="{
                        active: agentReviewTab === 'understand',
                        complete: selectedAgentRun.understanding?.completedAt,
                      }"
                      @click="agentReviewTab = 'understand'"
                    >
                      Understand
                      <b>
                        <CircleCheck v-if="selectedAgentRun.understanding?.completedAt" aria-hidden="true" />
                        <Circle v-else aria-hidden="true" />
                      </b>
                    </button><button
                      v-if="selectedAgentRun.status !== 'no-changes'"
                      role="tab"
                      :aria-selected="agentReviewTab === 'plan'"
                      :class="[
                        'plan-tab',
                        selectedAgentRun.contract.status,
                        { active: agentReviewTab === 'plan' },
                      ]"
                      @click="agentReviewTab = 'plan'"
                    >
                      Plan
                      <b
                        >{{
                          selectedAgentRun.contract.criteria.filter(
                            (item) => item.status === "proven",
                          ).length
                        }}/{{ selectedAgentRun.contract.criteria.length }}</b
                      ></button
                    ><button
                      role="tab"
                      :aria-selected="agentReviewTab === 'changes'"
                      :class="{ active: agentReviewTab === 'changes' }"
                      @click="agentReviewTab = 'changes'"
                    >
                      {{ selectedAgentRun.status === "no-changes" ? "Response" : "Changes" }}
                      <b v-if="selectedAgentRun.status !== 'no-changes'">{{ selectedAgentRun.files.length }}</b></button
                    ><button
                      v-if="selectedAgentRun.status !== 'no-changes' || selectedAgentRun.verification.baseline || selectedAgentRun.verification.attempts.length"
                      role="tab"
                      :aria-selected="agentReviewTab === 'checks'"
                      :class="[
                        'checks-tab',
                        selectedAgentRun.verification.status,
                        { active: agentReviewTab === 'checks' },
                      ]"
                      @click="agentReviewTab = 'checks'"
                    >
                      Checks
                      <b>
                        <CircleCheck v-if="selectedAgentRun.verification.status === 'passed'" aria-hidden="true" />
                        <CircleAlert v-else-if="selectedAgentRun.verification.status === 'failed'" aria-hidden="true" />
                        <CircleMinus v-else aria-hidden="true" />
                      </b></button
                    ><button
                      role="tab"
                      :aria-selected="agentReviewTab === 'activity'"
                      :class="{ active: agentReviewTab === 'activity' }"
                      @click="agentReviewTab = 'activity'"
                    >
                      Activity <b>{{ selectedAgentRun.actions.length }}</b>
                    </button>
                  </div>
                  <section
                    v-if="agentReviewTab === 'understand'"
                    class="understanding-brief"
                  >
                    <header>
                      <div>
                        <p class="eyebrow">REVIEW WHAT CHANGED</p>
                        <h3>{{ agentUnderstandingHeadline(selectedAgentRun) }}</h3>
                        <p>
                          Read the code and evidence before you accept the
                          change.
                        </p>
                      </div>
                      <span :class="{ complete: selectedAgentRun.understanding?.completedAt }">
                        {{ selectedAgentRun.understanding?.completedAt ? 'recorded' : 'open' }}
                      </span>
                    </header>
                    <div v-if="selectedAgentRun.understanding" class="understanding-grid">
                      <article>
                        <h4>What proves it</h4>
                        <ul>
                          <li
                            v-for="proof in selectedAgentRun.understanding.proof"
                            :key="proof"
                          >{{ readableIdentifier(proof) }}</li>
                        </ul>
                      </article>
                      <article>
                        <h4>What is still uncertain</h4>
                        <ul>
                          <li
                            v-for="item in selectedAgentRun.understanding.uncertainties"
                            :key="item"
                          >{{ readableIdentifier(item) }}</li>
                        </ul>
                      </article>
                      <article class="understanding-questions">
                        <div>
                          <div>
                            <h4>Explain it in your own words</h4>
                            <p>
                              Aperta saves these answers with the run for later
                              review.
                            </p>
                          </div>
                          <span>
                            {{ selectedAgentRun.evidenceGraph?.nodes.length ?? 0 }} nodes ·
                            {{ selectedAgentRun.evidenceGraph?.edges.length ?? 0 }} links
                          </span>
                        </div>
                        <label
                          v-for="question in selectedAgentRun.understanding.questions"
                          :key="question.id"
                        >
                          <span><b>{{ question.label }}</b> {{ question.text }}</span>
                          <textarea
                            v-model="understandingResponses[question.id]"
                            rows="3"
                            :placeholder="`Explain the ${question.label.toLowerCase()} from your own understanding…`"
                          ></textarea>
                        </label>
                        <button
                          class="understanding-save"
                          :disabled="understandingSaving"
                          @click="saveUnderstanding"
                        >
                          {{ understandingSaving ? 'Saving…' : 'Save review' }}
                        </button>
                      </article>
                    </div>
                  </section>
                  <section
                    v-else-if="agentReviewTab === 'plan'"
                    class="agent-contract"
                  >
                    <header :class="selectedAgentRun.promotion.status">
                      <div>
                        <p class="eyebrow">
                          RUN PLAN ·
                          {{ selectedAgentRun.contract.source }}
                        </p>
                        <h3>{{ selectedAgentRun.contract.goal }}</h3>
                        <p>{{ selectedAgentRun.promotion.reason }}</p>
                      </div>
                      <span>{{ selectedAgentRun.promotion.status }}</span>
                    </header>
                    <section class="skill-contract-banner" aria-label="Selected Aperta skill">
                      <div class="skill-contract-mark"><Sparkles class="nav-icon" aria-hidden="true" /></div>
                      <div>
                        <p class="eyebrow">APERTA SKILL · V{{ selectedAgentRun.skill.version }}</p>
                        <h4>{{ selectedAgentRun.skill.label }}</h4>
                        <p>{{ selectedAgentRun.skill.description }}</p>
                      </div>
                      <span :class="['skill-mode', selectedAgentRun.skill.mode]">{{ selectedAgentRun.skill.mode }}</span>
                      <details>
                        <summary>{{ selectedAgentRun.skill.allowedTools.length }} allowed capabilities · {{ selectedAgentRun.skill.proof.length }} proof requirements</summary>
                        <div class="skill-contract-details">
                          <section><strong>Allowed capabilities</strong><div><code v-for="tool in selectedAgentRun.skill.allowedTools" :key="tool">{{ tool }}</code></div></section>
                          <section><strong>Learning objectives</strong><ul><li v-for="objective in selectedAgentRun.skill.learningObjectives" :key="objective">{{ objective }}</li></ul></section>
                        </div>
                      </details>
                    </section>
                    <div class="contract-grid">
                      <article class="contract-plan">
                        <h4>Plan</h4>
                        <ol>
                          <li
                            v-for="(step, index) in selectedAgentRun.contract
                              .steps"
                            :key="step.id"
                            :class="step.status"
                          >
                            <span>
                              <Check v-if="step.status === 'complete'" aria-hidden="true" />
                              <CircleAlert v-else-if="step.status === 'blocked'" aria-hidden="true" />
                              <template v-else>{{ index + 1 }}</template>
                            </span>
                            <div>
                              <strong>{{ step.title }}</strong>
                              <p>{{ step.detail }}</p>
                            </div>
                          </li>
                        </ol>
                        <details
                          v-if="selectedAgentRun.contract.constraints.length"
                        >
                          <summary>Constraints</summary>
                          <ul>
                            <li
                              v-for="constraint in selectedAgentRun.contract
                                .constraints"
                              :key="constraint"
                            >
                              {{ constraint }}
                            </li>
                          </ul>
                        </details>
                      </article>
                      <article class="contract-evidence">
                        <h4>Acceptance checks</h4>
                        <div
                          v-for="criterion in selectedAgentRun.contract
                            .criteria"
                          :key="criterion.id"
                          :class="['criterion-row', criterion.status]"
                        >
                          <span>
                            <Check v-if="criterion.status === 'proven'" aria-hidden="true" />
                            <CircleAlert v-else-if="criterion.status === 'failed'" aria-hidden="true" />
                            <BadgeCheck v-else-if="criterion.status === 'supported'" aria-hidden="true" />
                            <CircleMinus v-else aria-hidden="true" />
                          </span>
                          <div>
                            <header>
                              <strong>{{ criterion.text }}</strong
                              ><em>{{ criterion.status }}</em>
                            </header>
                            <small>{{ criterion.method }} evidence</small>
                            <ul v-if="criterion.evidence.length">
                              <li
                                v-for="item in criterion.evidence"
                                :key="item"
                              >
                                {{ item }}
                              </li>
                            </ul>
                          </div>
                        </div>
                      </article>
                      <aside class="contract-critique">
                        <h4>Independent review</h4>
                        <div
                          v-for="finding in selectedAgentRun.critique
                            ?.findings ?? []"
                          :key="finding.title"
                          :class="finding.severity"
                        >
                          <span>
                            <CircleAlert v-if="finding.severity === 'blocker'" aria-hidden="true" />
                            <TriangleAlert v-else-if="finding.severity === 'warning'" aria-hidden="true" />
                            <CircleCheck v-else aria-hidden="true" />
                          </span>
                          <div>
                            <strong>{{ finding.title }}</strong>
                            <p>{{ finding.detail }}</p>
                          </div>
                        </div>
                        <div v-if="!selectedAgentRun.critique" class="pending">
                          <span><Ellipsis aria-hidden="true" /></span>
                          <div>
                            <strong>Review pending</strong>
                            <p>
                              Aperta reviews the final patch after the run and
                              checks finish.
                            </p>
                          </div>
                        </div>
                      </aside>
                    </div>
                  </section>
                  <template v-else-if="agentReviewTab === 'changes'"
                    ><div class="agent-review-tabs">
                      <div>
                        <button
                          v-for="file in selectedAgentRun.files"
                          :key="file.path"
                          :class="{
                            active: selectedAgentPatch?.path === file.path,
                          }"
                          :title="file.path"
                          @click="selectedAgentPath = file.path"
                        >
                          <strong>{{ basename(file.path) }}</strong
                          ><small>+{{ file.added }} −{{ file.removed }}</small>
                        </button>
                      </div>
                      <span>{{
                        selectedAgentRun.files.length
                          ? `${selectedAgentRun.files.length} reviewable file${selectedAgentRun.files.length === 1 ? "" : "s"}`
                          : selectedAgentRun.status === "running" ||
                              selectedAgentRun.status === "verifying"
                            ? "Waiting for changes"
                            : "No files changed"
                      }}</span>
                    </div>
                    <div
                      v-if="selectedAgentPatch"
                      class="agent-patch semantic-diff wrap"
                      aria-label="Agent patch preview"
                    >
                      <div
                        v-for="(line, index) in selectedAgentPatch.lines"
                        :key="index"
                        :class="['diff-line', line.kind]"
                      >
                        <span class="gutter old">{{ line.oldLine ?? "" }}</span
                        ><span class="gutter new">{{ line.newLine ?? "" }}</span
                        ><span class="marker">{{
                          line.kind === "add"
                            ? "+"
                            : line.kind === "delete"
                              ? "−"
                              : line.kind === "context"
                                ? " "
                                : ""
                        }}</span
                        ><code
                          ><span
                            v-for="(token, tokenIndex) in tokenizeLine(
                              line.text,
                              selectedAgentPatch.path,
                            )"
                            :key="tokenIndex"
                            :class="`syntax-${token.kind}`"
                            >{{ token.text }}</span
                          ></code
                        >
                      </div>
                    </div>
                    <article
                      v-else-if="selectedAgentRun.status === 'no-changes'"
                      class="agent-no-change"
                    >
                      <div class="agent-no-change-icon"><CircleCheck aria-hidden="true" /></div>
                      <div>
                        <p class="eyebrow">ANALYSIS COMPLETE</p>
                        <h4>No files were changed</h4>
                        <p>
                          The agent inspected the repository and returned an
                          explanation instead of manufacturing a patch.
                        </p>
                      </div>
                      <section>
                        <strong>Response</strong>
                        <div
                          v-if="selectedAgentRun.capabilities?.length"
                          class="proof-loop-evidence"
                          aria-label="Aperta capability evidence"
                        >
                          <article
                            v-for="capability in selectedAgentRun.capabilities"
                            :key="capability.id"
                            :class="capability.status"
                          >
                            <span>
                              <CircleCheck v-if="capability.status === 'passed' || capability.status === 'reachable'" aria-hidden="true" />
                              <CircleAlert v-else aria-hidden="true" />
                            </span>
                            <div>
                              <strong>{{ capability.label }}</strong>
                              <p>{{ capability.summary }}</p>
                              <small>{{ capability.command }} · {{ (capability.durationMs / 1000).toFixed(1) }}s</small>
                            </div>
                          </article>
                        </div>
                        <AgentMarkdown
                          :source="selectedAgentRun.summary"
                          aria-label="Agent response"
                        />
                      </section>
                    </article>
                    <div v-else class="source-message">
                      <strong>{{
                        selectedAgentRun.status === "failed"
                          ? "Run failed before producing a patch."
                          : selectedAgentRun.status === "running" ||
                              selectedAgentRun.status === "verifying"
                            ? "The agent is still working."
                            : "No repository changes were produced."
                      }}</strong
                      ><span>{{ selectedAgentRun.error }}</span
                      ><button
                        v-if="selectedAgentRun.status === 'failed'"
                        class="agent-run-retry"
                        @click="
                          agentIntent = selectedAgentRun.intent;
                          setAgentPaneOpen(true);
                        "
                      >
                        Retry in conversation
                      </button>
                    </div></template
                  >
                  <section
                    v-else-if="agentReviewTab === 'checks'"
                    class="agent-checks"
                  >
                    <header :class="selectedAgentRun.verification.status">
                      <span>
                        <CircleCheck v-if="selectedAgentRun.verification.status === 'passed'" aria-hidden="true" />
                        <CircleAlert v-else-if="selectedAgentRun.verification.status === 'failed'" aria-hidden="true" />
                        <CircleMinus v-else aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{{
                          selectedAgentRun.verification.status === "passed"
                            ? "Verification passed"
                            : selectedAgentRun.verification.status === "failed"
                              ? "Verification needs attention"
                              : selectedAgentRun.verification.plan.length
                                ? "Verification has not run yet"
                                : "No supported checks detected"
                        }}</strong>
                        <p>
                          {{
                            selectedAgentRun.verification.plan.length
                              ? selectedAgentRun.verification.plan.join(" · ")
                              : "Aperta did not find an allowlisted test, type-check, lint, or build command for this project."
                          }}
                        </p>
                      </div>
                    </header>
                    <article
                      v-if="selectedAgentRun.verification.baseline"
                      class="verification-attempt baseline"
                    >
                      <h4>
                        <span :class="selectedAgentRun.verification.baseline.status">
                          <CircleCheck v-if="selectedAgentRun.verification.baseline.status === 'passed'" aria-hidden="true" />
                          <CircleAlert v-else aria-hidden="true" />
                        </span>
                        Pre-change baseline
                        <small>{{
                          new Date(
                            selectedAgentRun.verification.baseline.ts,
                          ).toLocaleTimeString()
                        }}</small>
                      </h4>
                      <details
                        v-for="check in selectedAgentRun.verification.baseline
                          .checks"
                        :key="`baseline-${check.id}`"
                        :class="['verification-check', check.status]"
                      >
                        <summary>
                          <span>
                            <CircleCheck v-if="check.status === 'passed'" aria-hidden="true" />
                            <CircleAlert v-else aria-hidden="true" />
                          </span
                          ><strong>{{ check.label }}</strong
                          ><code>{{ check.command }}</code
                          ><small
                            >{{ (check.durationMs / 1000).toFixed(1) }}s</small
                          >
                        </summary>
                        <pre>{{
                          check.output || "Completed without console output."
                        }}</pre>
                      </details>
                    </article>
                    <article
                      v-for="attempt in selectedAgentRun.verification.attempts"
                      :key="attempt.index"
                      class="verification-attempt"
                    >
                      <h4>
                        <span :class="attempt.status">
                          <CircleCheck v-if="attempt.status === 'passed'" aria-hidden="true" />
                          <CircleAlert v-else aria-hidden="true" />
                        </span>
                        Post-change attempt {{ attempt.index }}
                        <small>{{
                          new Date(attempt.ts).toLocaleTimeString()
                        }}</small>
                      </h4>
                      <details
                        v-for="check in attempt.checks"
                        :key="`${attempt.index}-${check.id}`"
                        :class="['verification-check', check.status]"
                        :open="check.status !== 'passed'"
                      >
                        <summary>
                          <span>
                            <CircleCheck v-if="check.status === 'passed'" aria-hidden="true" />
                            <CircleAlert v-else aria-hidden="true" />
                          </span
                          ><strong>{{ check.label }}</strong
                          ><code>{{ check.command }}</code
                          ><small
                            >{{ (check.durationMs / 1000).toFixed(1) }}s</small
                          >
                        </summary>
                        <pre>{{
                          check.output || "Completed without console output."
                        }}</pre>
                      </details>
                    </article>
                    <div
                      v-if="!selectedAgentRun.verification.attempts.length"
                      class="checks-empty"
                    >
                      <LoaderCircle
                        v-if="selectedAgentRun.status === 'verifying'"
                        class="agent-loader"
                        aria-hidden="true"
                      />
                      <strong>{{
                        selectedAgentRun.status === "verifying"
                          ? "Running project checks…"
                          : "No post-change verification attempts recorded."
                      }}</strong>
                    </div>
                  </section>
                  <section v-else ref="agentActivityPanel" class="agent-activity-feed">
                    <article
                      v-if="
                        selectedAgentRun.summary &&
                        selectedAgentRun.status !== 'running' &&
                        selectedAgentRun.status !== 'verifying'
                      "
                      class="agent-response-card"
                    >
                      <div class="agent-response-head">
                        <Sparkles aria-hidden="true" />
                        <strong>Response</strong
                        ><time>{{
                          selectedAgentRun.finishedAt
                            ? new Date(
                                selectedAgentRun.finishedAt,
                              ).toLocaleTimeString()
                            : ""
                        }}</time>
                      </div>
                      <AgentMarkdown :source="selectedAgentRun.summary" />
                    </article>
                    <ol>
                      <li
                        v-for="action in visibleAgentActions(selectedAgentRun.actions)"
                        :key="action.index"
                        :class="action.status"
                      >
                        <span
                          :class="[
                            'activity-step-icon',
                            action.action,
                            action.status,
                          ]"
                          ><component
                            :is="agentActionIcon(action)"
                            class="action-icon"
                            aria-hidden="true"
                        /></span>
                        <div>
                          <header>
                            <b>{{ action.action }}</b
                            ><time
                              ><em v-if="action.errorClass">{{
                                action.errorClass
                              }}</em
                              >{{
                                action.durationMs !== undefined
                                  ? metricDuration(action.durationMs)
                                  : ""
                              }}
                              ·
                              {{
                                new Date(action.ts).toLocaleTimeString()
                              }}</time
                            >
                          </header>
                          <code v-if="action.path">{{ cleanAgentActionPath(action.path) }}</code>
                          <p v-if="cleanAgentActionDetail(action)">{{ cleanAgentActionDetail(action) }}</p>
                          <code
                            v-if="action.command"
                            class="activity-command"
                            >{{ action.command }}</code
                          >
                          <details
                            v-if="action.output"
                            :class="[
                              'activity-evidence',
                              action.evidenceStatus,
                            ]"
                            :open="
                              action.evidenceStatus === 'failed' ||
                              action.evidenceStatus === 'crashed' ||
                              action.evidenceStatus === 'unhealthy'
                            "
                          >
                            <summary>
                              <strong>Runtime evidence</strong>
                              <span>{{
                                action.evidenceStatus ?? "captured"
                              }}</span>
                            </summary>
                            <pre>{{ action.output }}</pre>
                          </details>
                        </div>
                      </li>
                    </ol>
                    <div
                      v-if="
                        selectedAgentRun.status === 'running' ||
                        selectedAgentRun.status === 'verifying'
                      "
                      class="activity-live"
                      aria-live="polite"
                    >
                      <LoaderCircle class="agent-loader" aria-hidden="true" />
                      <span
                        ><strong>{{
                          selectedAgentRun.status === "verifying"
                            ? "Running checks"
                            : "Agent working"
                        }}</strong
                        ><small>{{
                          selectedAgentRun.status === "verifying"
                            ? "Comparing evidence in the isolated patch"
                            : "Following the run plan"
                        }}</small></span
                      >
                    </div>
                    <div
                      v-else-if="!selectedAgentRun.actions.length"
                      class="checks-empty"
                    >
                      <strong>No actions were recorded.</strong>
                    </div>
                  </section>
                  <footer
                    v-if="selectedAgentRun.status === 'ready'"
                    :class="[
                      'promotion-gate',
                      selectedAgentRun.promotion.status,
                    ]"
                  >
                    <div class="promotion-copy">
                      <span class="promotion-icon" aria-hidden="true"><ShieldCheck /></span>
                      <div>
                        <strong>{{
                          selectedAgentRun.promotion.status ===
                          "review-required"
                            ? "Review before promotion"
                            : "Ready to promote"
                        }}</strong>
                        <p>{{ selectedAgentRun.promotion.reason }}</p>
                        <small
                          >Aperta will confirm the repository still matches this
                          run before applying anything.</small
                        >
                      </div>
                    </div>
                    <div class="promotion-actions">
                      <label
                        ><input
                          v-model="agentApplyConfirmed"
                          type="checkbox"
                        /><span
                          ><strong>I reviewed this change</strong
                          ><small
                            >Patch, evidence, and remaining uncertainty</small
                          ></span
                        ></label
                      ><button
                        :disabled="
                          !agentApplyConfirmed ||
                          agentApplying ||
                          !selectedAgentRun.promotion.allowed
                        "
                        @click="applySelectedAgentRun"
                      >
                        {{ agentApplying ? "Verifying…" : "Promote patch" }}
                      </button>
                    </div>
                  </footer>
                  <footer
                    v-else-if="selectedAgentRun.status === 'applied'"
                    class="promotion-complete"
                  >
                    <strong><CircleCheck aria-hidden="true" />Contract satisfied and patch promoted</strong
                    ><span
                      >Aperta is observing the real working tree and will
                      capture the change for proof and ownership.</span
                    >
                  </footer>
                  <footer
                    v-else-if="
                      selectedAgentRun.status === 'verification-failed'
                    "
                    class="verification-blocked"
                  >
                    <div>
                      <strong>Checks blocked promotion</strong
                      ><span
                        >{{
                          selectedAgentRun.verification.attempts.length >= 3
                            ? "The bounded repair attempts completed without a passing build."
                            : `The agent reached its bounded action limit after ${selectedAgentRun.verification.attempts.length} verification attempt${selectedAgentRun.verification.attempts.length === 1 ? "" : "s"}.`
                        }}
                        Continue in this conversation so the existing patch and
                        compiler evidence stay available.</span
                      >
                    </div>
                    <button
                      @click="
                        agentIntent =
                          'Fix the failing verification checks shown in the latest run. Use the compiler output, preserve the intended behavior, and do not weaken legitimate tests.';
                        setAgentPaneOpen(true);
                      "
                    >
                      Fix failing checks
                    </button>
                  </footer>
                  </section>
                  <section v-else class="agent-review agent-welcome">
                    <div class="agent-welcome-mark"><Sparkles aria-hidden="true" /></div>
                  <h3>Your agent workspace</h3>
                  <p>
                    Start with a task in the agent pane. Aperta will keep the
                    work isolated and bring you back a reviewable patch.
                  </p>
                  <ol>
                    <li>
                      <b>1</b
                      ><span
                        ><strong>Agent works</strong
                        ><small
                          >Reads, searches, and edits in a disposable
                          worktree.</small
                        ></span
                      >
                    </li>
                    <li>
                      <b>2</b
                      ><span
                        ><strong>You review</strong
                        ><small
                          >Inspect every changed file and the complete action
                          record.</small
                        ></span
                      >
                    </li>
                    <li>
                      <b>3</b
                      ><span
                        ><strong>You promote</strong
                        ><small
                          >Apply only after Aperta confirms the repository is
                          still safe.</small
                        ></span
                      >
                    </li>
                  </ol>
                </section>
              </main>
              <button
                v-if="agentPaneOpen"
                class="agent-pane-resizer"
                aria-label="Resize agent pane"
                title="Drag to resize agent pane"
                @pointerdown.prevent="beginAgentPanelResize"
                @keydown.left.prevent="resizeAgentPanelBy(20)"
                @keydown.right.prevent="resizeAgentPanelBy(-20)"
              >
                <span></span>
              </button>
              <aside
                v-if="agentPaneOpen"
                class="agent-sidepane"
                aria-label="Agent controls"
                  >
                    <header>
                      <div>
                        <span class="agent-orb"><Sparkles aria-hidden="true" /></span>
                    <div>
                      <strong>{{ agentRuntimeStatus ? agentRuntimeLabel(agentRuntimeStatus.kind) : 'Execution engine' }}</strong
                      ><small>{{ agentEngineSummary }}</small>
                    </div>
                  </div>
                  <button
                    class="icon-close"
                    @click="setAgentPaneOpen(false)"
                    aria-label="Close agent pane"
                    title="Close agent pane"
                  >
                    <X class="nav-icon" aria-hidden="true" />
                  </button>
                </header>
                <section class="agent-run-picker agent-conversation-picker">
                  <div>
                    <label for="agent-conversation-select">Conversation</label
                    ><button
                      class="agent-new-task"
                          :disabled="agentRunning"
                          @click="newAgentConversation"
                        >
                          <Plus aria-hidden="true" />New task
                    </button>
                  </div>
                  <select
                    id="agent-conversation-select"
                    :value="selectedAgentConversation?.id ?? ''"
                    :disabled="!agentConversations.length || agentRunning"
                    @change="
                      selectAgentConversation(
                        ($event.target as HTMLSelectElement).value,
                      )
                    "
                  >
                    <option v-if="startingNewAgentConversation" value="">
                      New task
                    </option>
                    <option v-else-if="!agentConversations.length" value="">
                      No conversations yet
                    </option>
                    <option
                      v-for="conversation in agentConversations"
                      :key="conversation.id"
                      :value="conversation.id"
                    >
                      {{ conversation.title }}
                    </option></select
                  ><small>{{
                    selectedAgentConversation
                      ? `${selectedAgentConversation.runs.length} turn${selectedAgentConversation.runs.length === 1 ? "" : "s"} in this conversation`
                      : "Fresh context"
                  }}</small>
                </section>
                <section class="agent-side-activity agent-thread">
                  <header>
                    <strong>{{
                      agentRunning
                        ? "Working now"
                        : startingNewAgentConversation
                          ? "New conversation"
                          : "Conversation"
                    }}</strong
                    ><span v-if="selectedAgentConversation"
                      >{{ selectedAgentConversation.runs.length }}
                      {{
                        selectedAgentConversation.runs.length === 1
                          ? "turn"
                          : "turns"
                      }}</span
                    >
                  </header>
                  <ol v-if="selectedAgentConversation?.runs.length">
                    <li
                      v-for="run in selectedAgentConversation.runs"
                      :key="run.id"
                      :class="{ selected: selectedAgentRun?.id === run.id }"
                      @click="selectAgentRun(run.id)"
                    >
                      <span>{{ run.turnIndex }}</span>
                      <div>
                        <strong>You</strong>
                        <p>{{ run.intent }}</p>
                        <small :class="['agent-turn-result', run.status]"
                          >{{ run.status }} · {{ agentHeadline(run) }}</small
                        >
                      </div>
                    </li>
                  </ol>
                  <div v-else class="agent-side-empty">
                    Describe the outcome you want. Follow-ups will stay together
                    here.
                      </div>
                      <div v-if="agentRunning" class="agent-side-live">
                        <LoaderCircle class="agent-loader" aria-hidden="true" />
                        {{
                      agentJob?.state === "queued"
                        ? "Preparing workspace…"
                        : "Inspecting and editing…"
                    }}<button @click="cancelExecution(agentJob)">Stop</button>
                  </div>
                </section>
                <footer class="agent-side-composer">
                  <div
                    class="agent-suggestions"
                    aria-label="Example agent tasks"
                  >
                    <button
                      @click="
                        agentIntent =
                          'Investigate the current failing behavior, identify the root cause, and implement the smallest safe fix.'
                      "
                    >
                      Fix</button
                    ><button
                      @click="
                        agentIntent =
                          'Refactor the selected area for clarity without changing its public behavior.'
                      "
                    >
                      Refactor</button
                    ><button
                      @click="
                        agentIntent =
                          'Add tests for the most important unproven behavior in this repository.'
                      "
                    >
                      Tests
                    </button>
                  </div>
                  <textarea
                    v-model="agentIntent"
                    rows="5"
                    :placeholder="
                      selectedAgentConversation
                        ? 'Follow up in this conversation…'
                        : 'Start a task: ask Aperta to change or explain this repository…'
                    "
                    aria-label="Agent change intent"
                    title="Enter to send · Shift+Enter for a new line"
                    @keydown.enter.exact.prevent="startAgentRun"
                    @keydown.meta.enter.prevent="startAgentRun"
                    @keydown.ctrl.enter.prevent="startAgentRun"
                  ></textarea>
                  <div>
                    <span
                      :title="
                        selectedAgentRun?.context?.lastInputChars
                          ? `${selectedAgentRun.context.lastInputChars.toLocaleString()} of ${selectedAgentRun.context.maxInputChars.toLocaleString()} input characters in the latest action; token count is estimated.`
                          : 'Enter to send · Shift+Enter for a new line'
                      "
                      >{{
                        selectedAgentRun?.context?.lastInputChars
                          ? `Turn ${(selectedAgentConversation?.runs.length ?? 0) + 1} · ≈${Math.ceil(selectedAgentRun.context.estimatedLastInputTokens / 1000)}k/${Math.ceil(selectedAgentRun.context.estimatedMaxInputTokens / 1000)}k context`
                          : selectedAgentConversation
                            ? `Turn ${selectedAgentConversation.runs.length + 1} · context ≤24k`
                            : "New task · Enter to send"
                      }}</span
                    ><button
                      v-if="!agentExecutionReady"
                      class="configure-agent"
                      @click="showAgentModelSettings"
                    >
                      Configure engine</button
                    ><button
                      v-else
                      class="agent-send"
                      :disabled="agentRunning || agentIntent.trim().length < 10 || !state?.initialization.initialized"
                      @click="startAgentRun"
                    >
                      {{
                        agentRunning
                          ? "Working…"
                          : selectedAgentConversation
                            ? "Send"
                            : "Start"
                          }}
                          <ArrowUpRight aria-hidden="true" />
                        </button>
                  </div>
                </footer>
              </aside>
              <button
                v-else
                class="agent-pane-rail"
                @click="setAgentPaneOpen(true)"
                aria-label="Open agent pane"
                    title="Open agent pane"
                  >
                    <Sparkles aria-hidden="true" /><strong>Agent</strong>
                  </button>
            </div>
          </template>

          <template v-else-if="view === 'settings'">
            <div class="section-head">
              <div>
                <h2>Models and coding agents</h2>
                <p>
                  Choose what runs coding tasks. Then assign models to the AI
                  work Aperta performs.
                </p>
              </div>
              <div class="settings-head-actions">
                <button
                  v-if="settingsOpenedFromAgents"
                  type="button"
                  class="return-to-workbench"
                  @click="returnToAgentWorkbench"
                >
                  ← Agent Work
                </button>
                <span class="engine-badge">{{
                  modelSettings?.secureStorage ?? "Loading secure storage…"
                }}</span>
              </div>
            </div>
            <div v-if="settingsError" class="settings-error">
              {{ settingsError }}
            </div>
            <section class="runtime-settings" aria-labelledby="agent-runtime-title">
              <header>
                <div>
                  <p class="eyebrow">CODING AGENT</p>
                  <h3 id="agent-runtime-title">Choose what runs coding tasks.</h3>
                  <p>Your coding agent plans and edits. Aperta isolates the work, runs checks, and records evidence.</p>
                </div>
                <span class="runtime-active">ACTIVE · {{ modelSettings?.agentRuntime.kind ?? 'aperta' }}</span>
              </header>
              <div class="runtime-options">
                <button
                  v-for="runtime in modelSettings?.agentRuntimes ?? []"
                  :key="runtime.kind"
                  type="button"
                  :class="{ selected: agentRuntimeForm.kind === runtime.kind, unavailable: !runtime.available }"
                  :aria-pressed="agentRuntimeForm.kind === runtime.kind"
                  @click="agentRuntimeForm.kind = runtime.kind"
                >
                  <span class="runtime-mark">{{ agentRuntimeMark(runtime.kind) }}</span>
                  <span><strong>{{ agentRuntimeLabel(runtime.kind) }}</strong><small>{{ agentRuntimeSubtitle(runtime.kind) }}</small></span>
                  <em :class="{ ready: runtime.available }">{{ runtime.available ? 'READY' : 'SETUP NEEDED' }}</em>
                  <p>{{ runtime.detail }}</p>
                </button>
              </div>
              <div class="engine-ownership-boundary">
                <div>
                  <small>{{ agentRuntimeForm.kind === 'aperta' ? 'APERTA NATIVE OWNS' : `${agentRuntimeLabel(agentRuntimeForm.kind).toUpperCase()} OWNS` }}</small>
                  <strong>Planning · context · tool choices · edits</strong>
                  <span v-if="agentRuntimeForm.kind === 'aperta'">Powered by the Builder model configured below.</span>
                  <span v-else>Powered by the model and credentials configured inside that runtime.</span>
                </div>
                <i aria-hidden="true">→</i>
                <div class="aperta-owns">
                  <small>APERTA ALWAYS OWNS</small>
                  <strong>Isolation · checks · repair feedback</strong>
                  <span>Evidence · review · promotion · learning</span>
                </div>
              </div>
              <div v-if="agentRuntimeForm.kind !== 'aperta'" class="cursor-runtime-config">
                <label>{{ agentRuntimeLabel(agentRuntimeForm.kind) }} model <input v-model="agentRuntimeForm.model" :placeholder="agentRuntimeForm.kind === 'opencode' ? 'Optional: provider/model' : 'Optional: use runtime default'" /></label>
                <p>Passed directly to the selected CLI. The runtime manages authentication; Aperta never stores its credentials.</p>
                <p v-if="!modelSettings?.agentRuntimes.find((runtime) => runtime.kind === agentRuntimeForm.kind)?.available" class="runtime-install-note">
                  Install and authenticate {{ agentRuntimeLabel(agentRuntimeForm.kind) }}, refresh Settings, then activate it here.
                </p>
              </div>
              <button
                class="save-runtime"
                type="button"
                :disabled="settingsSaving || (agentRuntimeForm.kind !== 'aperta' && !modelSettings?.agentRuntimes.find((runtime) => runtime.kind === agentRuntimeForm.kind)?.available)"
                @click="saveAgentRuntime"
              >{{ settingsSaving ? 'Saving…' : `Use ${agentRuntimeLabel(agentRuntimeForm.kind)}` }}</button>
            </section>
            <section class="intelligence-routing" aria-labelledby="intelligence-routing-title">
              <header>
                <p class="eyebrow">HOW APERTA USES MODELS</p>
                <h3 id="intelligence-routing-title">Choose a model for each AI task</h3>
              </header>
              <article :class="{ paused: modelSettings?.agentRuntime.kind !== 'aperta' }">
                <span>1</span><div><strong>Builder</strong><p>{{ activeBuilderProfile?.name ?? 'Not configured' }} · {{ activeBuilderProfile?.model ?? 'Choose a model below' }}</p><small>{{ modelSettings?.agentRuntime.kind === 'aperta' ? 'Runs the Aperta Native coding loop.' : `On standby. ${agentRuntimeLabel(modelSettings?.agentRuntime.kind ?? 'aperta')} manages its own model.` }}</small></div>
              </article>
              <article>
                <span>2</span><div><strong>Coach</strong><p>{{ activeCoachProfile?.name ?? 'Not configured' }} · {{ activeCoachProfile?.model ?? 'Choose a model below' }}</p><small>Creates review questions from repository evidence.</small></div>
              </article>
              <article class="deterministic">
                <span>✓</span><div><strong>Verification</strong><p>Aperta repository checks</p><small>Project commands and runtime probes. A model does not decide the result.</small></div>
              </article>
            </section>
            <div class="settings-layout">
              <section class="profile-list">
                <header>
                  <p class="eyebrow">SAVED MODELS</p>
                  <h3>Assign models to Aperta tasks.</h3>
                  <p>
                    Builder and Coach settings apply to every project. Aperta
                    runs verification without a model.
                  </p>
                </header>
                <article
                  v-for="profile in modelSettings?.profiles ?? []"
                  :key="profile.id"
                  :class="{
                    active: Object.values(modelSettings?.activeProfileIds ?? {}).includes(profile.id),
                  }"
                >
                  <div class="profile-provider">
                    {{ profile.provider.slice(0, 2).toUpperCase() }}
                  </div>
                  <div>
                    <strong>{{ profile.name }}</strong
                    ><span>{{ profile.model }}</span
                    ><small
                      >{{ profile.baseUrl }} ·
                      {{
                        profile.credentialConfigured
                          ? profile.credentialSource === "keychain"
                            ? "credential in Keychain"
                            : "credential available"
                          : "credential required"
                      }}</small
                    >
                  </div>
                  <em>{{ profile.capabilities?.nativeTools ? "NATIVE TOOLS" : profile.capabilities?.status === "connected" ? "JSON FALLBACK" : "UNTESTED" }}</em>
                  <div class="profile-capabilities">
                    <span v-if="profile.capabilities?.latencyMs">{{ profile.capabilities.latencyMs }}ms handshake</span>
                    <span>{{ profile.capabilities?.modelDiscovery ? "catalog connected" : "manual model" }}</span>
                  </div>
                  <div class="profile-actions">
                    <button @click="retestProfile(profile.id)" :disabled="testingProfileId === profile.id">
                      {{ testingProfileId === profile.id ? 'Testing…' : 'Retest' }}
                    </button>
                    <button
                      v-for="role in modelRoles"
                      :key="role"
                      :class="{ assigned: modelSettings?.activeProfileIds[role] === profile.id }"
                      @click="assignProfileRole(profile.id, role)"
                    >{{ modelSettings?.activeProfileIds[role] === profile.id ? `✓ ${role}` : `Use for ${role}` }}</button>
                    <button
                      class="remove-profile"
                      @click="removeProfile(profile.id)"
                    >
                      {{
                        removingProfileId === profile.id
                          ? "Confirm remove"
                          : "Remove"
                      }}
                    </button>
                  </div>
                </article>
                <div
                  v-if="modelSettings && !modelSettings.profiles.length"
                  class="empty-state"
                >
                  <strong>No model profiles yet.</strong
                  ><span
                    >Add one without changing how Aperta captures or proves
                    code.</span
                  >
                </div>
              </section>
              <form class="profile-form" @submit.prevent="saveProfile">
                <p class="eyebrow">ADD APERTA MODEL</p>
                <h3>Connect an intelligence service</h3>
                <p class="provider-guidance">
                  Aperta tests the real endpoint before activation and records
                  whether the selected model can produce native tool calls.
                </p>
                <div class="provider-catalog" role="list" aria-label="Model providers">
                  <button
                    v-for="provider in modelSettings?.providers ?? []"
                    :key="provider.id"
                    type="button"
                    :class="{ selected: profileForm.provider === provider.id }"
                    :aria-pressed="profileForm.provider === provider.id"
                    @click="chooseProvider(provider)"
                  >
                    <span>{{ provider.label }}</span>
                    <small>{{ provider.category }}</small>
                    <p>{{ provider.description }}</p>
                  </button>
                </div>
                <div v-if="selectedProviderPreset" class="selected-provider-note">
                  <strong>{{ selectedProviderPreset.label }}</strong>
                  <span>{{ selectedProviderPreset.description }}</span>
                </div>
                <label
                  >Profile name<input
                    v-model="profileForm.name"
                    placeholder="Work OpenAI, Local Qwen…" /></label
                ><label v-if="providerInspection?.models.length"
                  >Model<select v-model="profileForm.model" required>
                    <option value="" disabled>Choose a discovered model</option>
                    <option v-for="model in providerInspection.models" :key="model.id" :value="model.id">
                      {{ model.name }}{{ model.nativeTools === true ? ' · tools' : '' }}{{ model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : '' }}
                    </option>
                  </select></label
                ><label v-else
                  >Model ID<input
                    v-model="profileForm.model"
                    placeholder="Discover models or enter an exact model ID" /></label
                ><label
                  >Endpoint<input
                    v-model="profileForm.baseUrl"
                    :placeholder="
                      profileForm.provider === 'ollama'
                        ? 'http://127.0.0.1:11434'
                        : profileForm.provider === 'openai-compatible'
                          ? 'https://provider.example/v1'
                          : 'Leave blank for provider default'
                    " /></label
                ><label v-if="profileForm.provider !== 'ollama'"
                  >API key<input
                    v-model="profileForm.apiKey"
                    type="password"
                    autocomplete="new-password"
                    placeholder="Stored in macOS Keychain"
                /></label>
                <div v-if="providerError" class="settings-error provider-inline-error" role="alert">
                  {{ providerError }}
                </div>
                <button type="button" class="inspect-provider" :disabled="providerInspecting" @click="inspectProvider">
                  {{ providerInspecting ? 'Testing provider…' : profileForm.model ? 'Verify model and native tools' : 'Connect and discover models' }}
                </button>
                <div v-if="providerInspection" :class="['capability-result', providerInspection.capabilities.status]">
                  <strong>{{ providerInspection.capabilities.nativeTools ? 'Native tool calling verified' : 'Provider connected' }}</strong>
                  <span>{{ providerInspection.capabilities.detail }}</span>
                  <small>{{ providerInspection.models.length }} models discovered · {{ providerInspection.capabilities.latencyMs }}ms</small>
                </div>
                <div class="privacy-boundary">
                  <strong>Credential boundary</strong>
                  <p>
                    The browser sends the key only to this local Aperta server.
                    It is written to
                    {{ modelSettings?.secureStorage ?? "secure storage" }} and
                    is never returned to the browser.
                  </p>
                </div>
                <div class="privacy-boundary">
                  <strong>Project-memory boundary</strong>
                  <p>
                    Raw prompts, transcripts, explanations, and execution logs
                    stay in private per-user storage. The repository contains
                    only a non-sensitive Aperta project identity.
                  </p>
                </div>
                <p v-if="profileForm.model && providerInspection?.testedModel !== profileForm.model" class="verification-required">
                  Verify this exact model before activation.
                </p>
                <button type="submit" :disabled="settingsSaving || !profileForm.model || providerInspection?.testedModel !== profileForm.model">
                  {{
                    settingsSaving ? "Saving securely…" : "Save and activate"
                  }}
                </button>
              </form>
            </div>
          </template>
        </section>
      </div>

      <div
        v-if="reviewItem"
        class="review-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Ownership review"
      >
        <section class="review-window">
          <header class="review-header">
            <div>
              <p class="eyebrow">OWNERSHIP REVIEW</p>
              <h2>
                {{
                  brief?.story.title ?? "Turn generated code into code you own."
                }}
              </h2>
              <div class="learning-steps" aria-label="Learning path">
                <span class="complete"><b>1</b>Orient</span><i></i
                ><span
                  :class="{
                    complete: requiredAnswersComplete >= 1,
                    active: requiredAnswersComplete < 1,
                  }"
                  ><b>2</b>Trace</span
                ><i></i
                ><span
                  :class="{
                    complete: requiredAnswersComplete >= 3,
                    active:
                      requiredAnswersComplete >= 1 &&
                      requiredAnswersComplete < 3,
                  }"
                  ><b>3</b>Challenge</span
                ><i></i
                ><span
                  :class="{
                    complete: ownershipReady,
                    active: requiredAnswersComplete >= 3 && !ownershipReady,
                  }"
                  ><b>4</b>Explain</span
                >
              </div>
            </div>
            <div class="review-head-actions">
              <span v-if="brief"
                ><b>{{ sessionProgress }}%</b> review complete</span
              ><button
                class="close-review icon-close"
                @click="closeReview"
                aria-label="Close ownership review"
              >
                <X class="nav-icon" aria-hidden="true" />
              </button>
            </div>
          </header>
          <div v-if="reviewError" class="review-error">{{ reviewError }}</div>
          <div v-if="!brief && !reviewError" class="review-loading">
            <div class="spinner"></div>
            Preparing your review…
          </div>
          <div v-else-if="completion" class="completion-panel">
            <div class="completion-orb">✓</div>
            <p class="eyebrow">SESSION RECORDED</p>
            <h2>
              {{
                completion.before === null
                  ? "A baseline now exists."
                  : "Review complete."
              }}
            </h2>
            <div class="confidence-delta">
              <span
                ><small>BEFORE</small
                ><strong>{{ completion.before ?? "Not rated" }}</strong></span
              ><i>→</i
              ><span
                ><small>AFTER</small
                ><strong>{{ completion.after }}</strong></span
              >
            </div>
            <p>
              You spent
              {{ Math.max(1, Math.round(completion.durationMs / 60000)) }}
              minute{{
                Math.round(completion.durationMs / 60000) === 1 ? "" : "s"
              }}
              reviewing what changed and why.
            </p>
            <button class="finish-review" @click="closeReview">
              Back to changes
            </button>
          </div>
          <div
            v-else-if="brief"
            class="review-body review-body-wide"
            :style="{
              '--ownership-left-width': `${ownershipLeftWidth}px`,
              '--ownership-right-width': `${ownershipRightWidth}px`,
            }"
          >
            <aside class="change-navigator">
              <div class="change-summary">
                <span
                  ><strong>{{ brief.diff.files.length }}</strong> files</span
                ><span
                  ><strong>{{ brief.changedLines }}</strong> lines</span
                ><small>{{ brief.diff.model ?? brief.diff.authorship }}</small>
              </div>
              <div class="story-card">
                <div>
                  <small>CHANGE SUMMARY</small
                  ><span :class="['risk-chip', brief.story.risk]"
                    >{{ brief.story.risk }} risk</span
                  >
                </div>
                <h3>{{ brief.story.title }}</h3>
                <p>
                  {{ brief.story.provenance }} · about
                  {{ brief.story.expectedMinutes }} minutes to verify
                </p>
                <ul>
                  <li v-for="behavior in brief.story.behaviors" :key="behavior">
                    {{ behavior }}
                  </li>
                </ul>
              </div>
              <div v-if="brief.intent" class="intent-card">
                <small>ORIGINAL INTENT</small>
                <p>{{ brief.intent }}</p>
              </div>
              <div class="story-facts">
                <div>
                  <small>SURFACES</small>
                  <ul class="fact-values">
                    <li v-for="area in brief.story.areas" :key="area">
                      <code :aria-label="area" :title="area">{{
                        readableIdentifier(area)
                      }}</code>
                    </li>
                  </ul>
                </div>
                <div v-if="brief.story.symbols.length">
                  <small>NEW OR CHANGED SYMBOLS</small>
                  <ul class="fact-values">
                    <li v-for="symbol in brief.story.symbols" :key="symbol">
                      <code :aria-label="symbol" :title="symbol">{{
                        readableIdentifier(symbol)
                      }}</code>
                    </li>
                  </ul>
                </div>
                <div>
                  <small>TEST STATUS</small>
                  <p>{{ brief.story.testStatus }}</p>
                </div>
              </div>
              <h3>FILES CHANGED</h3>
              <button
                v-for="file in brief.diff.files"
                :key="file.path"
                :title="file.path"
                :aria-label="`Review ${file.path}, ${file.added} additions and ${file.removed} deletions`"
                :class="[
                  'changed-file',
                  { active: activePatch?.path === file.path },
                ]"
                @click="selectReviewFile(file.path)"
              >
                <span class="change-file-icon" aria-hidden="true">‹›</span
                ><span
                  ><strong>{{ basename(file.path) }}</strong
                  ><small>{{ directory(file.path) }}</small></span
                ><em aria-hidden="true"
                  ><b>+{{ file.added }}</b
                  ><i>−{{ file.removed }}</i></em
                >
              </button>
              <h3>RISK SIGNALS</h3>
              <ul class="signal-list compact">
                <li v-for="signal in brief.signals" :key="signal">
                  {{ signal }}
                </li>
                <li v-if="!brief.signals.length">
                  No structural warning signals. Verify behavior, not just
                  shape.
                </li>
              </ul>
            </aside>

            <button
              type="button"
              class="ownership-resizer ownership-resizer-left"
              role="separator"
              aria-label="Resize change briefing panel"
              aria-orientation="vertical"
              :aria-valuemin="260"
              :aria-valuemax="520"
              :aria-valuenow="ownershipLeftWidth"
              title="Drag to resize change briefing panel"
              @pointerdown.prevent="beginOwnershipPanelResize('left', $event)"
              @keydown.left.prevent="resizeOwnershipPanelBy('left', -20)"
              @keydown.right.prevent="resizeOwnershipPanelBy('left', 20)"
              @dblclick="setOwnershipPanelWidth('left', 360)"
            ></button>

            <section class="evidence-pane diff-workspace">
              <div class="diff-toolbar">
                <div class="file-stepper">
                  <button
                    @click="moveReviewFile(-1)"
                    aria-label="Previous file"
                  >
                    ‹
                  </button>
                  <div>
                    <strong>{{ activePatch?.path ?? "Diff evidence" }}</strong
                    ><small v-if="activeReviewMeta"
                      >{{ activeReviewMeta.added }} additions ·
                      {{ activeReviewMeta.removed }} deletions · file
                      {{ activePatchIndex + 1 }} of
                      {{ parsedPatch.length }}</small
                    >
                  </div>
                  <button @click="moveReviewFile(1)" aria-label="Next file">
                    ›
                  </button>
                </div>
                <div class="diff-options">
                  <button
                    :class="{ active: diffMode === 'unified' }"
                    @click="diffMode = 'unified'"
                  >
                    Unified</button
                  ><button
                    :class="{ active: diffMode === 'split' }"
                    @click="diffMode = 'split'"
                  >
                    Split</button
                  ><button
                    :class="{ active: wrapDiff }"
                    @click="wrapDiff = !wrapDiff"
                  >
                    Wrap
                  </button>
                </div>
              </div>
              <div
                v-if="activePatch && diffMode === 'unified'"
                :class="['semantic-diff', { wrap: wrapDiff }]"
                aria-label="Unified code diff"
              >
                <div
                  v-for="(line, index) in activePatch.lines"
                  :key="index"
                  :class="['diff-line', line.kind]"
                >
                  <span class="gutter old">{{ line.oldLine ?? "" }}</span
                  ><span class="gutter new">{{ line.newLine ?? "" }}</span
                  ><span class="marker">{{
                    line.kind === "add"
                      ? "+"
                      : line.kind === "delete"
                        ? "−"
                        : line.kind === "context"
                          ? " "
                          : ""
                  }}</span
                  ><code
                    ><span
                      v-for="(token, tokenIndex) in tokenizeLine(
                        line.text,
                        activePatch.path,
                      )"
                      :key="tokenIndex"
                      :class="`syntax-${token.kind}`"
                      >{{ token.text }}</span
                    ></code
                  >
                </div>
              </div>
              <div
                v-else-if="activePatch"
                :class="['split-diff', { wrap: wrapDiff }]"
                aria-label="Side-by-side code diff"
              >
                <template
                  v-for="(line, index) in activePatch.lines"
                  :key="index"
                  ><div
                    v-if="line.kind === 'hunk' || line.kind === 'meta'"
                    :class="['split-special', line.kind]"
                  >
                    {{ line.text }}
                  </div>
                  <div v-else class="split-row">
                    <div
                      :class="[
                        'split-cell',
                        line.kind === 'delete'
                          ? 'delete'
                          : line.kind === 'context'
                            ? 'context'
                            : 'empty',
                      ]"
                    >
                      <span class="gutter">{{
                        line.kind !== "add" ? line.oldLine : ""
                      }}</span
                      ><span class="marker">{{
                        line.kind === "delete" ? "−" : " "
                      }}</span
                      ><code
                        ><template v-if="line.kind !== 'add'"
                          ><span
                            v-for="(token, tokenIndex) in tokenizeLine(
                              line.text,
                              activePatch.path,
                            )"
                            :key="tokenIndex"
                            :class="`syntax-${token.kind}`"
                            >{{ token.text }}</span
                          ></template
                        ></code
                      >
                    </div>
                    <div
                      :class="[
                        'split-cell',
                        line.kind === 'add'
                          ? 'add'
                          : line.kind === 'context'
                            ? 'context'
                            : 'empty',
                      ]"
                    >
                      <span class="gutter">{{
                        line.kind !== "delete" ? line.newLine : ""
                      }}</span
                      ><span class="marker">{{
                        line.kind === "add" ? "+" : " "
                      }}</span
                      ><code
                        ><template v-if="line.kind !== 'delete'"
                          ><span
                            v-for="(token, tokenIndex) in tokenizeLine(
                              line.text,
                              activePatch.path,
                            )"
                            :key="tokenIndex"
                            :class="`syntax-${token.kind}`"
                            >{{ token.text }}</span
                          ></template
                        ></code
                      >
                    </div>
                  </div></template
                >
              </div>
              <div v-else class="missing-evidence">
                <strong>Patch evidence unavailable</strong
                ><span
                  >This capture predates evidence storage. Use Git history and
                  the file list.</span
                >
              </div>
            </section>

            <button
              type="button"
              class="ownership-resizer ownership-resizer-right"
              role="separator"
              aria-label="Resize review panel"
              aria-orientation="vertical"
              :aria-valuemin="340"
              :aria-valuemax="620"
              :aria-valuenow="ownershipRightWidth"
              title="Drag to resize review panel"
              @pointerdown.prevent="beginOwnershipPanelResize('right', $event)"
              @keydown.left.prevent="resizeOwnershipPanelBy('right', 20)"
              @keydown.right.prevent="resizeOwnershipPanelBy('right', -20)"
              @dblclick="setOwnershipPanelWidth('right', 460)"
            ></button>

            <aside class="reflection-pane learning-inspector">
              <div class="starting-confidence">
                <span>Starting confidence</span
                ><strong>{{ reviewItem.score ?? "Unrated" }}</strong>
              </div>
              <div v-if="brief.priorNotes.length" class="prior-notes">
                <div>
                  <h3>Earlier review notes</h3>
                  <span>{{ brief.priorNotes.length }} saved</span>
                </div>
                <article v-for="note in brief.priorNotes" :key="note.id">
                  <p>{{ note.text }}</p>
                  <small
                    >{{ new Date(note.ts).toLocaleString() }} ·
                    {{ Math.max(1, Math.round(note.durationMs / 60000)) }}
                    min</small
                  >
                </article>
              </div>
              <div v-if="brief.priorEvidence.length" class="prior-evidence">
                <strong>Previous evidence exists</strong
                ><span
                  >{{ brief.priorEvidence[0].completedCount }}/{{
                    brief.priorEvidence[0].requiredCount
                  }}
                  required answers completed
                  {{ compactDate(brief.priorEvidence[0].ts) }}</span
                >
              </div>
              <section class="coach-card" aria-label="Aperta Coach">
                <header>
                  <div>
                    <span class="coach-mark">a✦</span>
                    <div>
                      <strong>Aperta Coach</strong
                      ><small v-if="coachStatus?.enabled"
                        >{{ coachDebrief?.model ?? coachStatus.model }} ·
                        {{
                          coachDebrief?.provider ?? coachStatus.provider
                        }}</small
                      ><small v-else>Optional, provider-neutral coaching</small>
                    </div>
                  </div>
                  <em>AI-GENERATED</em>
                </header>
                <template v-if="coachDebrief"
                  ><h3>{{ coachDebrief.focus.title }}</h3>
                  <p>{{ coachDebrief.orientation }}</p>
                  <p class="coach-focus">
                    <b>Focus:</b> {{ coachDebrief.focus.why }}
                  </p>
                  <details v-if="coachDebrief.uncertainties.length">
                    <summary>
                      {{ coachDebrief.uncertainties.length }} explicit unknown{{
                        coachDebrief.uncertainties.length === 1 ? "" : "s"
                      }}
                    </summary>
                    <ul>
                      <li
                        v-for="item in coachDebrief.uncertainties"
                        :key="item"
                      >
                        {{ item }}
                      </li>
                    </ul>
                  </details></template
                >
                <template v-else
                  ><p>
                    Generate questions from this diff, its impact, its proof,
                    and your earlier answers. Coach asks questions. It cannot
                    decide whether you understand the code.
                  </p>
                  <button
                    :disabled="!coachStatus?.enabled || coachRunning"
                    @click="personalizeDebrief"
                  >
                    {{
                      coachRunning
                        ? `${coachJob?.state ?? "Starting"} review…`
                        : "Generate review questions"
                    }}</button
                  ><button
                    v-if="coachRunning"
                    class="cancel-job"
                    @click="cancelExecution(coachJob)"
                  >
                    Cancel</button
                  ><small
                    v-if="coachStatus && !coachStatus.enabled"
                    class="coach-disabled"
                    >{{ coachStatus.reason }}</small
                  ></template
                >
                <p v-if="coachError" class="coach-error">{{ coachError }}</p>
                <footer>
                  Uses local evidence · cannot change proof status · never
                  grades your writing
                </footer>
              </section>
              <p class="step-label"><b>3</b> Challenge</p>
              <h3>Explain what you found</h3>
              <div class="evidence-questions">
                <article
                  v-for="question in ownershipQuestions"
                  :key="question.id"
                  :class="{
                    answered: (answers[question.id]?.trim().length ?? 0) >= 20,
                    optional: !question.requiredForOwned,
                  }"
                >
                  <div>
                    <span>{{ question.kind }}</span
                    ><em>{{
                      question.requiredForOwned ? "required" : "optional"
                    }}</em
                    ><button
                      v-if="question.path"
                      @click="showEvidence(question)"
                    >
                      Show code →
                    </button>
                  </div>
                  <label :for="`answer-${question.id}`">{{
                    question.text
                  }}</label
                  ><small
                    v-if="'rationale' in question"
                    class="question-rationale"
                    >{{ question.rationale }}</small
                  ><textarea
                    :id="`answer-${question.id}`"
                    v-model="answers[question.id]"
                    rows="2"
                    placeholder="Answer in your own words…"
                  ></textarea>
                </article>
              </div>
              <p class="step-label articulate"><b>4</b> Explain</p>
              <label for="explanation"
                >Explain the change in your own words</label
              >
              <textarea
                id="explanation"
                v-model="explanation"
                rows="5"
                placeholder="What changed, why it works, and where it could fail…"
              ></textarea>
              <fieldset class="confidence-picker">
                <legend>Where are you now?</legend>
                <button
                  v-for="score in [1, 2, 3]"
                  :key="score"
                  :disabled="score === 3 && !ownershipReady"
                  :title="
                    score === 3 && !ownershipReady
                      ? 'Complete the required ownership evidence first'
                      : ''
                  "
                  :class="{ selected: reviewScore === score }"
                  @click="reviewScore = score as 1 | 2 | 3"
                >
                  <strong>{{ score }}</strong
                  ><span>{{
                    score === 1
                      ? "Opaque"
                      : score === 2
                        ? "Followable"
                        : ownershipReady
                          ? "Owned"
                          : "Prove first"
                  }}</span>
                </button>
              </fieldset>
              <button
                class="finish-review"
                :disabled="reviewSaving"
                @click="saveReview"
              >
                {{ reviewSaving ? "Saving…" : "Save review" }}
              </button>
              <small class="privacy-note"
                >Aperta saves evidence from the review. It never grades your
                writing.</small
              >
            </aside>
          </div>
        </section>
      </div>
      <footer class="statusbar">
        <span
          ><i class="status-dot"></i>Private local memory · outside Git · Coach
          shares evidence only on request</span
        ><span>1 opaque · 2 followable · 3 owned</span
        ><span
          >Updated
          {{
            state
              ? new Date(state.generatedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Not updated"
          }}</span
        >
      </footer>
    </section>
  </main>
</template>
