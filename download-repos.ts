import { exec, getExpectedLocalPathOfRepo, HOME } from "./lib/local.ts";
import { searchGithubRepos } from "./lib/github.ts";

async function getRepos() {
  const repos = await searchGithubRepos([
    "fork:true",
    "repo:grammyjs/stateless-question",
    "user:EdJoPaTo",
    "user:HAWHHCalendarbot",
  ].join(" "));
  console.log("total repos", repos.length);
  return repos;
}

for (const repo of await getRepos()) {
  const localPath = getExpectedLocalPathOfRepo(repo);
  console.log(localPath.replace(HOME, "~"), repo.ssh_url);

  try {
    await Deno.stat(localPath);
    // Path exists, probably fine
  } catch {
    // Path does not exist
    console.log(await exec("git", "clone", repo.ssh_url, localPath));
  }
}
