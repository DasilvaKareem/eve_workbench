# The single XR prompt

Open https://eve-workbench.vercel.app in Quest Browser, unlock the workspace,
and choose **Enter XR**. There is one **Talk or type** field, **Talk**, and **Send**.

Tap the field to reveal its in-world keyboard. Point and press/release the
controller trigger, point and pinch with hands, or poke the controls directly.
A physical keyboard also writes into the field. Browser and XR share one draft.
See [voice dictation](voice-dictation.md) for microphone behavior.

Drag the title bar to move the panel. Hold it with two pointers to resize.
Manipulation is attached only to the title; it does not capture the input field
or its buttons. Click the right controller's thumbstick to place the panel in
front of your current tracked position. It stays anchored after placement.
**Exit XR** returns to the browser.

Eve's reply appears above the field. Longer replies expose Previous/Next controls.
While Eve is working, Send becomes Stop. The old task dashboard, voice settings,
quick prompts, demo controls, and additional screens are absent from the main UI.

Type checking, the real UIKitML parser, and automated interaction-wiring checks
run locally. The environment blocks browser process startup and local server
ports, so managed XR emulation is unavailable. Physical Quest interaction,
resizing, microphone permissions, comfort, and frame rate remain unverified.
