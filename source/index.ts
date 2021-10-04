import {Octokit} from '@octokit/core';
import arrayFilterUnique from 'array-filter-unique';

// Create a personal access token at https://github.com/settings/tokens/new?scopes=repo
const octokit = new Octokit({auth: 'personal-access-token123'});

async function getRepos() {
	const default_search_options = {
		// eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style, @typescript-eslint/prefer-as-const
		sort: 'updated' as 'updated',
		q: [
			'fork:true',
			'archived:false',
			'repo:grammyjs/i18n',
			'repo:grammyjs/stateless-question',
			'user:EdJoPaTo',
			'user:HAWHHCalendarbot',
		].join(' '),
		per_page: 100,
	};
	const repos = [
		await octokit.request('GET /search/repositories', {...default_search_options, page: 1}),
		await octokit.request('GET /search/repositories', {...default_search_options, page: 2}),
	]
		.flatMap(o => o.data.items);

	console.log('total repos', repos.length, '/ 200 due to 2 pages');

	console.log('not main', repos
		.filter(o => o.default_branch !== 'main')
		.map(o => `${o.default_branch} ${o.html_url}`),
	);

	console.log('has projects', repos
		.filter(o => o.has_projects)
		.map(o => `${o.html_url}`),
	);

	return repos;
}

void doit();
async function doit() {
	const repos = await getRepos();
	console.log('repos', repos.length, repos.map(o => o.html_url));

	for (const repo of repos) {
		// eslint-disable-next-line no-await-in-loop
		await doRepo(repo.owner!.login, repo.name, repo.private, repo.default_branch);
	}
}

const WANTED = new Set([
	'docker',
	'Node.js 12',
	'Node.js 14',
	'Node.js 16',
	'Release aarch64-apple-darwin',
	'Release aarch64-unknown-linux-gnu',
	'Release x86_64-pc-windows-msvc',
	'Release x86_64-unknown-linux-gnu',
	'Rustfmt',
]);

async function doRepo(owner: string, repo: string, privateRepo: boolean, defaultBranch: string) {
	console.log();
	console.log('do repo', owner, repo);

	console.log('watch repo', (await octokit.request('PUT /repos/{owner}/{repo}/subscription', {
		owner,
		repo,
		subscribed: true,
	})).status);

	console.log('update repo', (await octokit.request('PATCH /repos/{owner}/{repo}', {
		owner,
		repo,
		allow_auto_merge: true,
		allow_merge_commit: false,
		allow_rebase_merge: false,
		allow_squash_merge: true,
		delete_branch_on_merge: true,
		has_wiki: false,
	})).status);

	if (privateRepo) {
		return;
	}

	const allChecks = (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
		owner,
		repo,
		ref: defaultBranch,
	})).data.check_runs
		.map(o => o.name)
		.filter(arrayFilterUnique());

	const relevantChecks = allChecks.filter(o => WANTED.has(o)).sort();
	console.log('relevant checks', relevantChecks);
	console.log('ignored checks', allChecks.filter(o => !WANTED.has(o)).sort());

	console.log('protection rules', (await octokit.request('PUT /repos/{owner}/{repo}/branches/{branch}/protection', {
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
	})).status);
}
