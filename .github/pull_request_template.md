<!-- Thanks for contributing. Keep the PR to one change, and see CONTRIBUTING.md if this is your first. -->

## What this changes

<!-- What a user sees or can do now that they couldn't before. One or two sentences. -->

Closes #

## How it works

<!-- The approach, and anything a reviewer should look at first. Delete if the diff speaks for itself. -->

## How I tested it

<!-- The tests you added or ran, and what you tried by hand: browser, phone, agent or provider. -->

- [ ] `pytest` passes

## Screenshots

<!-- Required for any UI change: before and after, and a phone width if the layout changed. Delete if none. -->

## Checklist

- [ ] No new dependency, service or build step.
- [ ] Every control I added does something (no dead controls), and the UI uses the existing tokens in `static/css/tokens.css`.
- [ ] New settings are read from `.env` and documented in `.env.example` and the README.
- [ ] Server changes have tests in `tests/`.
- [ ] Docs and `CHANGELOG.md` are updated where users would notice the change.
- [ ] No `.env`, `data/`, keys or personal paths are committed.
