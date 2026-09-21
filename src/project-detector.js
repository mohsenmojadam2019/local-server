const fs = require('fs');
const path = require('path');

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function detectProject(projectPath, port) {
  const result = {
    framework: 'custom',
    command: '',
    suggestedPort: port || 3000,
    notes: [],
  };

  const pkgPath = path.join(projectPath, 'package.json');
  const pkg = safeReadJson(pkgPath);
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};
    if (deps.nuxt) result.framework = 'nuxt';
    else if (deps.next) result.framework = 'next';
    else if (deps.vite) result.framework = 'vite';
    else if (deps['@angular/core']) result.framework = 'angular';
    else if (deps.react) result.framework = 'react';
    else if (deps.vue) result.framework = 'vue';
    else result.framework = 'node';

    if (scripts.dev) result.command = `npm run dev -- --port {port}`;
    else if (scripts.start) result.command = 'npm start';
    else if (scripts.serve) result.command = `npm run serve -- --port {port}`;
    else result.notes.push('اسکریپت dev/start در package.json پیدا نشد.');

    if (result.framework === 'nuxt' && scripts.dev) result.command = 'npm run dev -- --port {port}';
    if (result.framework === 'next' && scripts.dev) result.command = 'npm run dev -- -p {port}';
    if (result.framework === 'vite' && scripts.dev) result.command = 'npm run dev -- --host 127.0.0.1 --port {port}';
    if (result.framework === 'angular' && scripts.start) result.command = 'npm start -- --host 127.0.0.1 --port {port}';
    return result;
  }

  if (fs.existsSync(path.join(projectPath, 'artisan'))) {
    return { framework: 'laravel', command: 'php artisan serve --host=127.0.0.1 --port={port}', suggestedPort: port || 8000, notes: [] };
  }
  if (fs.existsSync(path.join(projectPath, 'manage.py'))) {
    return { framework: 'django', command: 'python manage.py runserver 127.0.0.1:{port}', suggestedPort: port || 8000, notes: [] };
  }
  if (fs.existsSync(path.join(projectPath, 'composer.json'))) {
    return { framework: 'php', command: 'php -S 127.0.0.1:{port} -t public', suggestedPort: port || 8000, notes: ['در صورت نبود پوشه public، دستور را ویرایش کنید.'] };
  }
  if (fs.existsSync(path.join(projectPath, 'index.html'))) {
    return { framework: 'static', command: 'npx --yes serve . -l {port}', suggestedPort: port || 5000, notes: ['برای اولین اجرا ممکن است npx نیاز به اینترنت داشته باشد.'] };
  }
  return result;
}

module.exports = { detectProject };
