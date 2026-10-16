export interface WebSearchResult { title: string; url: string; snippet: string; publishedAt?: string }
export interface WebSearchRequest { query: string; maxResults: number; signal: AbortSignal }
export interface WebSearchResponse {
  results: WebSearchResult[];
  queries?: Array<{ query: string; count: number; error?: string }>;
  partial?: boolean;
}

/** Provider adapters own credentials/protocol mapping; never referenced by AgentLoop. */
export interface WebSearchProvider {
  readonly id: string;
  search(request: WebSearchRequest): Promise<WebSearchResponse>;
}
