# معماری Local Server Pro

## مسیر درخواست عمومی

`Browser -> Cloudflare Edge/CDN -> Cloudflare Tunnel -> Local Reverse Proxy -> Project Port`

یک Tunnel نام‌دار می‌تواند چند hostname را حمل کند. Local Server Pro تمام hostnameها را به Reverse Proxy مرکزی می‌فرستد و Proxy بر اساس `Host` پروژه مقصد را انتخاب می‌کند. به این ترتیب برای هر پروژه لازم نیست Tunnel جدا ساخته شود.

## اجزای اصلی

- **Project Manager:** اجرای Process، Restart خودکار، Health Check، CPU/RAM و Live Log.
- **Reverse Proxy:** Route دامنه، WebSocket/HMR، هدرهای Forwarded و CDN cache preset.
- **Cloudflare Manager:** login/create/list/run Tunnel و DNS route برای hostnameها.
- **Config Store:** ذخیره اتمیک JSON در `~/.local-server-pro` و عدم ذخیره credential داخل repository.
- **Persian Control Panel:** Dashboard RTL و ارتباط Real-time با Server-Sent Events.

## CDN

Cloudflare Tunnel ترافیک عمومی را از Edge Cloudflare عبور می‌دهد. Local Server Pro سه preset هدر Cache-Control دارد. این presetها جایگزین Cache Ruleهای اختصاصی Cloudflare نیستند؛ اگر HTML یا API باید به‌صورت اجباری در Edge cache شود، بهتر است Cache Rules از داشبورد Cloudflare تنظیم شوند تا تنظیمات دیگر Zone ناخواسته overwrite نشوند.

## فاز Game Hosting

برای بازی Browser-based که از HTTPS/WebSocket استفاده می‌کند همین معماری مناسب است. برای پروتکل‌های Native که UDP یا TCP خام نیاز دارند، Cloudflare Tunnel معمول HTTP کافی نیست. فاز بعد باید یک Game Gateway جداگانه برای Port Mapping، UDP/TCP، Session discovery و rate limiting داشته باشد؛ یا از سرویس‌هایی مانند Cloudflare Spectrum در پلن مناسب استفاده شود.
