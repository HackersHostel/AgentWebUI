# Start here

You are working on AgentWebUI. Read [README.md](README.md) first: it covers what the app does, how to run it and how
to configure it. [CONTRIBUTING.md](CONTRIBUTING.md) explains the layout, the tests, the code style and each rule below.

Rules:

- **Tiny:** no new dependency, service or build step.
- **No dead controls.**
- **Match the design:** colors and sizes from `static/css/tokens.css`, in every theme and at phone width.
- **Configuration in `.env` only**, with each new setting in `.env.example`.
- **Tests for every server change.**
- **One branch and one pull request into `main` per change.**
- **Never commit `.env` or `data/`.**
