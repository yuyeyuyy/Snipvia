const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const console = require('node:console');

/** Create metadata only from frozen, finally verified files, without mutating them. */
function macUpdateMetadata(directory) {
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'verification.json'), 'utf8'));
  if (report.teamId !== 'F76JCDMA4Y' || !/^\d+\.\d+\.\d+(?:\+[A-Za-z0-9.-]+)?$/.test(report.version)
    || !Array.isArray(report.artifacts) || report.artifacts.length !== 4) throw new Error('正式 Mac 验收清单无效');
  const names = ['arm64', 'x64'].flatMap(arch => ['zip', 'dmg'].map(ext => `Snipvia-${report.version}-${arch}.${ext}`));
  const files = names.map(name => {
    const entries = report.artifacts.filter(item => item.name === name);
    if (entries.length !== 1 || !/^[a-f0-9]{64}$/.test(entries[0].sha256)) throw new Error('验收文件缺失或重复');
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error('更新文件必须是完整的普通文件');
    const content = fs.readFileSync(file);
    if (createHash('sha256').update(content).digest('hex') !== entries[0].sha256) throw new Error('冻结发布文件校验失败');
    return { url: name, sha512: createHash('sha512').update(content).digest('base64'), size: stat.size };
  });
  // JSON is a valid YAML subset. The official updater's pinned parser reads it.
  return JSON.stringify({ version: report.version, files, path: files[0].url, sha512: files[0].sha512,
    releaseDate: new Date().toISOString() }, null, 2) + '\n';
}

/** Write parseable manifests once, after the final artifact hashes are frozen. */
function writeVerificationFiles(directory, report) {
  fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const metadata = macUpdateMetadata(directory); // Recheck the frozen artifact hashes before writing the channel.
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), report.artifacts.map(artifact => `${artifact.sha256}  ${artifact.name}\n`).join(''), { flag: 'wx' });
  fs.writeFileSync(path.join(directory, 'latest-mac.yml'), metadata, { flag: 'wx' });
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('用法：node scripts/macos-release/update-metadata.cjs <verified 目录> <新输出文件>');
    const metadata = macUpdateMetadata(path.resolve(process.argv[2]));
    fs.writeFileSync(path.resolve(process.argv[3]), metadata, { flag: 'wx', mode: 0o644 });
    console.log('已生成基于最终冻结文件的 Mac 更新元数据；尚未上传。');
  } catch (error) { console.error(error instanceof Error ? error.message : '更新元数据生成失败'); process.exitCode = 1; }
}
module.exports = { macUpdateMetadata, writeVerificationFiles };
