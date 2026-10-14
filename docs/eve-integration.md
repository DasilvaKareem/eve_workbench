# Eve Workbench integration

The existing IWSDK scene selection is retained. New browser controls and a
code-owned spatial console share one Eve conversation through `src/eve-client.ts`.

```text
Desktop chat ──┐
              ├── shared session store ── /api/eve/* ── Eve /eve/v1/*
XR console ────┘                         server proxy    durable workflow
```

The frontend is a Vite app with a Vercel Node Function. `eve-backend/` is a
separate, new Eve agent project. Deploy them as two Vercel projects: the
frontend URL is the headset entry point, and the backend URL is a server-side
environment variable. No framework migration is necessary.

## Local development

Use Node 24. Install each project's dependencies separately:

```sh
npm ci
npm --prefix eve-backend install
```

Copy `.env.example` to `.env.local` at the repository root, and
`eve-backend/.env.example` to `eve-backend/.env.local`. The default local agent
URL is `http://127.0.0.1:2000`. Supply local AI Gateway credentials through
`AI_GATEWAY_API_KEY` in the backend environment, or sign in using the Eve CLI.
The model is configured in `eve-backend/agent/agent.ts`.
Its context-window size is pinned from the AI Gateway catalog so compilation
does not depend on fetching model metadata. Recheck that value when changing
the model.

In one terminal, start the agent:

```sh
npm --prefix eve-backend run dev
```

In another terminal, start the WebXR frontend:

```sh
npm run dev:runtime
```

Open `http://localhost:5173`. The Vite server includes the same `/api/eve/*`
proxy used in production. It reads the root environment files at startup;
restart it after changing credentials. A plain `vite preview` serves only the
built static files and does not start the API proxy.

For editor and XR emulator tools use the starter's managed development mode:

```sh
npm run dev
```

The console reports connection errors if the agent is unavailable. It does not
substitute simulated model replies. Local development permits access without a
workspace code when `WORKBENCH_ACCESS_KEY` is empty. Set it to protect a
development server accessible to other people.

## Deploy the backend

From `eve-backend/`, use Eve's deployment workflow:

```sh
npm run build
npm run deploy
```

Configure `EVE_API_KEY` on the backend Vercel project with a random value at least
32 characters long. Its HTTP channel checks this bearer credential using a
constant-time comparison; the default anonymous production route is not enabled.
Vercel OIDC and Eve's local development authenticator are also supported.

The agent uses Vercel AI Gateway. On Vercel, Eve can use the project's OIDC
credentials for model access. Configure any required Gateway account access in
that Vercel project. The agent provides a conversation-scoped task-board tool
and an authored sandbox browser tool. Other external service integrations are
not configured. Optional built-in shell tools remain disabled.
Enable them deliberately in `agent/agent.ts` when adding broader capabilities.

Local builds use the `just-bash` virtual filesystem, which supports this planning
agent without Docker or microsandbox. Builds running on Vercel select Vercel
Sandbox and prepare a VM snapshot. Build on the deployment target; do not copy a
local `.output/` directory to Vercel.

## Deploy the frontend

Production workspace: https://eve-workbench.vercel.app

Production agent: https://eve-workbench-agent.vercel.app

The projects are deployed directly to the Edesia Vercel account. Automatic
deployments from GitHub require a GitHub login connection on that Vercel account.
The workspace access code is stored locally as `WORKBENCH_ACCESS_KEY` in
`.env.local`; deployment credentials remain server-side.

Deploy the repository root as a separate Vercel project, using its existing Vite
preset and `vercel.json`. Set these **server-only** environment variables:

| Variable | Value |
| --- | --- |
| `EVE_AGENT_URL` | Backend's canonical HTTPS deployment origin, without `/eve/v1`. |
| `EVE_API_KEY` | Same long random secret as the backend. |
| `WORKBENCH_ACCESS_KEY` | A separate private workspace code, at least 8 characters. |

No secret should have a `VITE_` prefix. Unlock the frontend with the workspace
code; the server issues an eight-hour HttpOnly, Secure, SameSite cookie. The
browser never receives the backend credential. This access model is intended
for one owner's personal workspace. A shared multi-user app needs individual
identities and per-user session authorization.

If Vercel Deployment Protection is enabled on the backend, use an endpoint
reachable by the frontend proxy, or configure the appropriate protection access
separately. An Eve API key does not bypass Vercel's deployment protection.

The root API function is `api/eve.mjs`. An explicit rewrite sends every
`/api/eve/*` path to it, preserving nested session and stream routes. SPA fallback routing
excludes `/api/`, so broken API routes return an API failure instead of an HTML
page. Streams have a 270-second upstream timeout beneath the 300-second function
limit; clients reconnect from the absolute event count.

## Browser and headset behavior

- The browser supports custom messages, task-board results, explicit approval
  options, cancellation, new conversations, and connection retry.
- Only the durable session ID is saved in local storage. Reloading replays the
  backend history rather than maintaining a separate local transcript.
