const console = require('node:console');
const process = require('node:process');
const { ensure, verifyApp, verifyDmg, verifyZip } = require('./common.cjs');

try {
  const args = process.argv.slice(2);
  const [kind, file, archFlag, arch] = args;
  ensure(args.length === 4 && archFlag === '--arch' && ['--app', '--dmg', '--zip'].includes(kind),
    '用法：node scripts/macos-release/verify.cjs --app|--dmg|--zip <绝对路径> --arch arm64|x64');
  const verify = { '--app': verifyApp, '--dmg': verifyDmg, '--zip': verifyZip }[kind];
  console.log(JSON.stringify(verify(file, arch)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
