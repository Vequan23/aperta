<script setup lang="ts">
import { computed } from "vue";
type OwnershipDossier = {
  schemaVersion: 1;
  id: string;
  diffId: string;
  repository: string;
  branch: string;
  capturedAt: string;
  generatedAt: string;
  revision: { commitSha?: string; fingerprint?: string; baseTree?: string; resultTree?: string };
  status: "needs-defense" | "defended" | "proven" | "stale" | "regressed";
  title: string;
  intent: string | null;
  risk: "low" | "medium" | "high";
  behaviors: string[];
  files: Array<{ path: string; added: number; removed: number; hunks: number }>;
  evidence: Array<{ id: string; label: string; kind: "code" | "test" | "proof" | "human"; path?: string; detail: string }>;
  defense: {
    completed: boolean;
    completedAt: string | null;
    confidence: 1 | 2 | 3 | null;
    statement: string | null;
    answers: Array<{ kind: string; question: string; answer: string; path?: string }>;
  };
  uncertainty: string[];
  freshness: {
    status: "current" | "stale" | "regressed";
    checkedAt: string;
    assuredAt: string | null;
    invalidatedAt?: string;
    invalidatedBy?: string;
    invalidatedFiles: string[];
  };
};

const props = defineProps<{ dossier: OwnershipDossier; briefHref: string; theme: "snow" | "panther" | "plain" }>();
defineEmits<{ close: []; defend: [diffId: string]; openFile: [path: string] }>();

function compactDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

