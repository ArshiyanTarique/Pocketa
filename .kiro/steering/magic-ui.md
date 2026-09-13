---
inclusion: always
---

# Magic UI

Magic UI (https://magicui.design) is a collection of animated React components built on top of Tailwind CSS and Framer Motion. Components are copied directly into the project — there is no package to install.

## When to use it

Only reach for Magic UI when the task genuinely calls for a polished animation or visual effect that would take significant effort to build from scratch. Good candidates:

- Entrance animations (text reveal, number counters, shimmer)
- Background effects (particles, beams, grid patterns)
- Interactive card effects (tilt, glow, spotlight)
- Decorative elements (animated gradients, borders, badges)

Do NOT use Magic UI just because it exists. If a plain Tailwind + CSS transition handles the job, use that instead.

## How to add a component

1. Browse the registry at https://magicui.design/docs/components
2. Find the component that fits
3. Run the install command shown on its page, e.g.:
   ```
   npx shadcn@latest add "https://magicui.design/r/shimmer-button"
   ```
   This copies the component source into `src/components/magicui/`.
4. Import and use it directly.

## Project constraints

- Pocketa already uses Tailwind CSS and `motion/react` (Framer Motion) — Magic UI components are compatible.
- Match the existing design tokens (`--accent`, `--ink`, `--paper`, etc.) when customising colours.
- Keep animations subtle — Pocketa is a finance app, not a landing page. Avoid anything that distracts from the data.
- Never add Magic UI to forms, tables, transaction rows, or any data-dense UI. Reserve it for hero sections, empty states, and decorative moments.
