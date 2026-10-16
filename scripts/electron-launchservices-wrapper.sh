#!/bin/zsh
set -euo pipefail

: "${SNIPVIA_DEV_APP_PATH:?缺少固定开发应用路径}"
: "${SNIPVIA_PROJECT_ROOT:?缺少项目路径}"

electron_args=("$@")
if [[ "${electron_args[1]:-}" == "." ]]; then
  electron_args[1]="$SNIPVIA_PROJECT_ROOT"
fi

log_path="$SNIPVIA_PROJECT_ROOT/.dev-runtime/app.log"
: > "$log_path"
open_args=(-W -n --stdout "$log_path" --stderr "$log_path" "$SNIPVIA_DEV_APP_PATH")
while IFS='=' read -r name value; do
  if [[ "$name" == SNIPVIA_* || "$name" == "ELECTRON_RENDERER_URL" || "$name" == "NODE_ENV_ELECTRON_VITE" ]]; then
    open_args+=(--env "$name=$value")
  fi
done < <(env)

open_pid=''
tail_pid=''
stop_launched_app() {
  trap - INT TERM HUP
  [[ -n "$tail_pid" ]] && kill "$tail_pid" 2>/dev/null || true
  [[ -n "$open_pid" ]] && kill "$open_pid" 2>/dev/null || true
  local command="$SNIPVIA_DEV_APP_PATH/Contents/MacOS/Electron $SNIPVIA_PROJECT_ROOT"
  /usr/bin/pgrep -f -x "$command" 2>/dev/null | while read -r pid; do
    kill -TERM "$pid" 2>/dev/null || true
  done
}
trap stop_launched_app INT TERM HUP

/usr/bin/open "${open_args[@]}" --args "${electron_args[@]}" &
open_pid=$!
/usr/bin/tail -n +1 -F "$log_path" &
tail_pid=$!
if wait "$open_pid"; then exit_code=0; else exit_code=$?; fi
kill "$tail_pid" 2>/dev/null || true
exit "$exit_code"