function revisionLabel() {
  const value = props.dossier.revision.commitSha ?? props.dossier.revision.resultTree ?? props.dossier.revision.fingerprint ?? props.dossier.diffId;
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function parentPath(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

const osxTheme = computed(() => props.theme === "panther" ? "panther" : props.theme === "plain" ? "graphite" : "aqua");
const recordDescription = computed(() => `${props.dossier.repository} · ${props.dossier.branch} · captured ${compactDate(props.dossier.capturedAt)}`);
const statusTone = computed(() => props.dossier.status === "proven" || props.dossier.status === "defended" ? "success" : props.dossier.status === "stale" || props.dossier.status === "regressed" ? "warning" : "neutral");
</script>

<template>
  <osx-dialog
    :data-osx-theme="osxTheme"
    :open="true"
    :title="dossier.title"
    :description="recordDescription"
    size="large"
    dismissible
    @close="$emit('close')"
  >
    <div class="record">
      <div class="record-kicker">
        <osx-heading :level="3" variant="label" tone="muted">Ownership record</osx-heading>
        <div class="record-badges">
          <osx-badge :tone="statusTone" :label="dossier.status.replace('-', ' ')" dot />
          <osx-badge tone="neutral" :label="`${dossier.evidence.length} source${dossier.evidence.length === 1 ? '' : 's'}`" />
          <osx-badge :tone="dossier.risk === 'high' ? 'danger' : dossier.risk === 'medium' ? 'warning' : 'neutral'" :label="`${dossier.risk} risk`" />
        </div>
      </div>

      <osx-alert
        v-if="dossier.freshness.status !== 'current'"
        tone="warning"
        title="This record needs another look"
        :description="dossier.freshness.invalidatedBy ?? 'Later code changed its supporting evidence.'"
      />

      <div class="record-grid">
        <main>
          <section>
            <osx-heading :level="3" variant="label" tone="muted">What changed</osx-heading>
            <osx-copy size="large">{{ dossier.intent ?? 'No original intent was recorded.' }}</osx-copy>
            <ul><li v-for="behavior in dossier.behaviors" :key="behavior">{{ behavior }}</li></ul>
          </section>

          <section>
            <div class="section-heading">
              <div><osx-heading :level="3" variant="label" tone="muted">Evidence</osx-heading><osx-heading :level="3" variant="section">What supports this record</osx-heading></div>
            </div>
            <div class="evidence-list">
              <article v-for="item in dossier.evidence" :key="item.id">
                <osx-badge :tone="item.kind === 'proof' || item.kind === 'human' ? 'success' : 'info'" :label="item.kind" size="small" />
                <div><strong>{{ item.label }}</strong><osx-copy size="small" tone="muted">{{ item.detail }}</osx-copy><osx-button v-if="item.path" size="small" icon="file-code" @click="$emit('openFile', item.path)">{{ item.path }}</osx-button></div>
              </article>
            </div>
          </section>

          <section>
            <osx-heading :level="3" variant="label" tone="muted">Engineer defense</osx-heading>
            <osx-heading :level="3" variant="section">{{ dossier.defense.completed ? 'A defense is on record' : 'This change still needs a defense' }}</osx-heading>
            <blockquote v-if="dossier.defense.statement">{{ dossier.defense.statement }}</blockquote>
            <div v-if="dossier.defense.answers.length" class="answer-list"><article v-for="answer in dossier.defense.answers" :key="`${answer.kind}:${answer.question}`"><strong>{{ answer.kind }}</strong><osx-copy size="small" tone="muted">{{ answer.answer }}</osx-copy></article></div>
            <osx-button v-else variant="primary" icon="check" @click="$emit('defend', dossier.diffId)">Defend this change</osx-button>
          </section>
        </main>

        <aside>
          <section>
            <osx-heading :level="3" variant="label" tone="muted">Revision</osx-heading>
            <dl>
              <div><dt>Freshness</dt><dd>{{ dossier.freshness.status }}</dd></div>
              <div><dt>Last assured</dt><dd>{{ compactDate(dossier.freshness.assuredAt) }}</dd></div>
              <div><dt>Revision</dt><dd><code :title="dossier.revision.commitSha ?? dossier.revision.resultTree ?? dossier.revision.fingerprint ?? dossier.diffId">{{ revisionLabel() }}</code></dd></div>
            </dl>
          </section>
          <section>
            <osx-heading :level="3" variant="label" tone="muted">Files</osx-heading>
            <div class="file-list">
              <article v-for="file in dossier.files" :key="file.path" class="file-entry">
                <div>
                  <osx-copy size="small"><strong>{{ fileName(file.path) }}</strong></osx-copy>
                  <osx-copy v-if="parentPath(file.path)" size="small" tone="muted">{{ parentPath(file.path) }}</osx-copy>
                  <osx-copy size="small" tone="muted">+{{ file.added }} / -{{ file.removed }}</osx-copy>
                </div>
                <osx-button size="small" icon="file-code" :aria-label="`Open ${file.path}`" @click="$emit('openFile', file.path)">Open</osx-button>
              </article>
            </div>
          </section>
          <section>
            <osx-heading :level="3" variant="label" tone="muted">Open questions</osx-heading>
            <ul class="unknowns"><li v-for="item in dossier.uncertainty" :key="item">{{ item }}</li></ul>
            <osx-copy v-if="!dossier.uncertainty.length" size="small" tone="muted">No open questions are recorded.</osx-copy>
          </section>
        </aside>
      </div>
    </div>

    <div slot="actions" class="record-actions">
      <osx-link :href="briefHref" download underline="none">Download change brief</osx-link>
      <osx-button @click="$emit('close')">Close</osx-button>
    </div>
  </osx-dialog>
</template>

<style scoped>
osx-dialog { display: block; }
.record { display: grid; gap: 14px; color: var(--osx-text); font-family: var(--osx-font); }
.record-kicker,.record-badges,.record-actions { display: flex; align-items: center; gap: 7px; }.record-kicker { justify-content: space-between; }.record-badges { flex-wrap: wrap; justify-content: flex-end; }.record-actions { justify-content: flex-end; }
.record-grid { display: grid; grid-template-columns: minmax(0,1fr) 218px; margin: 0 -20px -20px; border-top: 1px solid var(--osx-border-soft); }
.record-grid main { padding: 18px 20px 20px; }.record-grid main > section + section { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--osx-border-soft); }
.record-grid aside { padding: 18px 16px; border-left: 1px solid var(--osx-border-soft); background: var(--osx-surface-sunken); }.record-grid aside section + section { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--osx-border-soft); }
.record-grid osx-copy { display: block; margin-top: 7px; }.record-grid ul { margin: 9px 0 0; padding-left: 18px; color: var(--osx-muted); font-size: 12px; line-height: 1.45; }.record-grid li + li { margin-top: 5px; }
.section-heading { display: flex; justify-content: space-between; margin-bottom: 9px; }.section-heading osx-heading { display: block; margin-top: 3px; }
.evidence-list,.answer-list { display: grid; gap: 8px; }.evidence-list article { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 9px; align-items: start; padding: 10px; border: 1px solid var(--osx-border-soft); border-radius: 7px; background: var(--osx-surface-raised); }.evidence-list strong { font-size: 12px; }.evidence-list osx-button { max-width: 100%; margin-top: 7px; }
blockquote { margin: 9px 0 0; padding: 11px 13px; border-left: 3px solid var(--osx-accent); background: var(--osx-surface-sunken); font-size: 12px; line-height: 1.5; }.answer-list article { padding: 8px 0; border-bottom: 1px solid var(--osx-border-soft); }.answer-list strong { font-size: 12px; text-transform: capitalize; }.record-grid main > section > osx-button { margin-top: 11px; }
dl { margin: 7px 0 0; } dl div { display: grid; gap: 3px; padding: 7px 0; border-bottom: 1px solid var(--osx-border-soft); font-size: 12px; } dt { color: var(--osx-muted); } dd { margin: 0; overflow-wrap: anywhere; } dd code { font-size: 12px; }
.file-list { display: grid; gap: 7px; margin-top: 7px; }.file-entry { display: grid; gap: 7px; align-items: start; padding-bottom: 7px; border-bottom: 1px solid var(--osx-border-soft); }.file-entry osx-copy { margin-top: 0; overflow-wrap: break-word; }.file-entry osx-copy + osx-copy { margin-top: 3px; }.file-entry osx-button { justify-self: start; }.unknowns { font-size: 12px; }
@media (max-width: 680px) { .record-kicker { align-items: flex-start; flex-direction: column; }.record-badges { justify-content: flex-start; }.record-grid { grid-template-columns: 1fr; }.record-grid aside { border-top: 1px solid var(--osx-border-soft); border-left: 0; } }
</style>
