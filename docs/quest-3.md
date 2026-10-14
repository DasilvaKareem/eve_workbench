# Quest 3 panel controls

Quest 3 is the target headset. It supports hands and controllers but does not
have eye-tracking sensors. Optional gaze remains requested in the project, with
the SDK's head-pointing fallback. The UI calls this **Aim: Look**, rather than
claiming to track your eyes.

## Using the console

- **Hands:** choose **Aim: Hands**. Reach out and push through a button's surface
  to poke it, or point and pinch from farther away.
- **Controllers:** point a controller at a button and press/release the trigger.
- **Bring closer:** switches to a smaller panel about 65 cm in front of your
  tracked viewpoint, suitable for direct touch. **Reading distance** returns it
  to about 1.1 m, with a larger physical panel.
- **Place in front:** relocates the panel using your current tracked position
  and facing direction. Clicking the right controller's thumbstick recalls it
  when it is out of view.
- **Aim: Look:** enables the SDK's gaze pipeline. On Quest 3, turn your head to
  aim and pinch to confirm. Looking alone does not activate a button. Direct
  touch takes precedence while a near pointer is active.
- **Previous / Next page:** reads a complete response without shrinking the
  text or discarding its tail. The page indicator shows your position. A new
  assistant message begins on page one.

Buttons brighten on hover and change color while pressed. Controls that are
unavailable, such as sending a second task while Eve is working, are dimmed and
do not invoke their actions. Cancel and exit remain in stable positions.

The console places itself in front of the first valid tracked view on XR entry.
It stays anchored there until explicitly repositioned, so it does not follow
small head movements or cover whatever you look at. Placement follows actual
tracked eye height for standing or seated use. No per-frame animation is needed
for panel placement after it settles.

## Running on the headset

Open the app's HTTPS URL in Meta Quest Browser and enter XR. The desktop IWER
emulator is excluded from production builds; it is still available on the local
development server. The selected desktop emulator profile does not substitute
for a physical Quest 3 test.

The existing café scene and desktop agent controls are retained. Live Eve
responses still require the [backend setup](eve-integration.md).

## Verification status

The separate [sandbox browser screen](browser-watch.md) opens beside the console
when Eve starts browsing. Use **Watch browser** to reopen it, **Place in front**
to reposition it, and **Hide browser** to stop watching. Its website image is
read-only; direct touch/rays operate the panel controls.

Frontend type checking, the production build, and 31 tests pass, including
pagination coverage for long replies, long tokens, emoji, and paragraph breaks.
The SDK's isolated UI-render command could not run because no managed runtime is
available in this restricted execution environment. Physical interaction,
comfort, and frame rate have not yet been measured on a Quest 3.

On the headset, check both hands, each controller, direct pokes versus pinches,
disabled buttons, near-mode reach, seated/standing recentering, page navigation,
tracking loss/recovery, and return from the system menu. Confirm that the first
tracked placement is visible, that a press fires once, and that hand proximity
suppresses incidental look selection. These are validation steps, not claims
that hardware behavior has already been verified.

## References

- [Meta device feature support](https://developers.meta.com/vr/documentation/unity/unity-openxr-settings-quest/)
- [IWSDK optional gaze and head-pointing fallback](https://developers.meta.com/vr/documentation/iwsdk/guides/get-started-glasses/)
- [IWSDK physical-headset testing](https://developers.meta.com/vr/documentation/iwsdk/guides/02-testing-experience/)
