# Continuous integration and image publication

GitHub Actions runs on pull requests, pushes to `main`, version tags beginning with `v`, and manual dispatches.

The checks job runs on native AMD64 and ARM64 runners under Python 3.15.1. It checks Ruff formatting, installs the locked frontend dependencies, checks formatting and strict TypeScript, builds the frontend, validates Helm rendering, packages the chart on AMD64 and smoke-tests each Docker image as UID 10001 with a writable data volume. Backend tests run inside each minimal image; the host installs only the pinned Ruff/PyYAML tools, avoiding a duplicate native DuckDB compilation. Node 24 LTS compiles the React frontend with Vite 8, and Helm 4.3.1 validates and packages the chart. A Trivy scan blocks publication on any reported OS/Python vulnerability, including findings without an available fix. Per-architecture JSON reports are uploaded even on scan failure. See [runtime security](runtime-security.md).

Only successful trusted runs from this repository's `main` or version tags can publish. Pull requests, including forks, run checks without Docker Hub credentials. The workflow uses read-only GitHub permissions for checks and Docker publication. Only the release job receives `contents: write` to create its tag, release and attached chart. Actions are pinned to commits and no `pull_request_target` execution is used. Publication uses the repository secret `DOCKERHUB_TOKEN` and the fixed username `ddecrulle`. No username secret, AWS credentials or cluster credentials are needed by CI.

Images target Linux amd64 and arm64 and are published to `ddecrulle/dvf-explorer` with:

- `sha-<full commit SHA>` for each published revision;
- `main` for main-branch runs;
- the exact `v...` tag for version-tag runs.

Build provenance and SBOM generation are enabled. Helm archives are attached to each checks run as `helm-chart-<SHA>` artifacts, with `appVersion` pointing to the matching SHA image tag. Wait for publication success before using that image. No automated deployment or public chart registry is configured.

Configure branch protection/required checks separately if desired. Repository visibility is managed by the owner; the workflow does not change it. Docker Hub repository visibility is independent of GitHub visibility. Kubernetes needs an image pull Secret if the image is private.

## Automatic GitHub releases

`VERSION` at the repository root is the application version, initially `1.0.0`. Use stable `MAJOR.MINOR.PATCH` numbers. To release, increase this file in a commit or pull request merged into `main`, for example `1.0.0` → `1.0.1`. No manual tag or additional release token is needed.

After tests, Helm validation and Docker smoke checks pass, the workflow publishes the combined frontend/backend image for AMD64 and ARM64 with `sha-<commit>`, `main` and `v<version>` tags. Only after Docker publication succeeds does it create the Git tag on that exact commit and the GitHub release, with automatically generated notes and a Helm package attached. The release package's `appVersion` points to the versioned Docker tag. The SSPCloud values inherit that `appVersion` unless `image.tag` or `image.digest` is explicitly overridden.

Ordinary commits using an already released version publish only `main` and `sha-<commit>`; they do not overwrite the versioned image or create another release. A rerun on the release commit can finish an incomplete release. Decreasing the version is rejected. Manually pushed `v*` tags must exactly match `VERSION` and the checked-out commit. Pre-release versions are not supported by this policy.

The initial addition of `VERSION` creates `v1.0.0` on the first successful run on `main`. The existing repository secret `DOCKERHUB_TOKEN` must have Docker Hub write access. GitHub release creation uses the job's built-in `GITHUB_TOKEN`; repository rules must permit that job to create `v*` tags. Tags created with this token do not trigger another workflow, so Docker publication and GitHub release creation intentionally run in the same workflow. See [GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token) and [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create).

Application and source chart versions are independent: `VERSION` controls application releases, while `charts/Chart.yaml` controls the Helm package version.
