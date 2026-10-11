---
name: mapping-canvas-apps
description: How to record a Power Apps canvas app in the app map - each screen, each control's data-control-name, type, visible text and accessible name, the control that proves the app has loaded, and how screens connect. Use in the planner check for canvas cases and with /map-canvas-app.
---

# Mapping canvas apps

The app map is what makes "checks only on things the planner saw" work. For a canvas app a control is
identified by its **`data-control-name`** (its name in Power Apps Studio), so the map records it.

## How to look

1. Open the play link. Wait until a real control shows (the first load can take up to 60 seconds).
2. Snapshots of the outer page show an empty frame: look **inside** `iframe[name="fullscreen-app-host"]`.
   Every control there carries `data-control-name`.
3. For each screen the cases use, record every control you act on or check. Galleries: record the gallery
   and the controls inside one row (title, subtitle, icons). Only rows in view exist; scroll to see more.
4. Note the **ready control**: one that only appears when the app has finished loading (usually the main
   gallery or a toolbar button). Tests wait for it after `goto`.
5. Never type real data into a production record. Mapping is looking, not changing.

## Report format

Answer with the two sections of `mapping-the-app/references/app-map-format.md`. In the YAML block, a
canvas page is a screen, and each element adds `control_name`, `control_type` and `screen`:

```yaml
pages:
  orders-screen:
    address: https://apps.powerapps.com/play/e/<env>/a/<app>?tenantId=<tenant>
    reached_by: start page
    ready_control: Gallery1
    elements:
      - { control_name: Gallery1, control_type: gallery, role: list, name: "Orders", screen: OrdersScreen }
      - { control_name: Title1, control_type: label, role: text, name: "", example_text: "ORD-0001", screen: OrdersScreen }
      - { control_name: NewOrderButton, control_type: button, role: button, name: "New order", screen: OrdersScreen }
      - { control_name: OrderNumberInput, control_type: textinput, role: textbox, name: "Order number", screen: OrderFormScreen }
      - { control_name: SaveButton, control_type: button, role: button, name: "Save", screen: OrderFormScreen }
```

`control_type` is one of: button, label, textinput, dropdown, combobox, datepicker, checkbox, toggle,
gallery, form, container, icon, image, screen. Mismatch lines still name a Test ID and step, e.g.
`- TC-03 step 2: "Order date" not found; the form has a date picker named DatePicker1 labelled "Ordered on".`

Save the answer to `runs/<run-id>/planner-report-<group>.md` and run `merge_app_map.py`, which keeps
`control_name`, `control_type` and `screen`, and tells canvas controls apart by their control name.

## Things to report as mismatches

- A control the Excel names that has no visible text and no accessible name (testers cannot see what it
  is; ask the author which control is meant).
- An icon-only button (Power Apps "icons") whose meaning is unclear.
- A step that needs a row far down a long gallery (the test will scroll; confirm the row's text).
