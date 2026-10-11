---
name: maintaining-glossary
description: Keeps GLOSSARY.md as the single meaning of the app's terms. Use when a test case uses a vague, overloaded or conflicting word, or when the author explains a term.
metadata:
  inspired-by: "mattpocock/skills domain-modeling (MIT)"
---

# Maintaining the glossary

- **Conflict**: a test case uses a word differently from GLOSSARY.md. Say so at once and ask which meaning is right.
- **Vague or overloaded word**: propose one precise term ("approved", not "done").
- **Settled**: add or update the entry in GLOSSARY.md right away, not at the end of the session.

Entry format:

```
**Term**: One sentence: what it is, in the business's words.
_Avoid_: other words people use for it (optional).
```

Rules: business meaning only, no implementation details (no element names, no code).
One meaning per term. Keep entries in alphabetical order.
