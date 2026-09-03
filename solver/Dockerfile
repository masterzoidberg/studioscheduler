FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY dwde_solver ./dwde_solver

RUN useradd --create-home --uid 10001 solver \
    && chown -R solver:solver /app
USER solver

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)); raise SystemExit(0 if data.get('status') == 'ok' else 1)"

CMD ["sh", "-c", "uvicorn dwde_solver.service:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
