# Hugging Face Spaces 用（SDK 选 Docker，端口 7860）；Render 用 render.yaml 即可
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY . /app
WORKDIR /app/backend
ENV PORT=7860 EMAIL_DEV_ECHO=0
EXPOSE 7860
CMD ["sh", "-c", "gunicorn wsgi:app --workers 2 --threads 4 --bind 0.0.0.0:${PORT}"]
