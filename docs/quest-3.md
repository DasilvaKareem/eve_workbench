# Quest workspace

The initial view is one **Talk or type** prompt with Send. Tap the field to open
Quest's native keyboard; use its microphone for native voice entry if available.
Dismiss the keyboard and send the text. See [native input](voice-dictation.md).
There is no custom in-world keyboard or menu of canned prompts.

Point and release the controller trigger, point and pinch with hands, or poke a
control. Pinch/drag the title to move the prompt; use two pointers to resize.
Right controller thumbstick click recalls the prompt to your current tracked
position. It stays anchored afterward. Exit XR returns to the browser.

Replies and sending/error status appear above the prompt. Long replies have
Previous/Next controls. While Eve is working, Send becomes Stop. On a connection
error, Retry reconnects. Ended conversations recover into a fresh session.

Ask Eve, for example: **Create a panel with my project checklist.** A successful
workbench_panel tool result opens the panel automatically in XR and in the
browser. Drag its title to move it, use two pointers to resize, and Close to hide.
Page controls and panel switching appear only when needed. Empty panels and the
old task dashboard/menu do not appear in the initial workspace.

Type checking, real UIKitML parsing, native input wiring, session recovery,
stream reconnection, and panel rendering data are covered by automated checks.
A live agent reply and real panel creation were verified. The local environment
blocks managed browser processes/server ports, so physical Quest interaction,
keyboard and OS dictation behavior, comfort, and frame rate remain unverified.
