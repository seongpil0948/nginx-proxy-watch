// example/app-common/server.js
const http = require('http');
const port = process.env.PORT || 8080; // 컨테이너 내부 포트
const appName = process.env.APP_NAME || 'Unknown App';

const server = http.createServer((req, res) => {
  console.log(`[${appName}] Request received: ${req.method} ${req.url}`);

  // 쿠키 읽기 (테스트 목적)
  const cookies = req.headers.cookie;
  let cookieInfo = 'No cookies received.';
  if (cookies) {
    cookieInfo = `Received cookies: ${cookies}`;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<h1>Hello from ${appName}!</h1><p>Request URL: ${req.url}</p><p>${cookieInfo}</p>`);
});

server.listen(port, () => {
  console.log(`[${appName}] Server listening on port ${port}`);
});
