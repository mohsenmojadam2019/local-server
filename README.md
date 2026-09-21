# Local Server Pro

پنل حرفه‌ای فارسی برای تبدیل سیستم توسعه به یک **Local Application Server**: اجرای هم‌زمان پروژه‌ها، Reverse Proxy بر اساس Domain، دامنه عمومی، Cloudflare Tunnel، CDN preset، WebSocket/HMR، Health Check، Live Log و مانیتورینگ CPU/RAM.

## قابلیت‌ها

- مدیریت تعداد نامحدود پروژه در حد منابع سیستم
- تشخیص Nuxt / Next / Vite / React / Vue / Angular / Laravel / Django / PHP
- Start / Stop / Restart و Restart خودکار بعد از Crash
- پورت مجزا برای هر پروژه و متغیر `{port}` در فرمان اجرا
- دامنه لوکال مانند `shop.localhost`
- Reverse Proxy مرکزی با Route بر اساس Host
- WebSocket و HMR
- اتصال دامنه واقعی مثل `app.example.com` به هر پروژه
- Cloudflare Named Tunnel برای HTTPS عمومی بدون Port Forwarding مودم
- DNS Route از داخل پنل با `cloudflared tunnel route dns`
- سه حالت CDN header: خاموش، استاندارد و تهاجمی
- Health Check، CPU، RAM، Uptime و Live Log
- Auto Start برای پروژه‌های انتخابی
- File Browser محلی برای انتخاب پوشه پروژه
- پنل فارسی RTL بدون وابستگی Frontend به CDN خارجی

## اجرا روی Windows

نیازمندی: **Node.js 20 یا جدیدتر**.

```bat
scripts\start-windows.bat
```

یا:

```bash
npm install
npm start
```

پنل پیش‌فرض:

```text
http://127.0.0.1:8788
```

Reverse Proxy پیش‌فرض:

```text
http://127.0.0.1:8787
```

اگر پروژه‌ای با local domain برابر `shop.localhost` بسازید، آدرس آن خواهد بود:

```text
http://shop.localhost:8787
```

## اتصال دامنه واقعی با Cloudflare

1. `cloudflared` را نصب کنید. در Windows:

```bat
scripts\install-cloudflared-windows.bat
```

2. در پنل وارد بخش **Cloudflare Tunnel** شوید و «ورود Cloudflare» را بزنید.
3. Tunnel را بسازید.
4. از بخش **دامنه و CDN** یک hostname مثل `dev.example.com` را به پروژه متصل کنید.
5. Tunnel را روشن کنید.

درخواست به شکل زیر عبور می‌کند:

```text
https://dev.example.com
        ↓
Cloudflare Edge/CDN
        ↓
Named Tunnel
        ↓
Local Server Pro :8787
        ↓
Project :3000 / :8000 / ...
```

## نکته CDN

Presetهای داخل برنامه `Cache-Control` را روی پاسخ پروژه تنظیم می‌کنند. Cloudflare برای فایل‌های قابل cache از Edge استفاده می‌کند. برنامه عمداً Cache Ruleهای Zone را به‌صورت خودکار overwrite نمی‌کند تا Ruleهای موجود دامنه آسیب نبینند.

## بازی آنلاین — فاز بعد

برای Web Game با WebSocket زیرساخت فعلی قابل استفاده است. برای Game Serverهای UDP/TCP خام باید Game Gateway جداگانه طراحی شود؛ این قسمت در نسخه فعلی عمداً وارد نشده تا هسته Hosting پایدار بماند.

جزئیات بیشتر: `docs/ARCHITECTURE.md`
