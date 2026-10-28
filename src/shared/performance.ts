import { z } from 'zod';

export const screenshotPerformanceEvents = [
  'hotkey_pressed',
  'capture_start',
  'permission_check_start',
  'permission_check_end',
  'display_resolve_start',
  'display_resolve_end',
  'capture_engine_warmup_start',
  'capture_engine_warmup_end',
  'capture_warmup_wait_start',
  'capture_warmup_wait_end',
  'main_window_hide_called',
  'main_window_hidden',
  'capture_readiness_start',
  'capture_readiness_end',
  'frame_capture_start',
  'frame_capture_end',
  'sck_request_sent',
  'sck_request_received',
  'sck_capture_start',
  'sck_capture_end',
  'sck_bridge_start',
  'sck_bridge_end',
  'sck_encode_start',
  'sck_encode_end',
  'sck_frame_ready',
  'capture_backend_fallback',
  'overlay_window_create_start',
  'overlay_window_create_end',
  'overlay_load_start',
  'overlay_did_finish_load',
  'renderer_boot_start',
  'react_mount',
  'page_component_mount',
  'capture_frame_request',
  'frame_to_data_url_start',
  'frame_to_data_url_end',
  'frame_encode_start',
  'frame_encode_end',
  'frame_to_png_start',
  'frame_to_png_end',
  'frame_to_jpeg_start',
  'frame_to_jpeg_end',
  'frame_base64_start',
  'frame_base64_end',
  'capture_frame_ipc_return',
  'frame_blob_create_start',
  'frame_blob_create_end',
  'frame_image_decode_start',
  'frame_image_decode_end',
  'capture_overlay_image_loaded',
  'overlay_image_ready',
  'capture_overlay_show_called',
  'capture_overlay_show_returned',
  'capture_overlay_visible',
  'selection_start',
  'selection_end',
  'clipboard_committed',
  'output_queued',
  'output_encode_start',
  'output_encode_end',
  'clipboard_write_start',
  'output_failed',
  'overlay_closed',
  'collection_updated',
  'shelf_feedback_visible',
  'shelf_expand_start',
  'shelf_interactive',
  'shelf_reorder_start',
  'shelf_reorder_updated',
  'capture_finish_ipc_start',
  'capture_finish_main_received',
  'selection_validation_start',
  'selection_validation_end',
  'coordinate_conversion_start',
  'coordinate_conversion_end',
  'crop_start',
  'crop_end',
  'resize_start',
  'resize_end',
  'jpeg_encode_start',
  'jpeg_encode_end',
  'base64_check_start',
  'base64_check_end',
  'pin_window_create_start',
  'pin_window_create_end',
  'pin_load_start',
  'pin_did_finish_load',
  'pin_current_request',
  'pin_current_received',
  'pin_image_load_start',
  'pin_image_load_end',
  'screenshot_to_all_visible',
  'window_preload_start',
  'window_preload_ready',
  'capture_overlay_reuse_start',
  'capture_overlay_shell_show_called',
  'capture_overlay_shell_show_returned',
  'capture_overlay_shell_visible',
  'capture_overlay_reuse_visible',
  'screenshot_window_reuse_start',
  'screenshot_window_reuse_visible',
  'capture_cancelled',
  'capture_closed',
  'capture_error'
] as const;

export type ScreenshotPerformanceEvent = typeof screenshotPerformanceEvents[number];
export type PerformanceMetadataValue = string | number | boolean | null;
export type PerformanceMetadata = Record<string, PerformanceMetadataValue>;

export const performanceSessionIdSchema = z.string().regex(/^capture_\d+_[0-9a-f]{8}$/);
export const performanceMarkSchema = z.object({
  sessionId: performanceSessionIdSchema,
  event: z.enum(screenshotPerformanceEvents),
  sourceTimestampMs: z.number().finite().positive().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).optional()
});

export type ScreenshotPerformanceMarkRequest = z.infer<typeof performanceMarkSchema>;
export type ScreenshotPerformanceSource = 'main' | 'renderer';

export type ScreenshotPerformanceMark = {
  event: ScreenshotPerformanceEvent;
  source: ScreenshotPerformanceSource;
  atMs: number;
  elapsedMs: number;
  receivedAtMs?: number;
  metadata?: PerformanceMetadata;
};

export type ScreenshotPerformanceMeasure = {
  id: string;
  label: string;
  start: ScreenshotPerformanceEvent;
  end: ScreenshotPerformanceEvent;
  durationMs: number;
  category: 'local' | 'network';
  warning?: 'notice' | 'slow' | 'very-slow';
};

export type ScreenshotPerformanceReport = {
  sessionId: string;
  createdAt: string;
  metadata: PerformanceMetadata;
  metrics: {
    selectionToScreenshotVisibleMs?: number;
    hotkeyToOverlayVisibleMs?: number;
    captureStartToOverlayVisibleMs?: number;
    captureStartToOverlayShellVisibleMs?: number;
  };
  measures: ScreenshotPerformanceMeasure[];
  marks: ScreenshotPerformanceMark[];
};
