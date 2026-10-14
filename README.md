# Eve Workbench

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![IWSDK](https://img.shields.io/badge/IWSDK-1.0.0-6f42c1.svg)](https://developers.meta.com/horizon/documentation/web/webxr-iwsdk-overview)
[![Framework: Vite](https://img.shields.io/badge/Framework-Vite-646cff.svg)](https://vite.dev/)

Eve Workbench is a VR AI workspace where you can manage your Eve agent.
The goal is to bring your agent, its tasks, and its progress into a shared
spatial workspace, so you can direct work and keep track of what Eve is doing
from inside VR.

Built on the [Immersive Web SDK](https://developers.meta.com/horizon/documentation/web/webxr-iwsdk-overview)
(IWSDK), TypeScript, and Vite, the app runs in a WebXR-compatible browser and
can be deployed to Vercel.

## Vision

- Manage your Eve agent from a virtual workspace.
- Give Eve tasks and review its progress through spatial panels.
- Keep the context for your work close at hand while collaborating with Eve.

## Current status

The WebXR workspace now includes desktop chat and an in-headset Eve console,
connected through a server-side proxy to a new agent project in `eve-backend/`.
The agent provides a durable task board scoped to each conversation. Connection
credentials and a running backend are required for live responses; see the
[Eve setup and deployment guide](docs/eve-integration.md).

## What's included today

- **Spoken replies** — turn **Voice on** in the browser or headset to hear new
  replies sentence by sentence as they stream. Pick an available device voice
  in the browser. Voice off mutes immediately; restored history stays silent.
  This uses the browser speech service, with no additional API key. Voice
  quality and availability vary by browser and device.
- **Claude-generated panels** — ask Eve to show a comparison, dashboard, or
  chart. The `workbench_panel` tool saves up to six panels per conversation,
  composing text, metric cards, tables, and bar/line charts with follow-up
  buttons. Results appear inline in the chat in both browser and headset. Native chat cards
  preserve complete text and chart data, and buttons send ordinary messages.
- **Independent floating windows** — press **New window** (or **+ Window** in
  XR), then tell Eve what to put there. **Open window** on a generated card opens
  that result separately. You can also ask “Open a graph in a separate window.”
  Up to six windows stay open together. Pinch a window's title to move it, use
  two hands on the title to resize, and **Close** to dismiss it. The chat keeps
  the original result. Desktop windows support title dragging and corner resizing.
- **Eve integrations** — open **Integrations** in the browser or **Apps** in XR.
  Choose **Add integration**, select Notion, Linear, Miro, or Sentry, and continue
  sign-in in your browser. Connected apps are available to Eve on the next turn.
  Connections are shared within this private workspace; credentials stay in
  Vercel Connect. The panel shows real status and supports disconnecting apps.
- **Watch Eve's browser** — desktop and anchored headset screens show actual
  sandbox browser frames, recent actions, and task cancellation. Viewing is
  read-only and requires the Vercel sandbox backend. See the
  [browser viewing guide](docs/browser-watch.md).
- **Live task visualizations with Apache ECharts** — open **Task board** in
  the browser for progress charts and a paged map grouping tasks by status. In
  the headset, choose **Task map** or **Progress** on Eve's console, and use
  **Read task list** for full titles with text pagination. These views use the
  existing Eve task-board events and show an empty state until a plan has tasks.
  Chart code loads on demand, and redraws happen when task data or the selected
  view changes. Map connections show status membership.
- **Eve integration** — shared browser/XR conversations, streamed replies,
  session replay and reconnects, task-board results, approval options, and task
  cancellation. A Vercel Node Function keeps backend credentials server-side.
- **New Eve backend** — instructions, model configuration, authenticated HTTP
  channel, a typed durable task-board tool, and local/Vercel sandbox selection.
- **An original library café environment** — oak floors, a timber-and-glass
  roof, bookshelves, a coffee counter, a reading nook, and a surrounding garden.
  `iwsdk.config.json` selects `public/scenes/cafe.iwsdk.scene.json`; the original
  desk scene remains at `public/scenes/main.iwsdk.scene.json`. Static geometry
  lives in `src/scene-assets/cafe.scene-asset.ts`, with repeated details instanced
  and a separate continuous walkable floor. The robot, demo cube, plant, and
  inline conversation cards are retained in the café.
- **A VR desk scene** — environment, robot, plant, a grabbable demo cube, a
  spatial welcome panel and a controller-input HUD, composed declaratively in
  `public/scenes/main.iwsdk.scene.json`.
- **Controller mapping** — `ControllerInputSystem` maps the right A/B buttons to
  scale, left X to cycle color and left Y to reset, and mirrors live button,
  trigger, grip and thumbstick state onto the HUD panel.
- **Manifest-first project layout** — `iwsdk.config.json` is the single authority
  for the active scene, asset catalog, component catalog, XR mode and world
  features.
- **Hand and gaze tracking** — `iwsdk.config.json` requests the `handTracking`
  and `gazeTracking` XR features and enables the `gaze` world feature, so both
  are on in-session without any app code.
- **XR emulation without a headset** — IWER lets any browser enter an emulated
  Quest 3 session on the dev server, including the v0 sandbox preview. See
  [XR emulation](#xr-emulation) for how it is gated.
- **Agent guidance** for v0, Claude Code, Cursor and Copilot, synced from the
  upstream IWSDK guidance in `facebook/immersive-web-sdk`.

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser to see the
result, then click **Enter XR** to start an emulated immersive session. You can
start editing the scene by modifying `public/scenes/main.iwsdk.scene.json`, or
the systems that drive it under `src/`. The page auto-updates as you edit.

`npm run dev` is the IWSDK managed dev server (`iwsdk dev restart --foreground`),
and the one script v0 starts on your behalf. It serves the app the way Vite does
and additionally hosts the MCP command bridge behind the scene editor and the
scene/ECS/XR tooling. There is no `--open`, so it does not launch the managed
browser on boot — the first MCP or CLI command starts it lazily.

A `predev` hook runs `scripts/setup-browser-deps.mjs` first. That script installs
the system libraries managed Chromium needs inside the Fedora-based v0 sandbox,
and exits immediately on every other platform.

Two companion scripts drive that server's lifecycle:

```bash
npm run dev:status
npm run dev:down
```

For plain Vite with none of the managed infrastructure — the mode `vercel dev`
expects — use the runtime-only script:

```bash
npm run dev:runtime   # vite
```

Run only one of the two at a time: `npm run dev:down` first if a managed server
already holds the port.

Optional one-time setup for the semantic code-reference MCP tools:

```sh
npm run reference:warmup
```

Before testing anything, typecheck. Type errors stop systems from initialising
without necessarily logging to the console:

```sh
npm run typecheck
```

## Project structure

```
iwsdk.config.json                 project authority: scene, assets, components, world, dev
vercel.json                       framework, output directory and SPA rewrite
src/
  index.ts                        World.create() + explicit system registration
  assets.ts                       defineAssets() — catalog shared by runtime and editor
  components.ts                   defineComponents() — catalog shared by runtime and editor
  robot-component.ts              Robot tag component
  robot.ts                        RobotSystem — look-at behavior and click audio
  demo-cube-component.ts          DemoCube tag component and its color palette
  input.ts                        ControllerInputSystem — face buttons and HUD mirroring
  panel.ts                        PanelSystem — Enter XR / Exit to Browser wiring
  scene-assets/                   *.scene-asset.ts — parentless Object3D prototypes
public/
  scenes/main.iwsdk.scene.json    composition only — manifest IDs, transforms, components
  ui/*.uikitml                    runtime-loaded panels
  gltf/ audio/ textures/          static assets
scripts/
  setup-browser-deps.mjs          predev — managed-browser system libs for the v0 sandbox
```

Composition lives in JSON; geometry, materials and URLs live in TypeScript. Scene
JSON references assets only by manifest ID.

## Using this project in v0

Open the repository in [v0](https://v0.app/) and it runs in a Vercel Sandbox: a
real Node.js VM with a framework-aware dev server, a terminal and Claude Code
pre-installed. v0 detects Vite, starts `npm run dev` itself, and proxies the
result through a generated HTTPS hostname — a secure context, which is what
WebXR requires. That script starts the managed dev server rather than bare Vite;
it serves the app on the same port, and its `predev` hook prepares the sandbox
for the managed browser the agent tooling drives.

To point a fresh chat at your own copy, fork this repository and give v0 the fork
URL. Agent guidance is already wired up: `AGENTS.md` at the root, path-scoped
detail in `src/AGENTS.md`, `public/ui/AGENTS.md` and `public/scenes/AGENTS.md`,
and skill procedures under `.claude/skills/` mirrored into `.agents/skills/`.

## Deploy on Vercel

The easiest way to deploy is to import the repository into
[Vercel](https://vercel.com/new), or run `vercel` from the project root.

`vercel.json` selects the Vite framework preset, builds to `dist/`, sends
`Permissions-Policy: xr-spatial-tracking=*` so WebXR is allowed, and rewrites
unmatched paths to `/index.html`. Static files under `public/` still win, because
Vercel checks the filesystem before applying rewrites.

WebXR requires a secure context. The deployed HTTPS URL and `http://localhost`
both qualify; a plain-HTTP LAN address does not. To test on a physical headset
against your dev machine, run `IWSDK_DEV_HTTPS=1 npm run dev` and accept the
self-signed certificate on the device.

To deploy under a subpath, set `VITE_BASE_PATH` at build time.

## XR emulation

IWER is not part of the app bundle by default — `@iwsdk/vite-plugin-dev` injects
it, and two separate gates decide whether it reaches the page. Both are set in
`iwsdk.config.json` under `dev.emulator`, which is the project authority for this;
the plugin rejects the same options passed to `iwsdkDev()` in `vite.config.ts`.

| Gate            | Default     | Effect of the default                                            |
| --------------- | ----------- | ---------------------------------------------------------------- |
| `injectOnBuild` | `false`     | `vite build` emits no emulator, so deploys have nothing to run   |
| `activation`    | `localhost` | the injected runtime stays inert on any non-localhost hostname   |

The default `activation` is the one that bites in practice: the dev server always
injects IWER, but a v0 preview is served from a generated `*.v0.build` hostname
(older sandboxes used `*.vusercontent.net`), so the runtime loads and then sits
inert. This template widens `activation` to cover the hostnames a preview
actually uses:

```jsonc
"dev": {
  "emulator": {
    "device": "metaQuest3",
    "activation": {
      "source": "^(localhost|127\\.0\\.0\\.1|.*\\.vercel\\.app|.*\\.vusercontent\\.net|.*\\.v0\\.build)$"
    }
  }
}
```

The pattern is matched against `location.hostname` alone — no scheme, port or
path — so each term is a bare host suffix. v0 has renamed its preview domain
before; if it happens again, add a term here rather than widening to `.*`.

A regex is an object here (`{ source, flags }`), not a `/.../` string. On a real
headset IWER steps aside regardless, via the default `userAgentException` of
`/OculusBrowser/`.

`injectOnBuild` is deliberately left at its default. Emulating a headset is a
development affordance, and injecting the runtime adds roughly 1 MB to the
production bundle — a cost every visitor pays, including on domains where
`activation` returns false. The consequence is that **a deployed build ships no
emulator**: `npm run dev` and the v0 sandbox get IWER, a `vercel deploy` does
not. Set `injectOnBuild: true` if you want deploys emulated too; the
`.vercel.app` term in `activation` is there for that case and is otherwise inert.

## Notes

- Import Three.js classes from `@iwsdk/core`, never from `three` — a direct
  `three` import creates a duplicate instance and subtle breakage.
- `@iwsdk/vite-plugin-dev` depends on Playwright, so the first `npm install` in a
  fresh sandbox downloads Chromium, and `predev` installs the system libraries it
  needs to launch. Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to skip the download
  when you only need to build — CI does exactly that.
- `package-lock.json` is committed, so `npm ci` reproduces the dependency tree
  exactly. Regenerate it with `npm install` whenever you change `package.json`.

## Learn More

- [Immersive Web SDK documentation](https://developers.meta.com/horizon/documentation/web/webxr-iwsdk-overview)
- [`facebook/immersive-web-sdk`](https://github.com/facebook/immersive-web-sdk) —
  the upstream repository this template's agent guidance is synced from
- [v0 documentation](https://v0.app/docs)
- [Vite documentation](https://vite.dev/) and the
  [Vercel Vite preset](https://vercel.com/docs/frameworks/vite)
- [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the
full text.

Note that IWSDK itself is MIT-licensed; this template's Apache-2.0 terms cover
the template's own source, not its dependencies.
