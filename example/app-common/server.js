// example/app-common/server.js
const http = require('http');
const os = require('os');
const port = process.env.PORT || 8080;
const appName = process.env.APP_NAME || 'Unknown App';
const instanceName = process.env.INSTANCE_NAME || 'Default';

const server = http.createServer((req, res) => {
  console.log(`[${appName}] Request received: ${req.method} ${req.url}`);

  // 요청 헤더 추출
  const headers = req.headers;
  
  // 쿠키 읽기
  const cookies = headers.cookie;
  let cookieInfo = 'No cookies received.';
  if (cookies) {
    cookieInfo = `Received cookies: ${cookies}`;
  }

  // 응답 생성
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${appName}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        h1 { color: #2c3e50; }
        .app-info { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        .request-info { background-color: #e9f7ef; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        .system-info { background-color: #eaf2f8; padding: 15px; border-radius: 5px; }
        .cookie-info { background-color: #fdebd0; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        code { background-color: #f1f1f1; padding: 2px 5px; border-radius: 3px; }
      </style>
    </head>
    <body>
      <div class="app-info">
        <h1>Hello from ${appName}!</h1>
        <p>Instance: ${instanceName}</p>
      </div>

      <div class="request-info">
        <h2>Request Information</h2>
        <p>URL: ${req.url}</p>
        <p>Method: ${req.method}</p>
        <p>Time: ${new Date().toISOString()}</p>
      </div>

      <div class="cookie-info">
        <h2>Cookie Information</h2>
        <p>${cookieInfo}</p>
      </div>

      <div class="system-info">
        <h2>Server Information</h2>
        <p>Host: ${os.hostname()}</p>
        <p>Platform: ${os.platform()} ${os.release()}</p>
        <p>Uptime: ${Math.floor(os.uptime() / 60)} minutes</p>
        <p>Memory: ${Math.round(os.freemem() / 1024 / 1024)} MB free of ${Math.round(os.totalmem() / 1024 / 1024)} MB</p>
      </div>
    </body>
    </html>
  `);
});

server.listen(port, () => {
  console.log(`[${appName}] Server listening on port ${port}`);
});