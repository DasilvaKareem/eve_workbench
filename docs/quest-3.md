# Quest workspace

The initial view is one **Talk or type** prompt with Send. Tap the field to open
Quest's native keyboard; use its microphone for native voice entry if available.
Dismiss the keyboard and send the text. See [native input](voice-dictation.md).
There is no custom in-world keyboard or menu of canned prompts.

Point and release the controller trigger, point and pinch with hands, or poke a
control. Pinch/drag the title to move the prompt; use two pointers to resize.
Right controller thumbstick click recalls the prompt to your current tracked
position. It stays anchored afterward. Exit XR returns to the browser.

The conversation, replies, and generated result cards appear together above the
prompt. Drag inside the conversation or use Older/Newer to scroll it. A result
card is inserted at the point where Eve creates it, preserving the request and
follow-up reply around it. Tables, metrics, charts, chart data, and actions are
inside that card. There are no panel tabs, disclosure menus, or separate result
screens. The chat title moves/resizes the whole conversation.

Ask Eve, for example: **Show a project checklist panel in this chat.** A successful
workbench_panel result inserts the card immediately. Updating the same panel id
updates that card in place. While Eve works, Send becomes Stop. Retry reconnects
on a connection error, and ended sessions recover into a fresh conversation.

Type checking, real UIKitML parsing, native input wiring, session recovery,
stream reconnection, and panel rendering data are covered by automated checks.
A live agent reply and real panel creation were verified. The local environment
blocks managed browser processes/server ports, so physical Quest interaction,
keyboard and OS dictation behavior, comfort, and frame rate remain unverified.
