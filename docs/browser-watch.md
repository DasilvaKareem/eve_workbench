# Watching Eve's sandbox browser

Ask Eve: **“Open https://example.com and tell me what is on the page.”**
On desktop, expand **Watch Eve’s browser** below the task board. In the headset,
the browser screen opens beside the console when the first browser action starts.
Use **Watch browser** on the console to reopen it after hiding it.

The screen displays actual Chromium frames from the same Vercel VM Eve uses.
It refreshes about once a second while visible. Recent browser actions appear
below the screen, with running, completed, failed, or cancelled status. Field
values are omitted from the activity feed. A retained frame is explicitly
labelled when the sandbox is stopped or the connection is interrupted.

The headset panel stays anchored after placement. **Place in front** moves it
in front of the current viewer pose. **Hide browser** closes it;
**Cancel task** requests cancellation of Eve's active turn. These controls accept
hand pokes and controller/hand rays. Website interaction is performed by Eve;
manual takeover is not included in this version.

## Backend configuration

Deploy the backend on Vercel using the [integration guide](eve-integration.md).
Set the same `EVE_API_KEY` (at least 32 characters) on frontend and backend.
Build on Vercel so Eve prepares the real sandbox snapshot, including Chromium,
its Linux libraries, Agent Browser 0.39.1, and the frame relay. The backend
project needs access to Vercel Sandbox through the SDK's supported credentials.
The frontend does not need Sandbox credentials.

Default local development uses just-bash, which cannot run Chromium. Browser
tools and viewing report this limitation. To use real Vercel VMs from local
development, set `EVE_BROWSER_SANDBOX=vercel` in the backend environment and
configure Vercel Sandbox credentials. Restart/rebuild the backend afterwards.
Use a fresh conversation after changing sandbox configuration or rotating the
service key. The viewer does not start a VM by itself: a browser tool opens it.

## Frame delivery

1. The authored `browser` tool runs commands using Agent Browser's official
   shell-argument builder, inside Eve's configured sandbox. `browser_status`
   checks availability before the first action.
2. A server-side relay inside the VM receives the browser's localhost WebSocket
   frames. It retains only the latest frame, caps its size, and exposes only an
   authenticated `GET /frame` on sandbox port 3001. It has no input endpoint.
   It disconnects from screencasting after the viewer stops polling.
3. The backend's `/workbench/browser/:sessionId/frame` route verifies the service
   key, finds the VM through Eve 0.79's `sessionId` tag, verifies its workbench
   tag, and fetches that frame with a session-specific derived credential.
   The credential and native sandbox address never reach the headset.
4. The frontend's existing private `/api/eve` proxy permits only a fixed frame
   route. Desktop and XR share one nonoverlapping poller. Closing both views
   aborts polling; changing conversations clears the frame and rejects late
   results from the previous conversation. Canvas textures update on new frames.

Eve's NDJSON events remain separate from the frames. `actions.requested` and
`action.result` drive the bounded activity feed. Browser images are not put
inside the durable chat stream or saved to local storage. This is a live preview,
not a video recording or an audit trail.

The published `@agent-browser/eve` extension was built with Eve 0.57 and failed
Eve 0.79's module-binding compilation here. This project uses a normal authored
Eve tool with the package's public sandbox helpers instead; it does not patch
installed dependencies or depend on Eve's private sandbox handles.

## Validation and remaining live checks

Frontend/backend type checks and local builds pass. Tests exercise the frame
relay's actual source with mocked transports, backend VM selection and service
authentication, proxy routing, client cancellation/session switching, tool
results, timeline events, and the SDK's real UIKitML parser.

No live VM/browser session, model-driven navigation, or physical Quest 3 session
has been verified here. The managed IWSDK browser cannot acquire process
identity in this restricted environment. To finish live validation after
deployment, open a public page, scroll and follow a link through Eve, verify both
viewers update, hide/reopen the viewer, start a new conversation, and confirm
that the old screen disappears. Verify cancellation and tracking recovery on
Quest 3. Use the managed SDK renderer for spatial layout:

```sh
npx @iwsdk/cli ui render-preview --input-json '{"assetId":"eve-browser","width":1000,"height":900}' --output-file artifacts/eve-browser.png
npx @iwsdk/cli browser screenshot --output-file artifacts/eve-browser-runtime.png
```

Sources: [Agent Browser streaming protocol](https://agent-browser.dev/streaming),
[Eve sandbox helpers](https://agent-browser.dev/eve), and the installed Eve
0.79 sandbox/channel documentation and Vercel Sandbox 3.8 SDK types.
