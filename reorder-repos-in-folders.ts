import {
	getExpectedLocalPathOfRepo,
	getLocalRepos,
	HOME,
} from "./lib/local.ts";
import { octokit } from "./lib/github.ts";

console.time("getLocalRepos");
const localRepos = await getLocalRepos();
console.timeEnd("getLocalRepos");

for (const entry of localRepos) {
	try {
		const response = await octokit.request("GET /repos/{owner}/{repo}", {
			owner: entry.user,
			repo: entry.repo,
		});

		const fullPath = getExpectedLocalPathOfRepo(response.data);

		if (entry.path === fullPath) {
			console.log("correct", fullPath.replace(HOME, "~"));
		} else {
			console.log(
				"rename ",
				entry.path.replace(HOME, "~"),
				"→",
				fullPath.replace(HOME, "~"),
			);
			Deno.renameSync(entry.path, fullPath);
		}
	} catch (error) {
		console.error(
			"failed with repo",
			entry,
			error instanceof Error ? error.message : error,
		);
	}
}