- In a headset, the spatial console shows the latest assistant answer with
  Previous/Next paging, three prompt shortcuts, cancellation and exit controls.
  It supports direct pokes, ray selection, reading/near modes, recentering, and
  optional look-and-pinch input. Compose custom messages in the browser. See the
  [Quest 3 controls](quest-3.md); Quest 3 uses head pointing rather than eye tracking.
- Task-board state belongs to the Eve session and survives later turns. Starting
  a new conversation retires the previous session and starts a new board.
- Assistant text appears as streamed deltas in both views. Each completed
  `task_board` result refreshes the list, Progress chart, and Task map while the
  turn is still running. Charts consume complete tool results, not partial tool
  arguments. The backend instructions describe these controls to Claude.
- The `workbench_panel` tool creates, replaces, lists, and removes durable panels.
  Its complete snapshots stream to the browser and native **Eve panels** surface.
  Panels compose text, metrics, tables, bar/line charts, and up to three follow-up
  prompt buttons. Six panels are retained per conversation. Renderers validate
  the same bounded data format and never execute model-authored markup or code.
  Chart data and long text remain fully readable through native page controls.
- **Voice on** enables browser/device speech synthesis for new assistant text.
  Sentences are queued before the turn finishes; final fragments flush at message
  completion. Voice off, task cancellation, new messages, and conversation resets
  stop playback. Restored history remains silent. The browser offers a voice
  selector and Stop reading. Quality and availability depend on the device's
  speech service; this does not provision a neural TTS provider or require a new
  API key. See [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).
  Claude knows these controls through its backend instructions but cannot hear
  playback, select the user's voice, or observe the selected panel.
- **Watch Eve’s browser** on desktop and **Watch browser** in XR show the real
  sandbox browser with a recent-action feed. This needs the Vercel sandbox
  backend, not local just-bash. See [browser viewing](browser-watch.md) for setup,
  frame delivery, controls, and live verification still needed.
- Real-headset WebXR requires HTTPS. The starter also provides local XR
  emulation. It still controls XR mode and features through `iwsdk.config.json`.
- The client explicitly supports the new agent's Eve stream versions 25 and 26;
  older protocols produce a visible compatibility error.

## Verification

On 2026-10-14, frontend and backend type checks, both production builds, and all
52 tests passed. The tests cover stream deltas and UTF-8 boundaries,
reconnect cursors, task/approval projection, proxy credentials, access cookies,
origin checks, the Node HTTP adapter, chart rendering, native panel parsing,
browser frame authentication/session isolation, viewer lifecycle, and tool results.
An integration test holds a fixture stream open and verifies that text and
task-chart data cross the proxy and reach client subscribers before completion.
The new speech and generated-panel implementation adds tests for fresh versus
replayed replies, sentence buffering, stopping, unavailable speech, panel data
validation, chart rendering, and native template parsing. A held-open stream
test also verifies speech sentences and generated panels through the proxy.
These additions pass local builds; production activation and physical audio/UI
verification have not been established for these additions.
The frontend and backend are deployed to the production URLs above. Backend
health, workspace authentication, model configuration, and a live Sonnet 5.5
reply have been verified. The browser viewer is deployed, but its runtime has
not been verified against a live VM.

Physical-headset interactions have not been verified.
This execution environment rejects local listening ports and blocks the SDK
managed browser's process-identity check, so authoritative spatial rendering
remains to be checked outside that restriction.

The backend overrides `guarded-fetch`'s `undici` to 7.30.0, addressing the
reported Undici advisories. Its installation still reports two moderate audit
entries from `just-bash`/`sprintf-js`. The underlying
[sprintf-js precision-format advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
has no patched release as of that date. The initial agent's optional built-in
shell tools are disabled; the dependency is retained for local sandbox setup.

```sh
npm run typecheck
npm test
npm run build
npm --prefix eve-backend run typecheck
npm --prefix eve-backend run build
```

For authoritative spatial UI verification, start the managed SDK browser and use:

```sh
npx @iwsdk/cli ui render-preview --input-json '{"assetId":"eve-console","width":800,"height":1000}' --output-file artifacts/eve-console.png
npx @iwsdk/cli browser screenshot --output-file artifacts/eve-runtime.png
```

An editor render proves layout, not behavior. Validate XR entry, console placement,
ray clicks, streaming updates, and exit in the runtime and on the target headset.

## Source references

- [Eve HTTP channel](https://github.com/vercel/eve/blob/main/docs/channels/eve.mdx)
- [Sessions and streaming](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- [Route authentication](https://github.com/vercel/eve/blob/main/docs/guides/auth-and-route-protection.md)
- [Durable session state](https://github.com/vercel/eve/blob/main/docs/concepts/state.md)
- [Deploying Eve](https://github.com/vercel/eve/blob/main/docs/guides/deployment/vercel.mdx)

The backend pins Eve 0.79.0. Its installed documentation and exported types are
the authority for that version when the live documentation advances.
