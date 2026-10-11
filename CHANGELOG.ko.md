<!-- doc-id: changelog -->
<!-- source-sha256: d68f03bd34252479cb94b4871f8ec331a3a61b2aee7fde9914bf1c571c4be2e3 -->
# 변경 기록

[English](CHANGELOG.md)

kit의 release `vX.Y.Z`마다 `## X.Y.Z` section이 있습니다. 그 글은 GitHub Release의 notes이며, release는 `@polyspec/kit`의 npm asset
`polyspec-kit-npm-X.Y.Z.tgz`를 담습니다.

## Unreleased

- parity 검사가 한 실행이 두 번 보고한 case를 R3 finding으로 보고합니다. node:test, unittest, PHPUnit, cargo, go 출력의 parser가
  run-tests와 parity 검사가 공유하는 `test-output.mjs`로 옮겨지고, suite unit은 case마다 그것을 admit하는 구현인 `admit`을 선언합니다.
  phpunit은 install-tools tool이 됩니다(K47).
- wheel은 같은 release의 다른 wheel package인 sibling을 hash 없는 release asset으로 적습니다. 검사는 #sha256 fragment가 있거나,
  name==version이거나, 다른 version이나 저장소이거나, 다른 file 이름이거나, wheel의 lock에 든 sibling을 거부하며, release-proof는 sibling
  URL마다 게시된 asset과 대조합니다(K52).
- `make dependency-review`가 Go module의 package를 `./...` 대신 이름으로 govulncheck에 넘깁니다. `./...`는 var/tools의 Go toolchain을
  돌다가 실패했습니다(K53).
- release tag마다 `scripts/kit`을 담은 `@polyspec/kit`의 npm asset `polyspec-kit-npm-<version>.tgz`를 게시합니다. consumer는 module을
  `@polyspec/kit/<module>.mjs`로 import합니다(K55).
- `installPython`, `makeVenv`, `venvProblem`가 install prefix, wrapper file, interpreter의 home을 호출자에게서 절대 경로로 받습니다. kit
  자신의 target은 `checkoutPython(root)`를 넘깁니다(K56).
- `lockRequirements`가 lock entry의 archive URL에서 local file로 가는 map을 선택적으로 받아, polyspec archive마다
  `name @ file:///<path> --hash=sha256:<hex>`를 render하고 lock의 sha256과 대조합니다(K57).
- package의 어떤 module도 import될 때 동작하지 않습니다: `check-dependency-policy-mutation.mjs`는 command로 실행될 때만 검사를 실행하고,
  exports는 package가 run-tests를 위해 담는 run-tests preload `test-load-check.mjs`를 거부합니다(K58).
