---
name: map-canvas-app
description: Map a Power Apps canvas app (screens and controls by data-control-name) into the app map, once or after the app changed.
argument-hint: the app's play link
agent: uat-canvas-specialist
---
Map the canvas app at ${input:url:play link, https://apps.powerapps.com/play/...}.
Record every screen and control in the app map as the mapping-canvas-apps skill says, and report the
ready control, controls without names and icon-only buttons. Save the report to runs/setup/planner-report-canvas.md
and run: python .github/skills/mapping-the-app/scripts/merge_app_map.py runs/setup canvas
