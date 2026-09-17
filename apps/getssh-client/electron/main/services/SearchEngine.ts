export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchConfig {
  enabled: boolean;
  provider: 'hybrid' | 'google' | 'searxng' | 'duckduckgo' | 'bing';
  googleApiKey?: string;
  googleCx?: string;
  customUrl?: string;
}

export class SearchEngine {
  private static searxInstances: string[] = [];
  private static lastFetchTime: number = 0;
  private static fetchingPromise: Promise<void> | null = null;
  private static FETCH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

  /**
   * Search the web using the configured provider strategy.
   */
  static async search(query: string, config: SearchConfig): Promise<SearchResult[]> {
    if (!config.enabled) {
      throw new Error('Web search is disabled in settings.');
    }

    console.log(`[SearchEngine] 🌐 Initiating web search for query: "${query}" using provider: ${config.provider}`);

    // If Google Provider
    if (config.provider === 'google') {
      if (!config.googleApiKey || !config.googleCx) {
        throw new Error('Google Search requires both API Key and Search Engine ID (CX) to be configured in settings.');
      }
      return await SearchEngine.searchGoogle(query, config.googleApiKey, config.googleCx);
    }

    // Determine the chain based on the provider setting
    let providers: ((q: string, cfg: SearchConfig) => Promise<SearchResult[]>)[] = [];

    if (config.provider === 'duckduckgo') {
      providers = [SearchEngine.searchDuckDuckGo];
    } else if (config.provider === 'bing') {
      providers = [SearchEngine.searchBing];
    } else if (config.provider === 'searxng') {
      providers = [SearchEngine.searchSearXNG];
    } else {
      // hybrid fallback (default)
      providers = [
        SearchEngine.searchSearXNG,
        SearchEngine.searchDuckDuckGo,
        SearchEngine.searchBing,
      ];
    }

    for (const provider of providers) {
      try {
        const results = await provider(query, config);
        if (results && results.length > 0) {
          console.log(`[SearchEngine] ✅ Search succeeded using provider: ${provider.name}`);
          return results;
        }
      } catch (e: any) {
        console.warn(`[SearchEngine] ⚠️ Provider ${provider.name} failed: ${e.message}`);
        // If it's a specific provider (not hybrid), or it's hybrid and we try next...
        if (config.provider !== 'hybrid') {
          throw e; // Bubble up directly if user explicitly requested this provider
        }
      }
    }

    throw new Error('All search providers failed or returned no results.');
  }

  // =========================================================================
  // Provider Implementations
  // =========================================================================

  /**
   * Primary Provider: Google Custom Search API
   */
  private static async searchGoogle(query: string, apiKey: string, cx: string): Promise<SearchResult[]> {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Google API Error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      if (data.items && data.items.length > 0) {
        return data.items.slice(0, 10).map((r: any) => ({
          title: r.title || 'Untitled',
          url: r.link,
          snippet: r.snippet || ''
        }));
      }
      return [];
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private static async fetchSearxInstances(): Promise<void> {
    const now = Date.now();
    if (this.searxInstances.length > 0 && now - this.lastFetchTime < this.FETCH_INTERVAL_MS) {
      return;
    }

    if (this.fetchingPromise) {
      return this.fetchingPromise;
    }

    this.fetchingPromise = (async () => {
      console.log('[SearchEngine] Fetching fresh SearXNG instance pool...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch('https://searx.space/data/instances.json', { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      const goodInstances = Object.keys(data.instances).filter(url => {
        const info = data.instances[url];
        if (info.error) return false;
        if (info.network_type !== 'normal') return false;
        if (!['A', 'B', 'V', 'C'].includes(info.html?.grade)) return false;
        if (info.timing?.search?.all?.median > 3.0) return false;
        return true;
      });

      // Shuffle
      for (let i = goodInstances.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [goodInstances[i], goodInstances[j]] = [goodInstances[j], goodInstances[i]];
      }

      this.searxInstances = goodInstances.slice(0, 20); // Keep top 20 random good instances
        this.lastFetchTime = now;
        console.log(`[SearchEngine] Successfully populated SearXNG pool with ${this.searxInstances.length} instances.`);
      } catch (err: any) {
        clearTimeout(timeout);
        console.warn(`[SearchEngine] Failed to fetch SearXNG instances: ${err.message}`);
        if (this.searxInstances.length === 0) {
          throw err; // Only throw if we have no fallback instances
        }
      } finally {
        this.fetchingPromise = null;
      }
    })();

