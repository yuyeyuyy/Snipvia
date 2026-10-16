import { randomUUID } from 'node:crypto';
import { predictionBranchListSchema, type PredictionBranch } from '../../../shared/screenshot-understanding';
import { branchOperationsSchema, type BranchOperation } from '../../../shared/agent/editing';
import { createFileDiff } from '../fileChanges/textPatch';

/** Schema order keeps field-only changes readable without rewriting unrelated rules in the diff. */
export const branchContent = (branches: PredictionBranch[]) => JSON.stringify(predictionBranchListSchema.parse(branches), null, 2);

/** Show independent rule changes instead of replacing the entire range between distant changes. */
export function branchDiff(before: PredictionBranch[], after: PredictionBranch[]): string {
  const old = predictionBranchListSchema.parse(before), next = predictionBranchListSchema.parse(after);
  const diffs: string[] = [];
  for (const id of new Set([...old.map(branch => branch.id), ...next.map(branch => branch.id)])) {
    const left = old.find(branch => branch.id === id), right = next.find(branch => branch.id === id);
    const previous = left ? JSON.stringify(left, null, 2) : null, updated = right ? JSON.stringify(right, null, 2) : null;
    if (previous !== updated) diffs.push(createFileDiff(`截图预测规则/${id}`, previous, updated));
  }
  const previousOrder = JSON.stringify(old.map(branch => branch.id), null, 2), updatedOrder = JSON.stringify(next.map(branch => branch.id), null, 2);
  if (previousOrder !== updatedOrder) diffs.push(createFileDiff('截图预测规则/顺序', previousOrder, updatedOrder));
  return diffs.join('\n\n');
}

/** Pure candidate construction. No generated identity or fields can change an existing rule's kind. */
export function proposeBranches(before: PredictionBranch[], selected: string[], input: BranchOperation[]): PredictionBranch[] {
  const operations = branchOperationsSchema.parse(input);
  const authorized = new Set(selected);
  let after = structuredClone(before);
  for (const operation of operations) {
    if (operation.op === 'create') {
      const branch: PredictionBranch = { ...operation.branch, id: `custom:${randomUUID()}`, builtin: false, mode: 'ai' };
      const position = operation.position ?? after.length;
      if (position > after.length) throw new Error('新增位置超出分支列表');
      after.splice(position, 0, branch);
    } else if (operation.op === 'reorder') {
      const remaining = new Set(after.filter(branch => authorized.has(branch.id)).map(branch => branch.id));
      if (new Set(operation.ids).size !== operation.ids.length || operation.ids.length !== remaining.size || operation.ids.some(id => !remaining.has(id))) throw new Error('顺序必须包含全部已授权分支，且不能重复或引用新分支');
      const ordered = operation.ids.map(id => after.find(branch => branch.id === id));
      if (ordered.some(branch => !branch)) throw new Error('排序引用的分支不存在');
      let index = 0; after = after.map(branch => authorized.has(branch.id) ? ordered[index++]! : branch);
    } else {
      if (!authorized.has(operation.id)) throw new Error('操作引用了未授权的分支');
      const index = after.findIndex(branch => branch.id === operation.id);
      if (index < 0) throw new Error('分支不存在或已被移除');
      if (operation.op === 'remove') {
        if (after[index].builtin) throw new Error('内置分支不能删除，可以将 enabled 改为 false');
        after.splice(index, 1);
      } else after[index] = { ...after[index], ...operation.patch };
    }
  }
  const valid = predictionBranchListSchema.parse(after);
  if (valid.length !== after.length) throw new Error('不能恢复已停用的旧分支类型');
  if (branchContent(valid) === branchContent(before)) throw new Error('分支内容没有变化');
  return valid;
}
