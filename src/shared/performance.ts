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
  'history_create_start',
  'history_mkdir_start',
  'history_mkdir_end',
  'jpeg_disk_write_start',
  'jpeg_disk_write_end',
  'jpeg_disk_rename_start',
  'jpeg_disk_rename_end',
  'history_json_serialize_start',
  'history_json_serialize_end',
  'history_json_write_start',
  'history_json_write_end',
  'history_json_rename_start',
  'history_json_rename_end',
  'history_read_start',
  'jpeg_disk_read_start',
  'jpeg_disk_read_end',
  'second_base64_start',
  'second_base64_end',
  'history_read_end',
  'history_create_end',
  'pin_window_create_start',
  'pin_window_create_end',
  'pin_load_start',
  'pin_did_finish_load',
  'pin_current_request',
  'pin_current_received',
  'pin_image_load_start',
  'pin_image_load_end',
  'screenshot_to_all_visible',
  'auto_analysis_start',
  'local_ocr_start',
  'local_ocr_end',
  'vision_classification_start',
  'vision_classification_end',
  'auto_analysis_end',
  'auto_action_selected',
  'auto_action_start',
  'window_preload_start',
  'window_preload_ready',
  'capture_overlay_reuse_start',
  'capture_overlay_shell_show_called',
  'capture_overlay_shell_show_returned',
  'capture_overlay_shell_visible',
  'capture_overlay_reuse_visible',
  'screenshot_window_reuse_start',
  'screenshot_window_reuse_visible',
  'quick_chat_window_create_start',
  'quick_chat_window_create_end',
  'quick_chat_load_start',
  'quick_chat_did_finish_load',
  'quick_chat_visible',
  'chat_send_clicked',
  'chat_send_ipc_start',
  'chat_send_main_received',
  'message_history_prepare_start',
  'message_history_prepare_end',
  'ai_request_start',
  'fetch_start',
  'fetch_headers_received',
  'ai_first_token',
  'ai_body_parse_start',
  'ai_body_parse_end',
  'ai_response_complete',
  'assistant_message_save_start',
  'assistant_message_save_end',
  'chat_ipc_return',
  'chat_renderer_received',
  'chat_response_visible',
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
  metadata: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).optional()
});

export type ScreenshotPerformanceMarkRequest = z.infer<typeof performanceMarkSchema>;
export type ScreenshotPerformanceSource = 'main' | 'renderer';

export type ScreenshotPerformanceMark = {
  event: ScreenshotPerformanceEvent;
  source: ScreenshotPerformanceSource;
  atMs: number;
  elapsedMs: number;
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
    aiRequestToCompleteMs?: number;
    screenshotVisibleToAutoFirstTokenMs?: number;
  };
  measures: ScreenshotPerformanceMeasure[];
  marks: ScreenshotPerformanceMark[];
};
