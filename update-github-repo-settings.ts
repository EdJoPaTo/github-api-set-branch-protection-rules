import { arrayFilterUnique } from "jsr:@edjopato/array-filter-unique@^3";
import {
	MY_REPOS_SEARCH_PARAMS,
	octokit,
	searchGithubRepos,
} from "./lib/github.ts";
import { logArray } from "./lib/log.ts";

function isCheckWanted(name: string): boolean {
	if (name.includes(" beta") || name.includes(" nightly")) {
		return false;
	}
	return WANTED_STATICS.has(name) ||
		name.startsWith("Clippy ") ||
		name.startsWith("Features ") ||
		name.startsWith("MSRV ") ||
		name.startsWith("Node.js") ||
		name.startsWith("Release ") ||
		name.startsWith("Test ");
}

// Do not add website-stalker. The git push doesnt work anymore then
const WANTED_STATICS = new Set([
	"build", // Probably PlatformIO
	"check",
	"denofmt-and-lint",
	"doc",
	"publish-dry-run",
	"Run with example config", // website-stalker
	"rustfmt",
	"test", // Probably Deno
]);

async function updateTagProtections(owner: string, repo: string) {
	const { data } = await octokit.request(
		"GET /repos/{owner}/{repo}/tags/protection",
		{
			owner,
			repo,
		},
	);
	const hasTagAnyProtection = data
		.some((rule) => rule.pattern === "*");
	const superfluousTagProtections = data
		.filter((rule) => rule.pattern !== "*");

	if (!hasTagAnyProtection) {
		await octokit.request("POST /repos/{owner}/{repo}/tags/protection", {
			owner,
			repo,
			pattern: "*",
		});
	}
	for (const rule of superfluousTagProtections) {
		console.log("superfluousTagProtection", rule);
		if (rule.id) {
			await octokit.request(
				"DELETE /repos/{owner}/{repo}/tags/protection/{tag_protection_id}",
				{
					owner,
					repo,
					tag_protection_id: rule.id,
				},
			);
		}
	}
}

async function doRepo(
	owner: string,
	repo: string,
	privateRepo: boolean,
	defaultBranch: string,
) {
	console.log("\ndo repo", owner, repo);

	await octokit.request("PUT /repos/{owner}/{repo}/subscription", {
		owner,
		repo,
		subscribed: true,
	});

	await octokit.request("PATCH /repos/{owner}/{repo}", {
		owner,
		repo,
		allow_auto_merge: true,
		allow_merge_commit: false,
		allow_rebase_merge: false,
		allow_squash_merge: true,
		allow_update_branch: true,
		delete_branch_on_merge: true,
		has_wiki: false,
		web_commit_signoff_required: true,
		security_and_analysis: {
			// @ts-expect-error type not yet known
			dependabot_security_updates: { status: "disabled" },
			secret_scanning: privateRepo ? undefined : { status: "enabled" },
			secret_scanning_push_protection: { status: "enabled" },
		},
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

	if (privateRepo) {
		return;
	}

	await updateTagProtections(owner, repo);

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
		.filter(arrayFilterUnique())
		.sort();

	const relevantChecks = allChecks.filter((o) => isCheckWanted(o));
	// logNonEmptyArray("relevant checks", relevantChecks);

	// const ignoredChecks = allChecks.filter((o) => !isCheckWanted(o));
	// logNonEmptyArray("ignored checks", ignoredChecks);

	await octokit.request(
		"PUT /repos/{owner}/{repo}/branches/{branch}/protection",
		{
			owner,
			repo,
			branch: defaultBranch,
			allow_deletions: false,
			allow_force_pushes: true,
			block_creations: false,
			enforce_admins: false,
			lock_branch: false,
			required_conversation_resolution: true,
			required_linear_history: true,
			required_pull_request_reviews: null,
			restrictions: null,
			required_status_checks: {
				strict: true,
				contexts: relevantChecks,
			},
		},
	);

	return allChecks;
}

const repos = await searchGithubRepos([
	"fork:true",
	"archived:false",
	...MY_REPOS_SEARCH_PARAMS,
].join(" "));
console.log("total repos", repos.length);

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
allChecks = allChecks.filter(arrayFilterUnique()).sort();
const unusedWantedChecks = [...WANTED_STATICS].filter((o) =>
	!allChecks.includes(o)
);
const wantedChecks = allChecks.filter((o) => isCheckWanted(o));
const ignoredChecks = allChecks.filter((o) => !isCheckWanted(o));
logArray("unused WANTED checks", unusedWantedChecks);
logArray("wanted checks", wantedChecks);
logArray("ignored checks", ignoredChecks);
