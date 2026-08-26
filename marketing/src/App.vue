<script setup lang="ts">
import { ref } from "vue";
import {
  ArrowRight, BookOpenCheck, BrainCircuit, Check, ChevronRight, CircleDot,
  Code2, Eye, FileCode2, GitBranch, GitFork, LockKeyhole,
  Network, ShieldCheck, Sparkles, SquareTerminal, Zap,
} from "@lucide/vue";

const panther = ref(false);
const menuOpen = ref(false);

const workflow = [
  { number: "01", title: "Capture changes", text: "Watch staged, unstaged, human, and agent-written changes through Git.", icon: Eye },
  { number: "02", title: "Run checks", text: "Connect each change to tests, runtime checks, files, tools, and their output.", icon: ShieldCheck },
  { number: "03", title: "Review the proof", text: "Trace the diff through real code and evidence. Write the explanation in your own words.", icon: BrainCircuit },
  { number: "04", title: "Keep ownership", text: "Save what is proven, understood, stale, or still unknown in private project memory.", icon: Network },
];

const providers = ["OpenAI", "Anthropic", "Google", "DeepSeek", "OpenRouter", "Groq", "Ollama", "LM Studio"];
const runtimes = ["Aperta Native", "Claude Code", "OpenCode", "Cursor"];
</script>

