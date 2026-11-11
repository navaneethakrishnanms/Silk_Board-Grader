FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY silkgrade_engine ./silkgrade_engine
COPY engine_svc ./engine_svc
COPY tools ./tools
COPY training ./training
ENV STORAGE_ROOT=/storage ENGINE_HOST=0.0.0.0 ENGINE_PORT=8001
EXPOSE 8001
CMD ["sh", "-c", "uvicorn engine_svc.main:app --host ${ENGINE_HOST} --port ${ENGINE_PORT}"]
