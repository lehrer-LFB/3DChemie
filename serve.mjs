// Kleiner statischer Server für die Entwicklung – ohne Abhängigkeiten.
//
//   node serve.mjs
//
// • http://localhost:8080     → Test am Mac (WebXR-Emulator o. ä.)
// • https://<LAN-IP>:8443     → Test auf Quest/Pico im selben WLAN
//   (selbstsigniertes Zertifikat: in der Brille einmal „Erweitert → Trotzdem fortfahren“)
//
// WebXR verlangt einen „sicheren Kontext“ – deshalb HTTPS für die Brille.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(ROOT, '.cert');
const HTTP_PORT = 8080, HTTPS_PORT = 8443;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

function handler(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}.cert`)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const lanIPs = Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem'), cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIPs.map((ip) => `IP:${ip}`)].join(',');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', key, '-out', cert, '-subj', '/CN=3DChemie-dev', '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

http.createServer(handler).listen(HTTP_PORT, () => console.log(`Desktop:  http://localhost:${HTTP_PORT}`));
try {
  https.createServer(ensureCert(), handler).listen(HTTPS_PORT, '0.0.0.0', () => {
    for (const ip of lanIPs) console.log(`VR-Brille: https://${ip}:${HTTPS_PORT}`);
  });
} catch (e) {
  console.warn('HTTPS nicht verfügbar (openssl fehlt?):', e.message);
}
