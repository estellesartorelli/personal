const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export class NotionAdapter {
  constructor({ apiKey, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async #api(path, { method = 'GET', body } = {}) {
    const res = await this.fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Notion API error ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async fetchProjectPages() {
    const results = [];
    let cursor = undefined;
    do {
      const data = await this.#api('/search', {
        method: 'POST',
        body: {
          filter: { property: 'object', value: 'page' },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        }
      });
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  #pageName(page) {
    const titleProp =
      page.properties?.title?.title ??
      Object.values(page.properties ?? {}).find((p) => p.type === 'title')?.title ??
      [];
    return titleProp.map((t) => t.plain_text).join('') || 'Untitled';
  }

  async fetchProjects() {
    const pages = await this.fetchProjectPages();
    return pages.map((page) => ({
      id: `notion:${page.id}`,
      source: 'notion',
      name: this.#pageName(page),
      status: 'active',
      description: null,
      url: page.url,
      lastActivityAt: page.last_edited_time
    }));
  }
}
