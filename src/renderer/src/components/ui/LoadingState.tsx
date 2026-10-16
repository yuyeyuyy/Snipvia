export function LoadingState({ children }: { children: string }) {
  return <div className="ui-loading-state" role="status"><span className="ui-spinner" aria-hidden="true" />{children}</div>;
}
