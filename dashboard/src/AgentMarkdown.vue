<script setup lang="ts">
import { computed } from "vue";
import { languagePath, parseMarkdown, renderInlineMarkdown } from "./markdown.ts";
import { tokenizeLine } from "./syntax.ts";

const props = defineProps<{ source: string }>();
const blocks = computed(() => parseMarkdown(props.source));
</script>

<template>
  <div class="agent-markdown">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <component
        :is="`h${Math.min(block.level + 2, 6)}`"
        v-if="block.type === 'heading'"
        v-html="renderInlineMarkdown(block.text)"
      />
      <p
        v-else-if="block.type === 'paragraph'"
        v-html="renderInlineMarkdown(block.text)"
      ></p>
      <blockquote
        v-else-if="block.type === 'quote'"
        v-html="renderInlineMarkdown(block.text)"
      ></blockquote>
      <hr v-else-if="block.type === 'rule'" />
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'">
        <li
          v-for="(item, itemIndex) in block.items"
          :key="itemIndex"
          v-html="renderInlineMarkdown(item)"
        ></li>
      </component>
      <figure v-else-if="block.type === 'code'" class="agent-code-block">
        <figcaption v-if="block.language">{{ block.language }}</figcaption>
        <pre tabindex="0"><code><span v-for="(line, lineIndex) in block.lines" :key="lineIndex" class="agent-code-line"><span class="agent-code-line-number" aria-hidden="true">{{ lineIndex + 1 }}</span><span><span v-for="(token, tokenIndex) in tokenizeLine(line, languagePath(block.language))" :key="tokenIndex" :class="`syntax-${token.kind}`">{{ token.text }}</span></span></span></code></pre>
      </figure>
    </template>
  </div>
</template>
