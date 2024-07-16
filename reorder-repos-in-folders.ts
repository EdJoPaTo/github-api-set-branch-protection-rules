import { existsSync } from "node:fs";
import {
	MY_REPOS_SEARCH_PARAMS,
	octokit,
	searchGithubRepos,
} from "./lib/github.ts";
import {
	getExpectedLocalPathOfRepo,
	getLocalRepos,
	HOME,
} from "./lib/local.ts";

const [localRepos, remoteRepos] = await Promise.all([
	getLocalRepos(),
	searchGithubRepos([
		"fork:true",
		...MY_REPOS_SEARCH_PARAMS,
	].join(" ")),
]);

for (const entry of localRepos) {
	try {
		let fullPath: string;

		const remoteRepoInfo = remoteRepos
			.find((r) => entry.url === r.ssh_url || entry.url === r.clone_url);
		if (remoteRepoInfo) {
			fullPath = getExpectedLocalPathOfRepo(remoteRepoInfo);
		} else {
			const { data: repoInfo } = await octokit.request(
				"GET /repos/{owner}/{repo}",
				{
					owner: entry.user,
					repo: entry.repo,
				},
			);

			if (entry.url !== repoInfo.ssh_url) {
				console.log(
					"not in search result, remote is",
					repoInfo.ssh_url,
				);
			}

			fullPath = getExpectedLocalPathOfRepo(repoInfo);
		}

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
