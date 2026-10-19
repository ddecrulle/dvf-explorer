"""Validate the application version and plan immutable GitHub/Docker releases."""

import os
import re
import subprocess
from pathlib import Path

VERSION_PATTERN = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def version_tuple(value):
    if not VERSION_PATTERN.fullmatch(value):
        raise ValueError("VERSION must use the stable MAJOR.MINOR.PATCH format.")
    return tuple(map(int, value.split(".")))


def plan(version, sha, ref, tags):
    """tags maps stable vX.Y.Z tags to their peeled commit hashes."""
    current = version_tuple(version)
    tag = f"v{version}"
    stable = {
        name: commit
        for name, commit in tags.items()
        if name.startswith("v") and VERSION_PATTERN.fullmatch(name[1:])
    }
    if ref.startswith("refs/tags/") and ref != f"refs/tags/{tag}":
        raise ValueError("The Git tag must match VERSION exactly.")
    if stable and current < max(version_tuple(name[1:]) for name in stable):
        raise ValueError("VERSION must not be lower than an existing release tag.")
    tagged_commit = stable.get(tag)
    if ref.startswith("refs/tags/") and tagged_commit != sha:
        raise ValueError("The release tag does not point to this commit.")
    release = tagged_commit is None or tagged_commit == sha
    image_tags = [f"ddecrulle/dvf-explorer:sha-{sha}"]
    if ref == "refs/heads/main":
        image_tags.append("ddecrulle/dvf-explorer:main")
    if release:
        image_tags.append(f"ddecrulle/dvf-explorer:{tag}")
    return {
        "version": version,
        "tag": tag,
        "release": str(release).lower(),
        "image_tags": "\n".join(image_tags),
    }


def main():
    version = Path("VERSION").read_text().strip()
    names = subprocess.check_output(
        ["git", "tag", "--list", "v*"], text=True
    ).splitlines()
    tags = {
        name: subprocess.check_output(
            ["git", "rev-parse", f"{name}^{{commit}}"], text=True
        ).strip()
        for name in names
        if VERSION_PATTERN.fullmatch(name[1:])
    }
    result = plan(version, os.environ["GITHUB_SHA"], os.environ["GITHUB_REF"], tags)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for key, value in result.items():
            if "\n" in value:
                output.write(f"{key}<<RELEASE_OUTPUT\n{value}\nRELEASE_OUTPUT\n")
            else:
                output.write(f"{key}={value}\n")
    print(f"Version {version}: release={result['release']}")


if __name__ == "__main__":
    main()
