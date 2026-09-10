# Contributing

Contributions are welcome.

## Development setup

Requirements are Node.js 20 or newer and Claude Code for optional live tests.

```sh
npm install
npm run check
npm test
```

The default test suite does not need credentials or network access. Use temporary credentials only for `npm run test:live` and never commit them.

## Changes

- Branch from `develop`.
- Add a failing test before changing behavior.
- Keep the server dependency-free unless a dependency solves a demonstrated protocol or security requirement.
- Keep tool execution outside this project.
- Update `README.md` and `CHANGELOG.md` when public behavior changes.
- Use Conventional Commit messages.

Pull requests should describe the user-visible outcome, tests run, and compatibility impact.
