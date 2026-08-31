from __future__ import annotations

import os
import sys

import requests


def sync_flag(target) -> None:
    """Best-effort push of this tick's flag to the organizer verifier.

    GZCTF hands the checker the current per-team flag every tick via
    ``GZCTF_FLAG`` + ``GZCTF_TEAM_ID`` + ``GZCTF_ROUND``. The verifier is the
    scoring authority, so it must hold the *same* flag — otherwise an attacker
    would receive a flag the scoreboard does not accept. This pushes the flag so
    ``verifier/flags.json`` no longer needs manual maintenance.

    Failure here must NOT affect the SLA verdict: the verifier is organizer
    infrastructure, not the team's service being checked. Configure via env:
      VERIFIER_URL           (required to enable; e.g. http://verifier:9090)
      VERIFIER_ADMIN_TOKEN   (optional; matches the verifier's ADMIN_TOKEN)
      VERIFIER_TEAM          (optional; overrides GZCTF_TEAM_ID as the registry key)
    """
    verifier = os.environ.get("VERIFIER_URL", "").rstrip("/")
    if not verifier:
        print("[flag-sync] VERIFIER_URL unset; skipping", file=sys.stderr)
        return

    team = os.environ.get("VERIFIER_TEAM") or target.team_id
    if not team:
        print("[flag-sync] no team id; skipping", file=sys.stderr)
        return

    token = os.environ.get("VERIFIER_ADMIN_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        response = requests.post(
            verifier + "/flag",
            json={"team": team, "flag": target.flag, "round": target.round},
            headers=headers,
            timeout=8,
        )
        if response.ok:
            print(f"[flag-sync] ok: team={team} round={target.round}", file=sys.stderr)
        else:
            print(f"[flag-sync] verifier {response.status_code}: {response.text[:120]}", file=sys.stderr)
    except requests.RequestException as error:
        print(f"[flag-sync] failed: {error}", file=sys.stderr)