    return this.fetchingPromise;
  }

  /**
   * Primary Provider: SearXNG (Public Pool Rotation or Custom Instance)
   */
  private static async searchSearXNG(query: string, config: SearchConfig): Promise<SearchResult[]> {
    let instancesToTry: string[] = [];
    
    if (config.customUrl && config.customUrl.trim() !== '') {
      let url = config.customUrl.trim();
      if (!url.endsWith('/')) url += '/';
      instancesToTry = [url];
    } else {
      await SearchEngine.fetchSearxInstances();
      if (SearchEngine.searxInstances.length === 0) {
        throw new Error('No SearXNG instances available in public pool');
      }
      // Try up to 3 random instances
      instancesToTry = SearchEngine.searxInstances.slice(0, Math.min(3, SearchEngine.searxInstances.length));
    }

    for (let i = 0; i < instancesToTry.length; i++) {
      const instanceUrl = instancesToTry[i];
      const searchUrl = `${instanceUrl}search?q=${encodeURIComponent(query)}&format=json`;
      
      console.log(`[SearchEngine] SearXNG Attempt ${i + 1}/${instancesToTry.length} via ${instanceUrl}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout per instance
      
      try {
        const res = await fetch(searchUrl, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        
        const data = await res.json();
        if (data && data.results && data.results.length > 0) {
          return data.results.slice(0, 10).map((r: any) => ({
            title: r.title || 'Untitled',
            url: r.url,
            snippet: r.content || ''
          }));
        }
      } catch (err: any) {
        clearTimeout(timeout);
        console.warn(`[SearchEngine] SearXNG instance ${instanceUrl} failed: ${err.message}`);
        
        // Remove failed instance from public pool to avoid hitting it again
        if (!config.customUrl) {
          const idx = SearchEngine.searxInstances.indexOf(instanceUrl);
          if (idx !== -1) {
            SearchEngine.searxInstances.splice(idx, 1);
            i--;
          }
        }
      }
    }
    
    throw new Error('All SearXNG attempts failed');
  }

  /**
   * Fallback Provider: DuckDuckGo HTML Client-side Scrape
   */
  private static async searchDuckDuckGo(query: string, config?: SearchConfig): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const html = await res.text();
    const results: SearchResult[] = [];
    
    const resultBlockRegex = /<a class="result__snippet[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    let match;
    let count = 0;
    
    while ((match = resultBlockRegex.exec(html)) !== null && count < 10) {
      let url = match[1];
      if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
        url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
      }
      
      const snippet = match[2].replace(/<[^>]+>/g, '').trim();
      
      if (url && snippet) {
        results.push({
          title: url.split('/')[2] || 'DuckDuckGo Result',
          url,
          snippet
        });
        count++;
      }
    }
    
    if (results.length === 0) throw new Error('No results parsed from DuckDuckGo');
    return results;
  }

  /**
   * Fallback Provider: Bing HTML Client-side Scrape
   */
  private static async searchBing(query: string, config?: SearchConfig): Promise<SearchResult[]> {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timeout);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const html = await res.text();
    const results: SearchResult[] = [];
    
    const blocks = html.split('<li class="b_algo"');
    
    for (let i = 1; i < blocks.length && results.length < 10; i++) {
      const block = blocks[i];
      
      const urlMatch = block.match(/href="([^"]+)"/);
      const titleMatch = block.match(/<h2><a[^>]*>(.*?)<\/a>/);
      const snippetMatch = block.match(/<p[^>]*>(.*?)<\/p>/) || block.match(/<div class="b_caption">.*?<p[^>]*>(.*?)<\/p>/);
      
      if (urlMatch && titleMatch && snippetMatch) {
        results.push({
          title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
          url: urlMatch[1],
          snippet: snippetMatch[1].replace(/<[^>]+>/g, '').trim()
        });
      }
    }
    
    if (results.length === 0) throw new Error('No results parsed from Bing');
    return results;
  }
}
