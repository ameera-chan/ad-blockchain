FROM python:3.12-alpine

WORKDIR /checker
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY checker.py checks.py run.py ./
COPY probes.json ./
ENTRYPOINT ["python3", "run.py"]
