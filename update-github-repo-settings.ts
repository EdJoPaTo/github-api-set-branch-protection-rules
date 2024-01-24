import { arrayFilterUnique } from "https://esm.sh/array-filter-unique@3";
import { octokit, searchGithubRepos } from "./lib/github.ts";

async function getRepos() {
	const repos = await searchGithubRepos([
		"fork:true",
		"archived:false",
		"repo:grammyjs/stateless-question",
		"user:EdJoPaTo",
		"user:HAWHHCalendarbot",
	].join(" "));

	console.log("total repos", repos.length);

	logNonEmptyArray(
		"not main",
		repos
			.filter((o) => o.default_branch !== "main")
			.map((o) => `${o.default_branch} ${o.html_url}`),
	);

	logNonEmptyArray(
		"has projects",
		repos
			.filter((o) => o.has_projects)
			.map((o) => `${o.html_url}`),
	);

	return repos;
}

function logNonEmptyArray(description: string, array: unknown[]) {
	if (array.length > 0) logArray(description, array);
}
function logArray(description: string, array: unknown[]) {
	console.log(description, array.length, array);
}

function isCheckWanted(name: string): boolean {
	return WANTED_STATICS.has(name) ||
		name.startsWith("Node.js") ||
		name.startsWith("Release ") ||
		name.startsWith("Test 1") || // Test on Rust version 1.23.4
		name.startsWith("Test stable");
}

// Do not add website-stalker. The git push doesnt work anymore then
const WANTED_STATICS = new Set([
	"build", // Probably PlatformIO
	"denofmt-and-lint",
	"doc",
	"docker",
	"rustfmt",
	"Rustfmt", // legacy for rustfmt
	"test", // Probably Deno
]);

async function doRepo(
	owner: string,
	repo: string,
	privateRepo: boolean,
	defaultBranch: string,
) {
	console.log();
	console.log("do repo", owner, repo);

	await octokit.request("PUT /repos/{owner}/{repo}/subscription", {
		owner,
		repo,
		subscribed: true,
	});

	await octokit.request("PATCH /repos/{owner}/{repo}", {
		owner,
		repo,
		allow_update_branch: true,
		allow_auto_merge: true,
		allow_merge_commit: false,
		allow_rebase_merge: false,
		allow_squash_merge: true,
		delete_branch_on_merge: true,
		has_wiki: false,
	});

	await octokit.request(
		"PUT /repos/{owner}/{repo}/actions/permissions/workflow",
		{
			owner,
			repo,
			can_approve_pull_request_reviews: false,
			default_workflow_permissions: "read",
		},
	);

	const workflowsResponse = await octokit.request(
		"GET /repos/{owner}/{repo}/actions/workflows",
		{
			owner,
			repo,
			per_page: 100,
		},
	);
	const { workflows } = workflowsResponse.data;
	const nonActive = workflows.filter((o) => o.state !== "active");
	logNonEmptyArray(
		"non active workflows",
		nonActive.map((o) => ({
			state: o.state,
			name: o.name,
			path: o.path,
			html_url: o.html_url,
		})),
	);

	if (privateRepo) {
		return;
	}

	const checksResponse = await octokit.request(
		"GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
		{
			owner,
			repo,
			ref: defaultBranch,
		},
	);
	const allChecks = checksResponse.data.check_runs
		.map((o) => o.name)
		.filter(arrayFilterUnique());

	const relevantChecks = allChecks.filter((o) => isCheckWanted(o)).sort();
	// logNonEmptyArray("relevant checks", relevantChecks);

	// const ignoredChecks = allChecks.filter((o) => !isCheckWanted(o)).sort();
	// logNonEmptyArray("ignored checks", ignoredChecks);

	await octokit.request(
		"PUT /repos/{owner}/{repo}/branches/{branch}/protection",
		{
			owner,
			repo,
			branch: defaultBranch,
			required_status_checks: {
				strict: true,
				contexts: relevantChecks,
			},
			allow_deletions: false,
			allow_force_pushes: true,
			enforce_admins: false,
			required_conversation_resolution: true,
			required_linear_history: true,
			required_pull_request_reviews: null,
			restrictions: null,
		},
	);

	return allChecks;
}

const repos = await getRepos();
logNonEmptyArray("repos", repos.map((o) => o.full_name));

let allChecks: string[] = [];

for (const repo of repos) {
	const result = await doRepo(
		repo.owner!.login,
		repo.name,
		repo.private,
		repo.default_branch,
	);
	allChecks.push(...(result ?? []));
}

console.log("\n\nall done");
allChecks = allChecks.filter(arrayFilterUnique());
const unusedWantedChecks = [...WANTED_STATICS].filter((o) =>
	!allChecks.includes(o)
).sort();
const wantedChecks = allChecks.filter((o) => isCheckWanted(o)).sort();
const ignoredChecks = allChecks.filter((o) => !isCheckWanted(o)).sort();
logArray("unused WANTED checks", unusedWantedChecks);
logArray("wanted checks", wantedChecks);
logArray("ignored checks", ignoredChecks);
