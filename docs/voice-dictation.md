# Talk or type

Open https://eve-workbench.vercel.app and unlock your workspace. The browser and
WebXR use the same **Talk or type** draft.

- **Type:** click the field. In XR this opens a keyboard inside the panel; a
  physical keyboard also works. Choose **Done** to hide the keyboard.
- **Talk:** tap the microphone (or **Talk** in XR), speak, then tap again to stop.
  The transcript fills the same field. Edit it if needed, then choose **Send**.
- Microphone permission is requested on first use. If the headset cannot show
  its permission prompt while immersed, exit XR, tap the microphone in the
  browser to allow it, stop that recording, and enter XR again.

Audio uses GPT-4o mini Transcribe through Vercel AI Gateway. Sonnet 5.5 remains
Eve's conversational model. Recordings stop after 45 seconds and are transcribed
through the authenticated server. Transcribing does not send a chat message;
**Send** sends the text. Leaving XR or losing focus stops an active recording.

The authenticated production transcription endpoint has passed live WAV and
WebM/Opus checks. Automated tests cover microphone cleanup, cancellation, upload
limits and shared input. Physical Quest microphone and interaction testing still
requires a headset.
