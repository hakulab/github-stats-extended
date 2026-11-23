<div align="center">
  <img src="docs/appIcon.svg" width="100px" alt="GitHub Stats Extended Logo" />
  <h1>GitHub Stats Extended</h1>
  <p>Dynamically generate GitHub stats for your READMEs.</p>
  <a href="https://github-stats-extended.vercel.app/api?username=anuraghazra">
    <picture>
      <source
        srcset="https://github-stats-extended.vercel.app/api?username=anuraghazra&theme=dark_github"
        media="(prefers-color-scheme: dark)"
      />
      <img
        src="https://github-stats-extended.vercel.app/api?username=anuraghazra&theme=light_github"
        alt="Anurag's GitHub stats"
      />
    </picture>
  </a>
</div>

GitHub-Stats-Extended is the [extended, actively maintained successor](https://github-stats-extended.vercel.app/frontend/docs/fork/) of [github-readme-stats](https://github.com/anuraghazra/github-readme-stats). It generates [SVG cards](#card-types) for your GitHub contributions, top languages, pinned repositories, Gists, and WakaTime activity, with [query-parameter customization](#documentation), [multi-owner repository aggregation](#multi-owner-repository-aggregation), and self-hosting on [Cloudflare Workers](#cloudflare-workers-deployment), Docker, or Vercel.

## Table of Contents

- [Quick Start](#quick-start)
- [Migration from github-readme-stats](#migration-from-github-readme-stats)
- [Card Types](#card-types)
- [Multi-Owner Repository Aggregation](#multi-owner-repository-aggregation)
- [Cloudflare Workers Deployment](#cloudflare-workers-deployment)
- [Documentation](#documentation)
- [Acknowledgements](#acknowledgements)
- [Contributing](#contributing)

## Quick Start

Copy this snippet into your Markdown file and replace the `?username=` value with your GitHub username:

```md
[![Anurag's GitHub stats](https://github-stats-extended.vercel.app/api?username=anuraghazra)](https://github.com/stats-organization/github-stats-extended)
```

You can also configure cards visually in the [card wizard](https://github-stats-extended.vercel.app/frontend) and paste the generated Markdown into your [GitHub profile README](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme#adding-a-profile-readme).

## Migration from github-readme-stats

To migrate from [github-readme-stats](https://github.com/anuraghazra/github-readme-stats), replace `github-readme-stats.vercel.app` with `github-stats-extended.vercel.app`:

```diff
- https://github-readme-stats.vercel.app/api?username=octocat&theme=radical
+ https://github-stats-extended.vercel.app/api?username=octocat&theme=radical
```

GitHub-Stats-Extended stays compatible with `github-readme-stats` query parameters. See the [compatibility notes](https://github-stats-extended.vercel.app/frontend/docs/fork/#compatibility-notes) for details.

## Card Types

- GitHub statistics (`/api`):

  <picture>
    <source
      srcset="https://github-stats-extended.vercel.app/api?username=anuraghazra&theme=dark_github"
      media="(prefers-color-scheme: dark)"
    />
    <img
      src="https://github-stats-extended.vercel.app/api?username=anuraghazra&theme=light_github"
      alt="Anurag's GitHub stats"
    />
  </picture>

- Top languages (`/api/top-langs`):

  <picture>
    <source
      srcset="https://github-stats-extended.vercel.app/api/top-langs/?username=anuraghazra&langs_count=4&theme=dark_github"
      media="(prefers-color-scheme: dark)"
    />
    <img
      src="https://github-stats-extended.vercel.app/api/top-langs/?username=anuraghazra&langs_count=4&theme=light_github"
      alt="Top Langs"
    />
  </picture>

- WakaTime development time (`/api/wakatime`):

  <a href="https://wakatime.com/@alan">
    <picture>
      <source
        srcset="https://github-stats-extended.vercel.app/api/wakatime?username=alan&langs_count=6&theme=dark_github"
        media="(prefers-color-scheme: dark)"
      />
      <img
        src="https://github-stats-extended.vercel.app/api/wakatime?username=alan&langs_count=6&theme=light_github"
        alt="Alan's WakaTime stats"
      />
    </picture>
  </a>

- Pinned repositories beyond GitHub's six-repository profile limit (`/api/pin`):

  <a href="https://github.com/anuraghazra/github-readme-stats">
    <picture>
      <source
        srcset="https://github-stats-extended.vercel.app/api/pin/?username=anuraghazra&repo=github-readme-stats&theme=dark_github_repocard"
        media="(prefers-color-scheme: dark)"
      />
      <img
        src="https://github-stats-extended.vercel.app/api/pin/?username=anuraghazra&repo=github-readme-stats&theme=light_github_repocard"
        alt="Readme Card"
      />
    </picture>
  </a>

- Pinned Gists (`/api/gist`):

  <a href="https://gist.github.com/Yizack/bbfce31e0217a3689c8d961a356cb10d">
    <picture>
      <source
        srcset="https://github-stats-extended.vercel.app/api/gist?id=bbfce31e0217a3689c8d961a356cb10d&theme=dark_github_repocard"
        media="(prefers-color-scheme: dark)"
      />
      <img
        src="https://github-stats-extended.vercel.app/api/gist?id=bbfce31e0217a3689c8d961a356cb10d&theme=light_github_repocard"
        alt="Gist Card"
      />
    </picture>
  </a>

- Customized cards:

  [![Anurag's GitHub stats](https://github-stats-extended.vercel.app/api/?username=anuraghazra&show_icons=true&theme=calm&rank_icon=github&include_all_commits=true&custom_title=Anurag's+Stats&disable_animations=true&number_format=long&show=prs_merged_percentage,prs_reviewed)](https://github-stats-extended.vercel.app/api/?username=anuraghazra&show_icons=true&theme=calm&rank_icon=github&include_all_commits=true&custom_title=Anurag's+Stats&disable_animations=true&number_format=long&show=prs_merged_percentage,prs_reviewed)

## Multi-Owner Repository Aggregation

The stats (`/api`) and top-languages (`/api/top-langs`) endpoints can aggregate repository stars and non-fork language byte counts across additional GitHub users or organizations while keeping user-level metrics (commits, pull requests, issues, reviews, discussions, and contributions) scoped to the primary `username`.

- **Query parameter**: Pass a comma-separated list of GitHub users or organizations via `repo_owners` (or `repo-owners`):

  ```text
  /api?username=alice&repo_owners=org-a,org-b
  /api/top-langs?username=alice&repo-owners=org-a,org-b
  ```

  Owner logins are trimmed and deduplicated case-insensitively, the primary `username` is skipped automatically, and merged repositories are deduplicated by `owner/repo`. Both `exclude_repo` and `EXCLUDE_REPO` match short repository names (`repo-name`) and qualified names (`org-a/repo-name`).

- **Environment default**: Set `DEFAULT_REPO_OWNERS` (or its `REPO_OWNERS` fallback) to a comma-separated list such as `org-a,org-b` to aggregate those owners whenever a request omits `repo_owners` and `repo-owners`.

- **Per-request opt-out**: Pass an empty `repo_owners` parameter (`?username=alice&repo_owners=`) to override `DEFAULT_REPO_OWNERS` / `REPO_OWNERS` and query only `alice`'s own repositories.

## Cloudflare Workers Deployment

The backend includes a Cloudflare Workers entrypoint (`apps/backend/src/worker.ts`) configured in `apps/backend/wrangler.toml`. It serves `/api`, `/api/top-langs`, `/api/pin`, `/api/gist`, and `/api/wakatime`, and canonicalizes `repo_owners` / `repo-owners` query parameters for consistent cache keys.

1. Review `apps/backend/wrangler.toml` and adjust `name` and `routes` for your Cloudflare account and domain. For restricted or multi-owner instances, set plaintext bindings under `[vars]`:

   ```toml
   [vars]
   WHITELIST = "alice"
   DEFAULT_REPO_OWNERS = "org-a,org-b"
   ```

   Other optional variables supported in `[vars]` include `GIST_WHITELIST`, `EXCLUDE_REPO`, `FETCH_MULTI_PAGE_STARS`, and `CACHE_SECONDS`.

2. Store at least one GitHub Personal Access Token as a Worker secret (`PAT_1`, with optional `PAT_2`, `PAT_3`, ... for token rotation):

   ```bash
   pnpm --dir apps/backend exec wrangler secret put PAT_1
   ```

3. Build the workspace packages and deploy the Worker:

   ```bash
   pnpm install
   pnpm run build:packages
   pnpm --dir apps/backend run deploy
   ```

   For local Worker development on port `8787`, run `pnpm --dir apps/backend run dev:worker`.

## Documentation

Use the [card wizard](https://github-stats-extended.vercel.app/frontend) for interactive configuration, or read the [documentation](https://github-stats-extended.vercel.app/frontend/docs/cards/stats/) for card parameters, themes, locales, and Docker or Vercel self-hosting.

## Acknowledgements

This project builds on [github-readme-stats](https://github.com/anuraghazra/github-readme-stats), and the card wizard builds on [GitHub Trends](https://github.com/avgupta456/github-trends). Thanks to [@anuraghazra](https://github.com/anuraghazra), [@avgupta456](https://github.com/avgupta456), [@rickstaa](https://github.com/rickstaa), [@qwerty541](https://github.com/qwerty541), and everyone else who contributed to these projects.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for local setup, testing, and pull request guidelines.
