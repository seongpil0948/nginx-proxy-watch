// example/app-common/server.js에 추가
const http = require('http');
const os = require('os');
const fs = require('fs');
const port = process.env.PORT || 8080;
const appName = process.env.APP_NAME || 'Unknown App';
const instanceName = process.env.INSTANCE_NAME || 'Default';

// 헬스체크 상태를 저장할 파일 경로
const HEALTH_STATUS_FILE = '/tmp/health_status.json';


const SUB_PATH = process.env.VIRTUAL_LOCATION_PATH
const BASE_PATH = SUB_PATH ? `/${SUB_PATH}` : ''
const ENDPOINTS = {
  health: `${BASE_PATH}/health`,
  failHealth: `${BASE_PATH}/fail-health`,
  restoreHealth: `${BASE_PATH}/restore-health`
}

// 초기 헬스 상태 설정
let healthStatus = {
  status: 'healthy',
  lastChanged: new Date().toISOString(),
  forcedFailure: false
};

// 파일에서 상태 로드 (있는 경우)
try {
  if (fs.existsSync(HEALTH_STATUS_FILE)) {
    const savedStatus = JSON.parse(fs.readFileSync(HEALTH_STATUS_FILE, 'utf8'));
    healthStatus = savedStatus;
    console.log(`[${appName}] Loaded health status: ${healthStatus.status}`);
  }
} catch (error) {
  console.error(`[${appName}] Error loading health status:`, error);
}

// 상태 저장 함수
function saveHealthStatus() {
  try {
    fs.writeFileSync(HEALTH_STATUS_FILE, JSON.stringify(healthStatus));
  } catch (error) {
    console.error(`[${appName}] Error saving health status:`, error);
  }
}

const server = http.createServer((req, res) => {
  console.log(`[${appName}] Request received: ${req.method} ${req.url}`);

  // 헬스체크 엔드포인트
  if (req.url === ENDPOINTS.health) {
    if (healthStatus.status === 'healthy') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', app: appName, instance: instanceName }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'failed', 
        reason: healthStatus.forcedFailure ? 'Manually forced unhealthy' : 'Internal error',
        app: appName, 
        instance: instanceName 
      }));
    }
    return;
  }

  // 헬스 상태를 unhealthy로 변경하는 엔드포인트
  if (req.url === ENDPOINTS.failHealth) {
    healthStatus.status = 'unhealthy';
    healthStatus.lastChanged = new Date().toISOString();
    healthStatus.forcedFailure = true;
    saveHealthStatus();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Health status set to unhealthy', app: appName }));
    return;
  }

  // 헬스 상태를 healthy로 복구하는 엔드포인트
  if (req.url === ENDPOINTS.restoreHealth) {
    healthStatus.status = 'healthy';
    healthStatus.lastChanged = new Date().toISOString();
    healthStatus.forcedFailure = false;
    saveHealthStatus();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Health status restored to healthy', app: appName }));
    return;
  }

  // 요청 헤더 추출
  const headers = req.headers;
  
  // 쿠키 읽기
  const cookies = headers.cookie;
  let cookieInfo = 'No cookies received.';
  if (cookies) {
    cookieInfo = `Received cookies: ${cookies}`;
  }
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
        .health-controls { background-color: #f2d7d5; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        code { background-color: #f1f1f1; padding: 2px 5px; border-radius: 3px; }
        button { padding: 8px 15px; margin: 5px; cursor: pointer; border-radius: 4px; border: none; }
        .fail-btn { background-color: #e74c3c; color: white; }
        .restore-btn { background-color: #2ecc71; color: white; }
      </style>
    </head>
    <body>
      <div class="app-info">
        <h1>Hello from ${appName}!</h1>
        <p>Instance: ${instanceName}</p>
        <p>Health Status: <strong>${healthStatus.status}</strong></p>
      </div>

      <div class="health-controls">
        <h2>Health Controls</h2>
        <p>Current health status: <strong>${healthStatus.status}</strong> (Last changed: ${healthStatus.lastChanged})</p>
        <button class="fail-btn" onclick="fetch('${ENDPOINTS.failHealth}').then(r=>r.json()).then(data=>{alert(data.message);window.location.reload()})">
          Make Unhealthy
        </button>
        <button class="restore-btn" onclick="fetch('${ENDPOINTS.restoreHealth}').then(r=>r.json()).then(data=>{alert(data.message);window.location.reload()})">
          Restore Health
        </button>
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
  saveHealthStatus()
  console.log(`[${appName}] Server listening on port ${port}`);
});