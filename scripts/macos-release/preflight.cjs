const console = require('node:console');
const process = require('node:process');
const { preflight } = require('./common.cjs');

try {
  const identity = preflight();
  console.log(`本地预检通过：${identity.name}`);
  console.log('公证 Profile 已指定；此预检没有上传文件或验证远程凭据。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
