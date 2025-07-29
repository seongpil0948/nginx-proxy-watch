const http = require('http');
const os = require('os');

const PORT = process.env.PORT || 3000;
const hostname = os.hostname();

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Host: ${req.headers.host}`);
  
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('OK');
    return;
  }

  const host = req.headers.host || 'unknown';
  const serverNames = process.env.VIRTUAL_HOST || 'unknown';
  const serverNamesList = serverNames.split(' ').filter(name => name.trim());
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Multi-Domain Test App</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          max-width: 800px; 
          margin: 50px auto; 
          padding: 20px;
          background-color: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #2c3e50; }
        .info-box {
          background: #e8f4f8;
          border: 1px solid #b8dae8;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
        }
        .domain-list {
          background: #f0f8ff;
          padding: 10px;
          border-radius: 5px;
          font-family: monospace;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #4CAF50;
          color: white;
        }
        .highlight {
          background-color: #ffeb3b;
          padding: 2px 5px;
          border-radius: 3px;
        }
        .notice {
          background-color: #fff3cd;
          border: 1px solid #ffeeba;
          color: #856404;
          padding: 15px;
          border-radius: 5px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🌐 Multi-Domain Test Application</h1>
        
        <div class="info-box">
          <h2>Current Access Information</h2>
          <p><strong>Accessed via:</strong> <span class="highlight">${host}</span></p>
          <p><strong>Container ID:</strong> ${hostname}</p>
          <p><strong>Server Time:</strong> ${new Date().toISOString()}</p>
        </div>

        <div class="info-box">
          <h2>Configured Domains (Space-Separated)</h2>
          <p>This container is configured with VIRTUAL_HOST:</p>
          <div class="domain-list">${serverNames}</div>
          <p>Parsed as ${serverNamesList.length} domain(s):</p>
          <div class="domain-list">
            ${serverNamesList.map(domain => `• ${domain}`).join('<br>')}
          </div>
        </div>

        <h2>Request Headers</h2>
        <table>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
          ${Object.entries(req.headers).map(([key, value]) => `
            <tr>
              <td>${key}</td>
              <td>${value}</td>
            </tr>
          `).join('')}
        </table>

        <div class="info-box" style="background-color: #e8f8e8; border-color: #b8e8b8; margin-top: 30px;">
          <h3>Test Instructions</h3>
          <p>You can access this application using any of the configured domain names:</p>
          <ul>
            ${serverNamesList.map(domain => `
              <li><a href="http://${domain}/">http://${domain}/</a></li>
            `).join('')}
          </ul>
        </div>

        <div class="notice">
          <h3>📝 Important Note</h3>
          <p>Nginx's <code>server_name</code> directive natively supports space-separated multiple domains.</p>
          <p>When VIRTUAL_HOST="dw.test.local rp.test.local multi.test.local", it generates:</p>
          <pre style="background: #f8f9fa; padding: 10px; border-radius: 5px;">
server {
    server_name dw.test.local rp.test.local multi.test.local;
    ...
}</pre>
          <p>All listed domains will route to this same container!</p>
        </div>
      </div>
    </body>
    </html>
  `;

  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`Multi-domain test server running on port ${PORT}`);
  console.log(`Configured domains: ${process.env.VIRTUAL_HOST || 'none'}`);
});