<!-- doc-id: changelog -->
<!-- source-sha256: 508eb07472ab61c0d7014962cab9f905bbedff2e8eaec06973fe105c71db1021 -->
# 변경 기록

[English](CHANGELOG.md)

kit의 release `vX.Y.Z`마다 `## X.Y.Z` section이 있습니다. 그 글은 GitHub Release의 notes이며, release는 `@polyspec/kit`의 npm asset
`polyspec-kit-npm-X.Y.Z.tgz`를 담습니다.

## Unreleased

- release tag마다 `scripts/kit`을 담은 `@polyspec/kit`의 npm asset `polyspec-kit-npm-<version>.tgz`를 게시합니다. consumer는 module을
  `@polyspec/kit/<module>.mjs`로 import합니다(K55).
- `installPython`, `makeVenv`, `venvProblem`가 install prefix, wrapper file, interpreter의 home을 호출자에게서 절대 경로로 받습니다. kit
  자신의 target은 `checkoutPython(root)`를 넘깁니다(K56).
- `lockRequirements`가 lock entry의 archive URL에서 local file로 가는 map을 선택적으로 받아, polyspec archive마다
  `name @ file:///<path> --hash=sha256:<hex>`를 render하고 lock의 sha256과 대조합니다(K57).
