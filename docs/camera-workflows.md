# Camera workflows

This document describes the photo patrol, explicit AI analysis and Assist tools.
The implementation does not establish robot-camera or privacy acceptance on a
physical device.

## Photo patrol and analysis

`matic_robot.photo_patrol` accepts `question` and `ai_task_entity_id` together.
Leaving both out takes photos without AI. The selected entity must support AI
Task data generation and image attachments. Matic does not choose an entity or
provider implicitly.

When analysis is requested, Matic stages an immutable copy of the captured full
WebP under a random, short-lived private media-source ID. The bounded source
resolves only staged IDs, exposes no browse or search results, and removes the
temporary file after AI Task finishes, on expiry, or when Home Assistant stops.
The AI Task call receives the full image and question; the configured provider
may send them outside Home Assistant. The response has `problem` and `summary`
fields. The summary is returned to the caller but is not added to the photo event,
entity state or logs. Photos remain subject to the bounded in-memory photo cache.

The photo-on-alert blueprint requires an explicit AI Task entity and question.
It sends a notification only when the structured answer reports a problem. The
notification uses the pixelated preview unless full resolution is explicitly
selected. Patrol failures still produce a text-only notification.

The `MaticTakePhoto` and `MaticInvestigate` Assist tools are available only to a
current Home Assistant administrator for a robot exposed to that assistant.
Both use the same patrol path: unattended opt-in, no-photo rooms, map and room
checks, schedule exclusion, battery floor, single-flight/cooldown and safe dock
ownership checks still apply. `MaticInvestigate` requires a question and an
explicit AI Task entity; its description discloses that the selected provider
may be cloud-based.

## Acceptance boundaries

- [PRO-117](https://linear.app/prospectore/issue/PRO-117/camera-privacy-and-safety-rules-for-unattended-photos-and-patrols) tracks unattended photo privacy and patrol safeguards.
- [PRO-115](https://linear.app/prospectore/issue/PRO-115/aimed-camera-viewpoints-send-the-robot-to-look-at-a-saved-spot-and) tracks saved viewpoints and the unconfirmed heading/capture convention. This implementation accepts room names only.
- [PRO-116](https://linear.app/prospectore/issue/PRO-116/answer-a-question-about-an-investigation-photo-with-ai-task) tracks question-based structured photo analysis.
- [PRO-122](https://linear.app/prospectore/issue/PRO-122/photo-retention-on-the-robot-so-patrols-cannot-fill-its-disk) tracks robot-side photo deletion and read-back. Matic does not delete robot photos.
- [PRO-125](https://linear.app/prospectore/issue/PRO-125/assist-tools-to-investigate-and-take-a-photo) tracks Assist photo tools.

Off-dock capture, camera heading, robot-side deletion/read-back, and physical
privacy acceptance remain separate owner/device checks.
