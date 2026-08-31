FROM python:3.13-slim

WORKDIR /checker
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY checker.py checks.py run.py ./
CMD ["python", "run.py"]
