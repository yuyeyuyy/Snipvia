const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function reviewedSupplement(directory, metadata) {
  // Only this exact reviewed published archive is eligible; never infer a
  // generic license text for other packages or silently accept a new version.
  if (metadata.name !== 'lazy-val' || metadata.version !== '1.0.5') return null;
  const folder = path.join(path.dirname(module.filename), 'licenses');
  const review = JSON.parse(fs.readFileSync(path.join(folder, 'lazy-val-1.0.5.json'), 'utf8'));
  if (metadata.license !== review.license || metadata.author !== review.author)
    throw new Error('Reviewed license supplement metadata changed');
  for (const [file, sha256] of Object.entries(review.files)) {
    if (digest(fs.readFileSync(path.join(directory, file))) !== sha256)
      throw new Error('Reviewed license supplement package contents changed');
  }
  const bytes = fs.readFileSync(path.join(folder, review.notice));
  if (digest(bytes) !== review.noticeSha256) throw new Error('Reviewed license supplement text changed');
  return { bytes, file: `reviewed-supplement/${review.notice}`, sha256: review.noticeSha256,
    provenance: review.sources, originalNoticeSupplied: false };
}
module.exports = { reviewedSupplement };
