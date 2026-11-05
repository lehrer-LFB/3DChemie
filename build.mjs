// Erstellt das Upload-Paket für einen Webserver: node build.mjs
// Ergebnis: dist/ (Inhalt in das Verzeichnis der Subdomain hochladen) und 3dchemie-web.zip
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
fs.cpSync(path.join(ROOT, 'src'), path.join(DIST, 'src'), { recursive: true });

// Apache: korrekte MIME-Typen, HTTPS erzwingen, kurze Cache-Zeit (Updates kommen schnell an)
fs.writeFileSync(path.join(DIST, '.htaccess'), `AddType text/javascript .js .mjs
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} !=on
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>
<IfModule mod_headers.c>
  Header set Cache-Control "max-age=300"
</IfModule>
`);

const zip = path.join(ROOT, '3dchemie-web.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: DIST });
console.log('Fertig: dist/ und 3dchemie-web.zip');
