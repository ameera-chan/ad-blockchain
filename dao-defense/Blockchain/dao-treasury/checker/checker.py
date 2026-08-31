from __future__ import annotations

import os
import sys
import traceback
from dataclasses import dataclass

import requests

import flagsync

OK, MUMBLE, OFFLINE, INTERNAL_ERROR = 0, 1, 2, 3
NAMES = {OK: "Ok", MUMBLE: "Mumble", OFFLINE: "Offline", INTERNAL_ERROR: "InternalError"}
CHECKS = []


class CheckError(Exception):
    status = INTERNAL_ERROR


class Mumble(CheckError):
    status = MUMBLE


class Offline(CheckError):
    status = OFFLINE


def check(fn):
    CHECKS.append(fn)
    return fn


@dataclass
class Target:
    ip: str
    port: int
    flag: str
    round: int
    team_id: str

    @property
    def url(self):
        return f"http://{self.ip}:{self.port}"

    def request(self, method, path, **kwargs):
        kwargs.setdefault("timeout", 8)
        try:
            return requests.request(method, self.url + path, **kwargs)
        except requests.RequestException as error:
            raise Offline(f"{method} {path}: {error}") from error


def target_from_env():
    try:
        return Target(
            os.environ["GZCTF_TARGET_IP"],
            int(os.environ["GZCTF_TARGET_PORT"]),
            os.environ.get("GZCTF_FLAG", ""),
            int(os.environ.get("GZCTF_ROUND", "0")),
            os.environ.get("GZCTF_TEAM_ID", ""),
        )
    except (KeyError, ValueError) as error:
        print(f"checker misconfigured: {error}", file=sys.stderr)
        sys.exit(INTERNAL_ERROR)


def main():
    if not CHECKS:
        print("no checks registered", file=sys.stderr)
        sys.exit(INTERNAL_ERROR)
    target = target_from_env()
    # Push this tick's flag to the verifier BEFORE the SLA checks. Best-effort:
    # a verifier outage must not fail the team's SLA verdict.
    flagsync.sync_flag(target)
    worst = OK
    for fn in CHECKS:
        try:
            fn(target)
        except CheckError as error:
            worst = max(worst, error.status)
            print(f"[{fn.__name__}] {NAMES[error.status]}: {error}", file=sys.stderr)
        except Exception as error:
            worst = max(worst, INTERNAL_ERROR)
            print(f"[{fn.__name__}] InternalError: {error}", file=sys.stderr)
            traceback.print_exc()
        else:
            print(f"[{fn.__name__}] Ok", file=sys.stderr)
    print(f"verdict: {NAMES[worst]}", file=sys.stderr)
    sys.exit(worst)
