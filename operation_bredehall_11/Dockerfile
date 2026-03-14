# Operation Bredehall 11 – Custom Add-on för Home Assistant
# Bygger en minimal image med Python och FastAPI.

ARG BUILD_FROM
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG BUILD_VERSION

# Meta
LABEL \
    io.hass.name="Operation Bredehall 11" \
    io.hass.description="Smart underhållsplanerare för villan" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}"

# Installera Python och pip om inte redan i base
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Beroenden
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Appkod
COPY app/ ./app/
COPY run.sh .

# Home Assistant mountar /data för persistent lagring; annars använd /share eller /data
ENV DATA_DIR=/data
ENV PYTHONUNBUFFERED=1

# run.sh startar uvicorn
RUN chmod +x run.sh

EXPOSE 8765

CMD [ "/app/run.sh" ]
