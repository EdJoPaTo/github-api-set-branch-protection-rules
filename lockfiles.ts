import { existsSync } from "jsr:@std/fs";
import {
	MY_REPOS_SEARCH_PARAMS,
	octokit,
	searchGithubRepos,
} from "./lib/github.ts";
import { exec } from "./lib/local.ts";

const COMMANDS: Readonly<Record<string, string>> = {
	"Cargo.lock": "cargo update",
	"deno.lock": "rm -f deno.lock && fd --extension ts --exec-batch deno cache",
	"package-lock.json":
		"rm -f package-lock.json && nice npm install --no-fund --package-lock-only",
};
const LOCKFILES: ReadonlySet<string> = new Set(Object.keys(COMMANDS));

async function updateLockfiles(dir: string) {
	async function git(...args: string[]): Promise<string> {
		const process = new Deno.Command("git", {
			args,
			cwd: dir,
			stdout: "piped",
		}).spawn();
		const status = await process.status;
		if (!status.success) {
			throw new Error(`git command was not successful: ${args}`);
		}

		const { stdout: outputBuffer } = await process.output();
		const stdout = new TextDecoder().decode(outputBuffer);
		return stdout;
	}

	function willPushBeRelevant() {
		const diff = new Deno.Command("git", {
			args: ["diff", "--shortstat", "origin/lockfiles"],
			cwd: dir,
		}).outputSync();
		if (!diff.success) return true;
		const stdout = new TextDecoder().decode(diff.stdout);
		return stdout.length > 0;
	}

	for (const [lockfile, command] of Object.entries(COMMANDS)) {
		if (!existsSync(dir + "/" + lockfile, { isFile: true })) {
			continue;
		}

		console.log("run update command for", lockfile, "...");

		const process = new Deno.Command("bash", {
			args: ["-c", "set -x && " + command],
			cwd: dir,
		}).spawn();
		const status = await process.status;
		if (!status.success) {
			throw new Error("Update lockfile command was not successful");
		}
	}

	console.log("all update commands done");

	const changesOutput = await git("status", "--porcelain");
	const changesLines = changesOutput.split("\n").filter(Boolean);
	const hasChanges = changesLines.length > 0;
	console.log("hasChanges", hasChanges, changesLines);

	if (!hasChanges) {
		// No changes -> delete branch and ignore when it doesnt exist
		new Deno.Command("git", {
			args: ["push", "origin", ":lockfiles"],
			cwd: dir,
			stdout: "null",
			stderr: "null",
		}).outputSync();
		return;
	}

	await git("switch", "--quiet", "--force-create", "lockfiles");
	await git("commit", "--all", "--message=build: update lockfiles");

	if (willPushBeRelevant()) {
		await git("push", "--force-with-lease", "origin", "lockfiles");
	} else {
		console.log("lockfiles are already the same as origin/lockfiles");
	}
}

const repos = await searchGithubRepos([
	"fork:true",
	"archived:false",
	...MY_REPOS_SEARCH_PARAMS,
].join(" "));
console.log("total repos", repos.length);
for (const repoInfo of repos) {
	const owner = repoInfo.owner!.login;
	const repo = repoInfo.name;

	const { data: contents } = await octokit.request(
		"GET /repos/{owner}/{repo}/contents/{path}",
		{ owner, repo, path: "" },
	);
	if (!Array.isArray(contents)) {
		throw new Error(
			"unexpected API response. Repo root contents should return an array",
		);
	}
	const files = contents
		.filter((entry) => entry.type === "file")
		.map((entry) => entry.name);
	const hasLockfile = files.some((filename) => LOCKFILES.has(filename));
	if (!hasLockfile) {
		console.log("no lockfile → skip", repoInfo.full_name);
		continue;
	}

	console.log();
	console.log(owner, repo);

	const prefix = `github-api-lockfile-${repoInfo.full_name}-`
		.replaceAll(/[^a-zA-Z0-9]+/g, "-");
	const tmpdir = await Deno.makeTempDir({ prefix });

	try {
		await exec(
			"git",
			"clone",
			"--depth=1",
			"--no-single-branch",
			repoInfo.ssh_url,
			tmpdir,
		);
		await updateLockfiles(tmpdir);
	} finally {
		await Deno.remove(tmpdir, { recursive: true });
		console.log();
	}
}
