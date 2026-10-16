# Continuous integration and image publication

GitHub Actions runs on pull requests, pushes to `main`, version tags beginning with `v`, and manual dispatches.

The checks job runs backend tests and Ruff formatting, installs the locked frontend dependencies, checks formatting and strict TypeScript, builds the frontend, validates Helm rendering, packages the chart and smoke-tests the Docker image as UID 10001 with a writable data volume.

Only successful trusted runs from this repository's `main` or version tags can publish. Pull requests, including forks, run checks without Docker Hub credentials. The workflow uses read-only GitHub permissions, pinned action commits and no `pull_request_target` execution. Publication uses the repository secret `DOCKERHUB_TOKEN` and the fixed username `ddecrulle`. No username secret, AWS credentials or cluster credentials are needed by CI.

Images target Linux amd64 and arm64 and are published to `ddecrulle/dvf-explorer` with:

- `sha-<full commit SHA>` for each published revision;
- `main` for main-branch runs;
- the exact `v...` tag for version-tag runs.

Build provenance and SBOM generation are enabled. Helm archives are attached to each checks run as `helm-chart-<SHA>` artifacts, with `appVersion` pointing to the matching SHA image tag. Wait for publication success before using that image. No automated deployment or public chart registry is configured.

Configure branch protection/required checks separately if desired. Repository visibility is managed by the owner; the workflow does not change it. Docker Hub repository visibility is independent of GitHub visibility. Kubernetes needs an image pull Secret if the image is private.
