const LINEAR_API = 'https://api.linear.app/graphql';

const PROJECTS_QUERY = `
  query Projects($after: String) {
    projects(first: 50, after: $after, includeArchived: false) {
      nodes {
        id
        name
        state
        description
        url
        updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUES_QUERY = `
  query Issues($projectId: String!, $after: String) {
    project(id: $projectId) {
      issues(first: 50, after: $after, orderBy: updatedAt) {
        nodes {
          id
          title
          url
          state { name type }
          assignee { name }
          blockedByIssues { nodes { id } }
          updatedAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export class LinearAdapter {
  constructor({ apiKey, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async #gql(query, variables = {}) {
    const res = await this.fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey
      },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}`);
    }
    const body = await res.json();
    if (body.errors) {
      throw new Error(`Linear GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return body.data;
  }

  async fetchProjects() {
    const projects = [];
    let after = null;
    do {
      const data = await this.#gql(PROJECTS_QUERY, { after });
      const conn = data.projects;
      projects.push(...conn.nodes);
      after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after);
    return projects.map((p) => ({
      id: `linear:${p.id}`,
      source: 'linear',
      name: p.name,
      status: p.state === 'completed' ? 'completed' : 'active',
      description: p.description,
      url: p.url,
      lastActivityAt: p.updatedAt
    }));
  }

  async fetchIssues(linearProjectId) {
    const issues = [];
    let after = null;
    do {
      const data = await this.#gql(ISSUES_QUERY, { projectId: linearProjectId, after });
      const conn = data.project.issues;
      issues.push(...conn.nodes);
      after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after);
    return issues.map((i) => ({
      id: `linear:${i.id}`,
      kind: 'issue',
      title: i.title,
      url: i.url,
      state: i.state.name.toLowerCase(),
      assignee: i.assignee?.name ?? null,
      blocked: (i.blockedByIssues?.nodes?.length ?? 0) > 0,
      updatedAt: i.updatedAt
    }));
  }
}
