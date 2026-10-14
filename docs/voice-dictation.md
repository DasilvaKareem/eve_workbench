# Native Quest keyboard and voice

The prompt uses Meta Quest's system keyboard. There is no app-built keyboard
and no app audio recording step in this UI.

1. Open https://eve-workbench.vercel.app in Quest Browser, unlock, and enter XR.
2. Tap **Talk or type** (or **Talk / type**) to focus its native HTML text field.
3. Type using Quest's keyboard, or select the microphone on that keyboard for
   Quest's native voice dictation when the device offers it.
4. Dismiss the system keyboard, review the text, and choose **Send**.

The web app cannot programmatically turn on the system keyboard's microphone.
The keyboard handles its own microphone permission and voice availability.
Showing it changes XR visibility to visible-blurred; the draft is preserved
through that transition. Input, change, blur, and Send synchronize the DOM value,
because native keyboard interaction does not necessarily emit keypress events.

The focused field remains in the viewport so the page does not scroll offscreen
on XR exit. A physical keyboard and the desktop composer share the same draft.
Failed sends restore the draft. Retry reconnects; an ended conversation starts
fresh. Normal server stream lease endings reconnect without exhausting a retry
budget while the app is idle.

Sonnet 5.5 is Eve's agent. A live authenticated request and the real browser
prompt both received a response. A live workbench_panel call created a text panel.
Physical Quest system-keyboard, OS microphone, and panel gesture verification
still requires the device.

Implementation follows [Meta's System Keyboard in WebXR guide](https://developers.meta.com/vr/documentation/web/webxr-keyboard/).
The older authenticated server transcription endpoint remains available internally,
but the native prompt does not record or upload audio to it.
