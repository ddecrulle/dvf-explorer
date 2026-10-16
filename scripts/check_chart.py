"""Render chart variants and assert deployment invariants without a cluster."""
import subprocess
from pathlib import Path

import yaml

CHART = str(Path(__file__).resolve().parents[1] / "charts/dvf-explorer")


def render(*options):
    output = subprocess.check_output(["helm", "template", "dvf", CHART, *options], text=True)
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
    assert pod["volumes"][0]["persistentVolumeClaim"]["claimName"] == one(docs, "PersistentVolumeClaim")["metadata"]["name"]
    assert not any(doc["kind"] == "Secret" for doc in docs)
    cron = one(docs, "CronJob")["spec"]
    assert cron["schedule"] == "0 9,16 * * 1-5" and cron["timeZone"] == "Europe/Paris"
    assert cron["concurrencyPolicy"] == "Forbid"
    worker = cron["jobTemplate"]["spec"]["template"]["spec"]
    assert "volumes" not in worker
    assert worker["containers"][0]["command"][-1] == "--scheduled"
    assert worker["containers"][0]["env"][1]["valueFrom"]["secretKeyRef"] == pod["containers"][0]["env"][3]["valueFrom"]["secretKeyRef"]
    assert one(docs, "PersistentVolumeClaim")["metadata"]["annotations"]["helm.sh/resource-policy"] == "keep"

    docs = render("--set", "persistence.existingClaim=retained-data", "--set", "service.port=80", "--set", "image.digest=sha256:" + "a" * 64)
    assert not any(doc["kind"] == "PersistentVolumeClaim" for doc in docs)
    pod = one(docs, "Deployment")["spec"]["template"]["spec"]
    assert pod["volumes"][0]["persistentVolumeClaim"]["claimName"] == "retained-data"
    assert pod["containers"][0]["image"].endswith("@sha256:" + "a" * 64)
    cron = one(docs, "CronJob")["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    assert cron["containers"][0]["env"][0]["value"].endswith(":80")

    docs = render("--set", "persistence.enabled=false", "--set", "sync.enabled=false", "--set", "serviceAccount.create=false")
    assert not any(doc["kind"] in ("PersistentVolumeClaim", "CronJob", "ServiceAccount") for doc in docs)
    assert one(docs, "Deployment")["spec"]["template"]["spec"]["volumes"][0]["emptyDir"] == {}
    docs = render("-f", str(Path(CHART) / "values-sspcloud.yaml"))
    assert one(docs, "Ingress")["spec"]["tls"][0]["secretName"] == "dvf-tls"
    for invalid in ["replicaCount=2", "admin.existingSecret=", "sync.timeZone=UTC"]:
        result = subprocess.run(["helm", "template", "dvf", CHART, "--set", invalid], capture_output=True)
        assert result.returncode != 0, invalid
    print("Helm rendering and deployment invariants passed.")


if __name__ == "__main__":
    check()
