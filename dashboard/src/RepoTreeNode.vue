<script setup lang="ts">
import { ref } from "vue";

export type TreeNode = { name: string; path: string; type: "directory" | "file"; children: TreeNode[]; score: number | null; changed: boolean };
const props = defineProps<{ node: TreeNode; selectedPath: string; depth?: number }>();
const emit = defineEmits<{ select: [path: string] }>();
const open = ref((props.depth ?? 0) < 2);
</script>

<template>
  <li :class="['repo-tree-node', node.type]">
    <button v-if="node.type === 'directory'" class="tree-directory" :aria-expanded="open" @click="open = !open"><span>{{ open ? '▾' : '▸' }}</span><i>▰</i><strong>{{ node.name }}</strong><small>{{ node.children.length }}</small></button>
    <button v-else :class="['tree-file', { selected: selectedPath === node.path }]" :aria-current="selectedPath === node.path ? 'true' : undefined" :title="node.path" @click="emit('select', node.path)"><span>‹›</span><strong>{{ node.name }}</strong><i v-if="node.changed" class="changed-dot" title="Has captured changes"></i><em :class="node.score === null ? 'unknown' : node.score < 1.67 ? 'danger' : node.score < 2.5 ? 'warning' : 'good'">{{ node.score === null ? 'n/a' : node.score.toFixed(1) }}</em></button>
    <ul v-if="node.type === 'directory' && open"><RepoTreeNode v-for="child in node.children" :key="child.path" :node="child" :selected-path="selectedPath" :depth="(depth ?? 0) + 1" @select="emit('select', $event)" /></ul>
  </li>
</template>
