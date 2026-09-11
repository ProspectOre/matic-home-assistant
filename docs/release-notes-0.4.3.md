# 0.4.3 — Activity diagnostics

🧭 **Investigate unexpected docking and stopping** with a local timeline of
integration commands and raw robot state changes, including brief subscription
updates between normal polls.

🔎 **Distinguish command attempts from transport results.** The timeline includes
internal cleanup commands, transmission starts, acknowledgements, failures,
cancellations, and subscription gaps. It does not change cleaning behavior or
claim to identify commands sent through the OEM app.

🔒 **Keep the evidence local.** Diagnostics retain the latest 512 observations
without payloads, room names, maps, credentials, or exception messages. Home
Assistant events follow Recorder retention settings.

See [Activity diagnostics](activity-diagnostics.md) for interpretation and a
controlled reproduction procedure.

🧹 **Read results for the cleaning mode you requested.** MCP history now accepts
vacuum, mop, or combined mode and labels its completion scope. Finished events
include separate mode counts, so vacuum-only work is not mistaken for a failed
combined clean.

📋 **Inspect the retained command timeline directly.** `MaticGetActivity` supports
command/state filters, pagination, and explicit retention boundaries. Reports
distinguish a successful stop and return to dock from completing every room.
