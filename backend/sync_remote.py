"""CronJob client: trigger the single API writer and wait for its result."""

import os
import time

import httpx


def main():
    base = os.environ["DVF_API_URL"].rstrip("/")
    token = os.environ["DVF_ADMIN_TOKEN"]
    with httpx.Client(timeout=180, headers={"X-Admin-Token": token}) as client:
        response = client.post(base + "/api/sync")
        response.raise_for_status()
        task_id = response.json()["id"]
        deadline = time.monotonic() + 48 * 3600
        while time.monotonic() < deadline:
            status = client.get(base + "/api/status")
            status.raise_for_status()
            job = status.json()["job"]
            if job.get("id") != task_id:
                raise RuntimeError("The job was replaced; check the sync log.")
            print(job["message"], flush=True)
            if job["state"] == "done":
                return
            if job["state"] != "running":
                raise RuntimeError(job["message"])
            time.sleep(30)
        raise TimeoutError("Sync still running after 48 hours; check the server.")


if __name__ == "__main__":
    main()
