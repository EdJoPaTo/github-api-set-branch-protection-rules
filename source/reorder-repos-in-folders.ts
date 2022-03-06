import {execSync} from 'node:child_process';
import {mkdirSync, renameSync} from 'node:fs';
import process from 'node:process';
import {Octokit} from '@octokit/core';

// Create a personal access token at https://github.com/settings/tokens/new?scopes=repo
// Then use `export GITHUB_PAT='ghp_…'`
const octokit = new Octokit({auth: process.env['GITHUB_PAT']});

const EXPECTED_OWNERS = new Set(['EdJoPaTo', 'HAWHHCalendarBot', 'grammyjs', 'icarus-consulting']);

interface RepoInfo {
	readonly path: string;
	readonly user: string;
	readonly repo: string;
}

function getLocalRepos() {
	const fdOutput = execSync('fd --type=directory --hidden "^\\.git$" ~/git').toString();

	const list: RepoInfo[] = [];
	const others: string[] = [];

	for (const folderLine of fdOutput.split('\n').filter(o => o.trim() !== '')) {
		const path = folderLine.slice(0, 0 - '/.git'.length);
		const gitOutput = execSync(`git -C ${path} remote --verbose`).toString();

		const remotes: Record<string, {user: string;repo: string}> = {};

		for (const remoteLine of gitOutput.split('\n').filter(o => o.trim() !== '')) {
			const remoteMatch = /(\w+)\t(\S+)/.exec(remoteLine);
			if (!remoteMatch) {
				throw new Error('unknown git remote line: ' + remoteLine);
			}

			const remote = remoteMatch[1]!;
			const url = remoteMatch[2]!;
			const urlMatch = /github\.com.([^/]+)\/(\S+)/.exec(url);
			if (!urlMatch) {
				console.log('skip non github url', path, remoteLine);
				continue;
			}

			const user = urlMatch[1]!;
			let repo = urlMatch[2]!;
			if (repo.endsWith('.git')) {
				repo = repo.slice(0, -'.git'.length);
			}

			remotes[remote] = {user, repo};
		}

		const relevant = remotes['upstream'] ?? remotes['origin'];
		if (relevant) {
			list.push({path, ...relevant});
		} else {
			others.push(path);
		}
	}

	console.log('other repos:', others.length, others.sort());
	return list;
}

void doit();
async function doit() {
	console.time('getLocalRepos');
	const localRepos = getLocalRepos();
	console.timeEnd('getLocalRepos');

	for (const entry of localRepos) {
		const response = await octokit.request('GET /repos/{owner}/{repo}', {
			owner: entry.user,
			repo: entry.repo,
		});

		const {data} = response;

		const ownerFolder = data.owner && EXPECTED_OWNERS.has(data.owner.login) ? data.owner.login : 'other';

		let permissionFolder = '';
		if (data.is_template) {
			permissionFolder += 'template';
		} else {
			if (data.archived) {
				permissionFolder += 'archived-';
			}

			permissionFolder += data.private ? 'private' : 'public';
		}

		const repoFolderName = data.name;

		const targetPath = process.env['HOME']! + `/git/hub/${ownerFolder}/${permissionFolder}`;
		mkdirSync(targetPath, {recursive: true});

		const fullPath = targetPath + '/' + repoFolderName;

		if (entry.path === fullPath) {
			console.log('correct folder', fullPath);
		} else {
			console.log('rename        ', entry.path, fullPath);
			renameSync(entry.path, fullPath);
		}
	}
}
