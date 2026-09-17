import os
import sys
import time

import requests

OK, MUMBLE, OFFLINE, INTERNAL_ERROR = 0, 1, 2, 3
CHECKS = []


class Mumble(Exception):
    pass


def check(function):
    CHECKS.append(function)
    return function


class Target:
    def __init__(self):
        self.url = f"http://{os.environ['GZCTF_TARGET_IP']}:{int(os.environ['GZCTF_TARGET_PORT'])}"

    def request(self, method, path, **kwargs):
        kwargs.setdefault("timeout", 15)
        try:
            return requests.request(method, self.url + path, **kwargs)
        except requests.RequestException as error:
            raise ConnectionError(str(error)) from error

    def wait_ready(self, timeout=20):
        deadline = time.monotonic() + timeout
        last_error = "service is not ready"
        while time.monotonic() < deadline:
            try:
                response = requests.get(self.url + "/health", timeout=2)
                if response.status_code == 200:
                    return
                last_error = f"health returned HTTP {response.status_code}"
            except requests.RequestException as error:
                last_error = str(error)
            time.sleep(1)
        raise ConnectionError(last_error)


def main():
    try:
        target = Target()
        target.wait_ready()
    except (KeyError, ValueError) as error:
        print(f"checker configuration error: {error}", file=sys.stderr)
        raise SystemExit(INTERNAL_ERROR)
    except ConnectionError as error:
        print(f"[readiness] Offline: {error}", file=sys.stderr)
        raise SystemExit(OFFLINE)

    verdict = OK
    for function in CHECKS:
        try:
            function(target)
            print(f"[{function.__name__}] Ok", file=sys.stderr)
        except Mumble as error:
            verdict = max(verdict, MUMBLE)
            print(f"[{function.__name__}] Mumble: {error}", file=sys.stderr)
        except ConnectionError as error:
            verdict = max(verdict, OFFLINE)
            print(f"[{function.__name__}] Offline: {error}", file=sys.stderr)
        except Exception as error:
            verdict = max(verdict, INTERNAL_ERROR)
            print(f"[{function.__name__}] InternalError: {error}", file=sys.stderr)
    raise SystemExit(verdict)
