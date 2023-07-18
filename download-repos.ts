import { exec, getExpectedLocalPathOfRepo, HOME } from "./lib/local.ts";
import { searchGithubRepos } from "./lib/github.ts";

async function getRepos() {
  const repos = await searchGithubRepos([
    "archived:false",
    "fork:true",
    "repo:grammyjs/stateless-question",
    "user:EdJoPaTo",
    "user:HAWHHCalendarbot",
  ].join(" "));
  console.log("total repos", repos.length);
  return repos;
}

const allRepos = await getRepos();
const jobs = allRepos
  .map((repo) => ({
    localPath: getExpectedLocalPathOfRepo(repo),
    repo,
  }))
  .sort((a, b) => a.localPath.localeCompare(b.localPath));

for (const { localPath, repo } of jobs) {
  console.log(localPath.replace(HOME, "~"));
  try {
    await Deno.stat(localPath);
    // Path exists, probably fine
  } catch {
    // Path does not exist
    console.log(await exec("git", "clone", repo.ssh_url, localPath));
  }
}
