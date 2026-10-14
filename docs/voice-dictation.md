# Voice dictation in WebXR

1. Open https://eve-workbench.vercel.app in Meta Quest Browser and unlock the workspace.
2. Before entering XR, choose **Enable microphone** and allow browser microphone access.
3. Choose **Enter XR**. On Eve's spatial console, point and select **Dictate**.
4. Speak, then choose **Stop mic**. A recording ends automatically after 45 seconds.
5. Read the transcript in **Reply**, using **Previous / Next page** if needed.
6. Choose **Send voice** to send the text to Eve, or **Discard** to remove it.

Dictation uses GPT-4o mini Transcribe through Vercel AI Gateway. Sonnet 5.5
remains the conversational agent. A recording is uploaded only for transcription;
it is not added to the conversation. Only the reviewed text is sent as a message.
This is tap-to-record dictation, not an always-listening voice assistant.

If microphone permission cannot be granted while immersed, choose **Back to
browser**, allow it with **Enable microphone**, and re-enter XR. Recording is
cancelled when XR loses focus or exits. Unsupported recording APIs, microphone
errors, oversized clips, and transcription failures are shown explicitly.

The desktop composer also has a microphone button. Its transcript fills the
message box, where it can be edited before sending. **Voice on/off** and
**Stop reading** control spoken replies separately from microphone dictation.

Automated tests cover capture cleanup, cancellation during permission and
transcription, the duration limit, protected audio upload, validation, and review
state. The spatial template is checked with the real UIKitML parser. Physical
Quest microphone permissions and in-headset recording still require hardware
verification. The deployed, authenticated `/api/eve/transcribe` endpoint has
successfully transcribed an 11-second public speech sample through the real
GPT-4o mini Transcribe model. Both production builds, frontend/backend type
checks, and all 52 automated tests passed.
