import { parentPort } from 'node:worker_threads';
import { encodeBgraPng, type BitmapCrop } from './encode-bgra-png';
parentPort?.on('message', async (input: BitmapCrop & { id: number }) => {
  try {
    const png = await encodeBgraPng(input), bytes = Uint8Array.from(png);
    parentPort!.postMessage({ id: input.id, bytes }, [bytes.buffer]);
  } catch (error) { parentPort!.postMessage({ id: input.id, error: error instanceof Error ? error.message : '截图编码失败' }); }
});
