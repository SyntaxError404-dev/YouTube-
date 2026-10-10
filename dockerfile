FROM node:18-bullseye-slim

# The script relies on child_process.execSync('tesseract ...')
# We must inject Tesseract OCR into the OS environment.
RUN apt-get update && \
    apt-get install -y tesseract-ocr tesseract-ocr-eng libvips-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/extractor

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