<template>
  <div :class="['site-shell', { panther }]" :data-osx-theme="panther ? 'panther' : 'aqua'">
    <header class="site-nav">
      <a class="brand" href="#top" aria-label="Aperta home"><span class="brand-mark">a</span><span>aperta</span></a>
      <osx-icon-button class="menu-button" :icon="menuOpen ? 'close' : 'menu'" label="Toggle navigation" size="small" :pressed="menuOpen" @click="menuOpen = !menuOpen" />
      <nav :class="{ open: menuOpen }" aria-label="Primary navigation">
        <a href="#product" @click="menuOpen = false">Product</a>
        <a href="#proof" @click="menuOpen = false">Proof graph</a>
        <a href="#integrations" @click="menuOpen = false">Integrations</a>
        <a href="#privacy" @click="menuOpen = false">Privacy</a>
      </nav>
      <div class="nav-actions">
        <osx-tooltip :text="panther ? 'Use Aqua theme' : 'Use Panther theme'">
          <osx-icon-button icon="palette" :label="panther ? 'Use Aqua theme' : 'Use Panther theme'" size="small" @click="panther = !panther" />
        </osx-tooltip>
        <osx-link class="nav-github" href="https://github.com/Vequan23/aperta" target="_blank" rel="noreferrer" external>GitHub</osx-link>
      </div>
    </header>

    <main id="top">
      <section class="hero section-wrap">
        <div class="hero-copy">
          <p class="eyebrow"><Sparkles /> Understand the code AI writes</p>
          <h1>Own the code<br /><em>AI writes.</em></h1>
          <p class="hero-lede">Aperta captures each code change, runs project checks, connects claims to evidence, and helps you explain the result before it reaches your main branch.</p>
          <div class="hero-actions">
            <a class="aqua-button primary" href="https://www.npmjs.com/package/aperta-cli" target="_blank" rel="noreferrer"><GitFork /> Install Aperta</a>
            <a class="aqua-button secondary" href="#product">See the workflow <ArrowRight /></a>
          </div>
          <div class="trust-row"><osx-badge tone="success" label="Open source" dot /><osx-badge tone="info" label="Runs locally" dot /><osx-badge tone="success" label="Use your model" dot /></div>
        </div>

        <div class="hero-product" aria-label="Aperta product preview">
          <osx-window class="hero-window" title="aperta" subtitle="Code ownership">
            <osx-icon slot="accessory" name="activity" :size="16" label="Watching repository" />
            <osx-toolbar slot="toolbar" label="Repository context" compact>
              <span slot="leading" class="repository-context"><osx-icon name="git-branch" :size="15" /> auth-service <b>/ main</b></span>
              <osx-segmented-control slot="trailing" items="Build, Understand" value="Understand" label="Workspace mode" />
            </osx-toolbar>
            <div class="preview-layout">
              <aside>
                <p>REPOSITORY</p>
                <button><FileCode2 /> SecurityConfig.java <span>2.0</span></button>
                <button><FileCode2 /> JwtService.java <span>1.0</span></button>
                <button><FileCode2 /> AuthController.java <span>New</span></button>
                <small><i></i> Watching all changes</small>
              </aside>
              <div class="proof-preview">
                <header><span>BEHAVIORAL PROOF GRAPH</span><b>3 connected claims</b></header>
                <div class="graph-canvas">
                  <svg viewBox="0 0 620 310" role="img" aria-label="Proof graph connecting a behavior claim to code, tests, and human understanding">
                    <path d="M310 146 L135 74 M310 146 L500 70 M310 146 L135 244 M310 146 L500 244" />
                    <g class="node file" transform="translate(58 34)"><rect width="154" height="72" rx="10"/><text x="18" y="28">CODE</text><text x="18" y="52">SecurityConfig.java</text></g>
                    <g class="node proof" transform="translate(422 30)"><rect width="155" height="78" rx="10"/><text x="18" y="28">EXECUTED PROOF</text><text x="18" y="53">42 tests passed</text></g>
                    <g class="node ownership" transform="translate(44 208)"><rect width="182" height="72" rx="10"/><text x="18" y="28">UNDERSTANDING</text><text x="18" y="52">3 / 3 demonstrated</text></g>
                    <g class="node risk" transform="translate(420 208)"><rect width="164" height="72" rx="10"/><text x="18" y="28">UNPROVEN</text><text x="18" y="52">token rotation</text></g>
                    <g class="node claim" transform="translate(230 111)"><rect width="166" height="76" rx="12"/><text x="83" y="29" text-anchor="middle">BEHAVIOR CLAIM</text><text x="83" y="54" text-anchor="middle">JWT is validated</text></g>
                  </svg>
                </div>
                <div class="proof-status"><osx-icon name="check" :size="24" label="Evidence status" /><span><strong>Followable</strong> Evidence exists. One behavioral path remains unproven.</span><osx-badge tone="warning" label="2.0" /></div>
              </div>
            </div>
            <osx-status-bar slot="footer" label="Repository evidence connected" status="ready" detail="3 claims" />
          </osx-window>
          <div class="floating-card left"><Zap /><span><b>Every change captured</b>Human or agent. Staged or unstaged.</span></div>
          <div class="floating-card right"><BookOpenCheck /><span><b>Your review is saved</b>Understanding survives the session.</span></div>
        </div>
      </section>

      <section class="signal-strip" aria-label="Aperta principles">
        <div><span>01</span><p><strong>Check the claim.</strong> An agent saying “done” is not evidence.</p></div>
        <div><span>02</span><p><strong>Review the patch.</strong> Working code is not always understood code.</p></div>
        <div><span>03</span><p><strong>Save what you learn.</strong> Use the evidence again when the code changes.</p></div>
      </section>

      <section id="product" class="section-wrap product-section">
        <div class="section-heading"><p class="eyebrow"><Code2 /> From patch to ownership</p><h2>Review AI-written code<br />before you depend on it.</h2><p>Your agent writes the patch. Aperta captures the change, runs checks, shows the missing proof, and records your review.</p></div>
        <div class="workflow-grid"><article v-for="item in workflow" :key="item.number"><span>{{ item.number }}</span><component :is="item.icon" /><h3>{{ item.title }}</h3><p>{{ item.text }}</p></article></div>
      </section>

      <section id="proof" class="proof-section">
        <div class="section-wrap split-section">
          <div class="proof-copy">
            <p class="eyebrow"><Network /> The proof graph</p><h2>See what changed and what proves it.</h2>
            <p>Aperta connects each behavior claim to its code, checks, review history, and later changes that make old evidence stale.</p>
            <ul>
              <li><span><Check /></span><div><strong>Know what passed</strong><p>Separate executed checks from code analysis and model confidence.</p></div></li>
              <li><span><Check /></span><div><strong>See stale evidence</strong><p>When connected code changes, Aperta marks old evidence stale.</p></div></li>
              <li><span><Check /></span><div><strong>Find what is missing</strong><p>Focus on behavior that is risky, untested, or not yet understood.</p></div></li>
            </ul>
          </div>
          <osx-window class="memory-window" data-osx-theme="panther" title="Repository Memory" subtitle="Proof graph">
            <osx-icon slot="accessory" name="activity" :size="17" label="Connected evidence" />
            <osx-toolbar slot="toolbar" label="Behavior claims" compact>
              <span slot="leading" class="memory-label">BEHAVIOR CLAIMS</span>
              <osx-badge slot="trailing" tone="info" label="12 connected files" />
            </osx-toolbar>
            <div class="claim-list">
              <article><i class="green"></i><div><small>PROVEN</small><strong>Expired access tokens are rejected</strong><p>SecurityConfig.java · JwtConfigurationTests.java</p></div><span>3 proofs</span></article>
              <article><i class="blue"></i><div><small>UNDERSTOOD</small><strong>Refresh tokens rotate after use</strong><p>JwtService.java · ownership review</p></div><span>3 / 3</span></article>
              <article><i class="amber"></i><div><small>STALE</small><strong>Issuer validation matches configuration</strong><p>Invalidated by application.yml change</p></div><span>Aug 23</span></article>
              <article><i></i><div><small>UNPROVEN</small><strong>Concurrent refresh attempts are safe</strong><p>No executed evidence attached</p></div><span>Review</span></article>
            </div>
            <osx-status-bar slot="footer" label="Memory current" status="ready" detail="4 claims" />
          </osx-window>
        </div>
      </section>

      <section id="integrations" class="section-wrap integrations-section">
        <div class="section-heading centered"><p class="eyebrow"><SquareTerminal /> Bring your own AI</p><h2>Use the models and coding agents you already have.</h2><p>Switch providers or coding agents without losing your checks, evidence, and review history.</p></div>
        <div class="integration-panels">
          <article><header><BrainCircuit /><div><small>MODEL APIs</small><h3>Reasoning and coaching</h3></div></header><div class="logo-cloud"><span v-for="provider in providers" :key="provider">{{ provider }}</span></div></article>
          <article><header><SquareTerminal /><div><small>AGENT RUNTIMES</small><h3>Execution and tools</h3></div></header><div class="runtime-list"><span v-for="runtime in runtimes" :key="runtime"><i></i>{{ runtime }}<ChevronRight /></span></div></article>
        </div>
      </section>

      <section id="privacy" class="section-wrap privacy-section">
        <div class="privacy-card">
          <div class="privacy-icon"><LockKeyhole /></div>
          <div><p class="eyebrow">Private by default</p><h2>Your project evidence stays local.</h2><p>Prompts, transcripts, diffs, review answers, and runtime logs stay in private storage outside Git. The repository stores only a project ID.</p></div>
          <div class="privacy-boundary"><span><GitBranch /> Repository</span><code>.comprehension/project.json</code><ArrowRight /><span><LockKeyhole /> Private memory</span><code>~/.aperta/repositories/…</code></div>
        </div>
      </section>

      <section class="ecosystem-placement section-wrap" aria-labelledby="ecosystem-title">
        <div>
          <p class="eyebrow"><GitBranch /> Also from the ecosystem</p>
          <h2 id="ecosystem-title">Once the product works, earn the right attention.</h2>
          <p>Distribution OS finds useful distribution work, prepares a draft, and waits for your approval.</p>
        </div>
        <osx-ecosystem-card
          name="Distribution OS"
          category="Founder distribution"
          description="Find useful conversations, prepare evidence-grounded contributions, and learn what earns trust."
          href="https://distribution-os-murex.vercel.app/"
          action-label="Explore Distribution OS"
          mark="D"
          tone="success"
          tracking-id="aperta-marketing-distribution"
          compact
        ></osx-ecosystem-card>
      </section>

      <section class="final-cta section-wrap"><div><p class="eyebrow"><CircleDot /> Open source · beta</p><h2>Own your next AI-written change.</h2><p>Capture the patch, run the checks, and explain what you plan to maintain.</p></div><a class="aqua-button primary large" href="https://www.npmjs.com/package/aperta-cli" target="_blank" rel="noreferrer"><GitFork /> Install Aperta <ArrowRight /></a></section>
    </main>

    <footer><a class="brand" href="#top"><span class="brand-mark">a</span><span>aperta</span></a><p>Evidence and understanding for AI-written code.</p><div><a href="https://github.com/Vequan23/aperta" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/Vequan23/aperta/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a></div></footer>
  </div>
</template>
