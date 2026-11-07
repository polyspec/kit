<!-- doc-id: example-native-settings -->
# Example: native settings

[한국어](native-settings.ko.md)

A repository states the settings of its tools in their own files, which each tool reads as it documents. kit sets none of them. This page shows one working way; copy it, change it, or ignore it.

## npm: `.npmrc`

npm 12 refuses a dependency of a URL unless the project allows it (`allow-remote`, default `none`). A repository whose `package-lock.json` pins `@polyspec/kit`, or another package, by the URL of its release asset allows the URLs that its own `package.json` names:

```ini
allow-remote=root
```

A repository that installs a provider whose own dependencies are URLs allows those too:

```ini
allow-remote=all
```

npm reads the `.npmrc` at the root of the project for every `npm ci` and `npm install`, including `npm --prefix <root> ci` run from another folder.

## mise and uv: `mise.toml`

mise reads `[settings]` of `mise.toml`, and the tools it runs get `[env]`. A repository that installs and runs only what `mise.lock` pins, with no install on its own, and whose uv downloads no Python, takes the Python of mise (the shims come first on PATH) before a managed Python of the home, and keeps its cache in the checkout, writes:

```toml
[settings]
locked = true
auto_install = false

[env]
UV_PYTHON_DOWNLOADS = "never"
UV_PYTHON_PREFERENCE = "only-system"
UV_NO_CONFIG = "1"
UV_CACHE_DIR = "{{config_root}}/var/tools/mise/cache/uv"
```

A repository with a `uv.toml` of its own leaves out `UV_NO_CONFIG`, which would make uv skip that file too.
