import { Octokit } from "https://esm.sh/@octokit/core@4";
import type { Endpoints } from "https://esm.sh/@octokit/types@9";

// Create a personal access token at https://github.com/settings/tokens/new?scopes=repo
// Then use `export GITHUB_PAT='ghp_…'`
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;
if (!GITHUB_PAT) {
  throw new Error("GITHUB_PAT is not defined");
}

export const octokit = new Octokit({ auth: GITHUB_PAT });

export type GithubSearchRepoInfos =
  Endpoints["GET /search/repositories"]["response"]["data"]["items"];

export async function searchGithubRepos(
  query: string,
): Promise<GithubSearchRepoInfos> {
  const repos: GithubSearchRepoInfos = [];

  for (let page = 1;; page++) {
    const response = await octokit.request("GET /search/repositories", {
      per_page: 100,
      sort: "updated",
      page,
      q: query,
    });
    const { items } = response.data;
    repos.push(...items);
    if (items.length < 100) {
      break;
    }
  }

  return repos;
}
