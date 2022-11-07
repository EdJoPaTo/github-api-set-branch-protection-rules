import { Octokit } from "https://esm.sh/@octokit/core@4.1.0";

// Create a personal access token at https://github.com/settings/tokens/new?scopes=repo
// Then use `export GITHUB_PAT='ghp_…'`
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;
if (!GITHUB_PAT) {
  throw new Error("GITHUB_PAT is not defined");
}

export const octokit = new Octokit({ auth: GITHUB_PAT });
