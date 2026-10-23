import { z } from 'zod';
import { captureFinishSchema } from './contracts';

export const editorFinishSchema = captureFinishSchema.extend({
  action: z.enum(['copy', 'save', 'pin']),
  png: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 64 * 1024 * 1024, '截图文件过大')
});
export type EditorFinishRequest = z.infer<typeof editorFinishSchema>;
export type EditorAction = EditorFinishRequest['action'];
export type EditorCrop = {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
};

// Check the PNG header before NativeImage allocates a decoded bitmap.
export function validateEditorPng(bytes: Uint8Array, expected: { width: number; height: number }) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)
    || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('标注截图必须为 PNG');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(16) !== expected.width || header.getUint32(20) !== expected.height) {
    throw new Error('标注截图尺寸与选区不一致');
  }
}
