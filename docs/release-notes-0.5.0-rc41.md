# v0.5.0-rc41

RC41 retains the [RC40 coverage verification](release-notes-0.5.0-rc40.md)
and improves the active-cleaning status in Map Studio.

Room names and progress wrap instead of being cut off on narrow screens and in
full-map mode. The current-room estimate now describes the percentage of
estimated cleaning time elapsed, alongside the separately verified count of
completed rooms. The estimate is based on prior compatible cleaning times; it
does not measure cleaned area or confirm that a room has finished.

Smart Stop now keeps later rooms out of the current robot mission. When it is
finishing a room or area, the map explains what will happen and offers
**Stop now & dock**. It shows when the result is being checked and when the
robot is returning. Smart Order names the option that starts with the rooms
and areas that have waited longest.

The registered Map Studio startup limit increases from 92,544 to 94,208
compressed bytes to accommodate these status and stop controls. The workflow
and diagnostics limits are unchanged.

This is a prerelease. Preserve a verified Home Assistant backup and the installed
integration and configuration stores before updating; follow the
[rollback guidance](verification-0.5-rc24.md). Installed and physical qualification
remain separate from source tests and review.
