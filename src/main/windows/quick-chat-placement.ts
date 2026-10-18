type Rectangle = { x: number; y: number; width: number; height: number };
type Size = Pick<Rectangle, 'width' | 'height'>;

export function quickChatBounds(pinned: Rectangle, workArea: Rectangle, size: Size): Rectangle {
  const gap = 10;
  const rightSpace = workArea.x + workArea.width - (pinned.x + pinned.width + gap);
  const leftSpace = pinned.x - gap - workArea.x;
  const useRight = rightSpace >= size.width || rightSpace >= leftSpace;
  const desiredX = useRight ? pinned.x + pinned.width + gap : pinned.x - gap - size.width;
  const x = Math.max(workArea.x, Math.min(desiredX, workArea.x + workArea.width - size.width));
  const y = Math.max(workArea.y, Math.min(pinned.y, workArea.y + workArea.height - size.height));
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
}

/** Expanded workspace stays on the screenshot's display, including negative origins. */
export function quickWorkspaceBounds(workArea: Rectangle, size: Size): Rectangle {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return { x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2), width, height };
}

/** Keep a manually resized floating chat inside its current display's work area. */
export function resizedQuickChatBounds(current: Rectangle, workArea: Rectangle, size: Size): Rectangle {
  const width = Math.min(workArea.width, Math.max(340, Math.round(size.width)));
  const height = Math.min(workArea.height, Math.max(360, Math.round(size.height)));
  return { x: Math.round(Math.max(workArea.x, Math.min(current.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(current.y, workArea.y + workArea.height - height))), width, height };
}
