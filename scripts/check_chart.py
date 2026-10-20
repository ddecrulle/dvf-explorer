"""Render chart variants and assert deployment invariants without a cluster."""

import subprocess
from pathlib import Path

import yaml

CHART = str(Path(__file__).resolve().parents[1] / "charts")


def render(*options):
    output = subprocess.check_output(
        ["helm", "template", "dvf", CHART, *options], text=True
    )
    return [doc for doc in yaml.safe_load_all(output) if doc]


def one(docs, kind):
    return next(doc for doc in docs if doc["kind"] == kind)


def check():
    docs = render()
    deployment = one(docs, "Deployment")
    assert deployment["spec"]["replicas"] == 1
    assert deployment["spec"]["strategy"]["type"] == "Recreate"
    pod = deployment["spec"]["template"]["spec"]
    assert pod["containers"][0]["securityContext"]["runAsNonRoot"]
    assert (
        pod["volumes"][0]["persistentVolumeClaim"]["claimName"]
        == one(docs, "PersistentVolumeClaim")["metadata"]["name"]
    )
    assert not any(doc["kind"] == "Secret" for doc in docs)
    assert not any(doc["kind"] == "CronJob" for doc in docs)
    assert (
        one(docs, "PersistentVolumeClaim")["metadata"]["annotations"][
            "helm.sh/resource-policy"
        ]
        == "keep"
    )

    docs = render(
        "--set",
        "persistence.existingClaim=retained-data",
        "--set",
        "service.port=80",
        "--set",
        "image.digest=sha256:" + "a" * 64,
    )
    assert not any(doc["kind"] == "PersistentVolumeClaim" for doc in docs)
    pod = one(docs, "Deployment")["spec"]["template"]["spec"]
    assert pod["volumes"][0]["persistentVolumeClaim"]["claimName"] == "retained-data"
    assert pod["containers"][0]["image"].endswith("@sha256:" + "a" * 64)

    docs = render(
        "--set", "persistence.enabled=false", "--set", "serviceAccount.create=false"
    )
    assert not any(
        doc["kind"] in ("PersistentVolumeClaim", "CronJob", "ServiceAccount")
        for doc in docs
    )
    assert (
        one(docs, "Deployment")["spec"]["template"]["spec"]["volumes"][0]["emptyDir"]
        == {}
    )
    docs = render("-f", str(Path(CHART) / "values-sspcloud.yaml"))
    assert one(docs, "Ingress")["spec"]["tls"][0]["secretName"] == "dvf-tls"
    published = one(docs, "Deployment")
    assert published["spec"]["replicas"] == 1
    assert published["spec"]["strategy"]["type"] == "Recreate"
    assert not any(doc["kind"] == "CronJob" for doc in docs)
    assert (
        one(docs, "PersistentVolumeClaim")["spec"]["resources"]["requests"]["storage"]
        == "20Gi"
    )
    app = published["spec"]["template"]["spec"]["containers"][0]
    assert app["readinessProbe"]["httpGet"]["path"] == "/api/ready"
    assert not any(env["name"] == "DVF_ADMIN_TOKEN" for env in app["env"])
    docs = render("-f", str(Path(CHART).parent / "values-dvf-sspcloud.yaml"))
    assert one(docs, "Ingress")["spec"]["tls"] == [
        {"hosts": ["dvf-explorer.lab.sspcloud.fr"]}
    ]
    docs = render(
        "-f",
        str(Path(CHART) / "values-sspcloud.yaml"),
        "--set",
        "replicaCount=2",
        "--set",
        "persistence.enabled=false",
    )
    assert one(docs, "Deployment")["spec"]["strategy"]["type"] == "RollingUpdate"
    assert not any(doc["kind"] in ("PersistentVolumeClaim", "CronJob") for doc in docs)
    assert one(docs, "Deployment")["spec"]["replicas"] == 2
    for options in [
        ["--set", "replicaCount=2"],
        ["--set", "admin.existingSecret="],
        ["-f", str(Path(CHART) / "values-sspcloud.yaml"), "--set", "replicaCount=2"],
    ]:
        result = subprocess.run(
            ["helm", "template", "dvf", CHART, *options], capture_output=True
        )
        assert result.returncode != 0, options
    print("Helm rendering and deployment invariants passed.")


if __name__ == "__main__":
    check()
