import { existsSync } from "node:fs";
import { octokit } from "./lib/github.ts";
import {
	getExpectedLocalPathOfRepo,
	getLocalRepos,
	HOME,
} from "./lib/local.ts";

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
		} else if (existsSync(fullPath)) {
			console.log(
				"duplica",
				entry.path.replace(HOME, "~"),
				"→",
				fullPath.replace(HOME, "~"),
			);
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
		Deno.mkdirSync(`${HOME}/git/hub/error`, { recursive: true });
		const fullPath = `${HOME}/git/hub/error/${entry.repo}`;
		console.error(
			"failed ",
			entry.path.replace(HOME, "~"),
			"→",
			fullPath.replace(HOME, "~"),
			entry,
			error instanceof Error ? error.message : error,
		);
		// Deno.renameSync(entry.path, fullPath);
	}
}
