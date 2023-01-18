export const HOME = Deno.env.get("HOME")!;
if (!HOME) {
  throw new Error("Your shell should set your HOME directory as env");
}

export async function exec(...cmd: [string, ...string[]]): Promise<string> {
  const process = Deno.run({ cmd, stdout: "piped" });

  const status = await process.status();
  if (!status.success) {
    throw new Error(`Command ${cmd[0]} was not successful`);
  }

  const outputBuffer = await process.output();
  const output = new TextDecoder().decode(outputBuffer);
  return output;
}

export type LocalGithubRepoInfo = {
  readonly path: string;
  readonly user: string;
  readonly repo: string;
};

export async function getLocalRepos(): Promise<LocalGithubRepoInfo[]> {
  const fdOutput = await exec(
    "fd",
    "--type=directory",
    "--hidden",
    "^\\.git$",
    HOME + "/git",
  );

  const list: LocalGithubRepoInfo[] = [];
  const others: string[] = [];

  const paths = fdOutput
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => o.replace(/\/.git\/?$/, ""))
    .sort();
  for (const path of paths) {
    const gitOutput = await exec("git", "-C", path, "remote", "--verbose");

    const remotes: Record<string, { user: string; repo: string }> = {};

    const gitOutputLines = gitOutput.split("\n").filter((o) => o.trim() !== "");
    for (const remoteLine of gitOutputLines) {
      const remoteMatch = /(\w+)\t(\S+)/.exec(remoteLine);
      if (!remoteMatch) {
        throw new Error("unknown git remote line: " + remoteLine);
      }

      const remote = remoteMatch[1]!;
      const url = remoteMatch[2]!;
      const urlMatch = /github\.com.([^/]+)\/(\S+)/.exec(url);
      if (!urlMatch) {
        console.log(
          "skip non github url",
          path.replace(HOME, "~"),
          remoteLine,
        );
        continue;
      }

      const user = urlMatch[1]!;
      let repo = urlMatch[2]!;
      if (repo.endsWith(".git")) {
        repo = repo.slice(0, -".git".length);
      }

      remotes[remote] = { user, repo };
    }

    const relevant = remotes["upstream"] ?? remotes["origin"];
    if (relevant) {
      list.push({ path, ...relevant });
    } else {
      others.push(path);
    }
  }

  console.log("other repos:", others.length, others);
  return list;
}

const EXPECTED_OWNERS = new Set([
  "EdJoPaTo",
  "HAWHHCalendarBot",
  "grammyjs",
]);

export type GithubRepoInfo = {
  readonly archived: boolean;
  readonly fork: boolean;
  readonly is_template?: boolean;
  readonly name: string;
  readonly owner: null | { readonly login: string };
  readonly private: boolean;
};

export function getExpectedLocalPathOfRepo(data: GithubRepoInfo): string {
  const owner = (data.owner?.login && EXPECTED_OWNERS.has(data.owner.login))
    ? data.owner.login
    : "other";

  let folder = "";

  if (data.is_template) {
    folder = `${owner}/template`;
  } else {
    folder += data.fork ? "other" : owner;
    folder += "/";

    if (data.archived) {
      folder += "archived-";
    }

    folder += data.private ? "private" : "public";
  }

  const repoFolderName = data.name;

  const containingFolder = `${HOME}/git/hub/${folder}`;
  Deno.mkdirSync(containingFolder, { recursive: true });

  const fullPath = containingFolder + "/" + repoFolderName;
  return fullPath;
}
