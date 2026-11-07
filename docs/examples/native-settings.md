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
